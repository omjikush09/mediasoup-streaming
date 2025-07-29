import { types as mediaSoupTypes } from "mediasoup";
import { config } from "../config/mediasoup";
import path from "path";
import * as fs from "fs";
import { ChildProcess, exec, execSync, spawn, spawnSync } from "child_process";
import logger from "../utlis/logger";
import * as net from "net";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface participant {
	socketId: string;
	producers: {
		audioProducer?: mediaSoupTypes.Producer;
		videoProducer?: mediaSoupTypes.Producer;
	};
	position: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

type videoInput = {
	index: number;
	participantId: string;
	layout: participantInfo["layout"];
};

type audioInput = {
	index: number;
	participantId: string;
};

interface participantInfo {
	id: string;
	layout: participant["position"];
	consumers: {
		video?: mediaSoupTypes.Consumer;
		audio?: mediaSoupTypes.Consumer;
	};
	transports: {
		video?: mediaSoupTypes.PlainTransport;
		audio?: mediaSoupTypes.PlainTransport;
	};
	videosSdpPath?: string;
	audioSdpPath?: string;
	ports: {
		video?: number;
		audio?: number;
	};
	ips: {
		video?: string;
		audio?: string;
	};
}

interface PortAllocation {
	video?: number;
	audio?: number;
}

export class MultiStreamHLSMixer {
	router: mediaSoupTypes.Router;
	participantInfo = new Map<string, participantInfo>();
	segmentDuration = 4;
	playlistSize = 10;
	outputPath: string;
	videoMixConfig;
	ffmpegProcess: ChildProcess | null;
	usedPorts = new Set<number>();
	isRestarting = false;
	processMonitorInterval: NodeJS.Timeout | null = null;

	constructor(router: mediaSoupTypes.Router) {
		this.router = router;
		this.outputPath = "./hls_output";
		this.videoMixConfig = {
			width: 1920,
			height: 1080,
			fps: 30,
			bitrate: "2000k",
		};
		this.ffmpegProcess = null;
		this.ensureDirectoryExists();
		this.startProcessMonitoring();
	}

	private startProcessMonitoring() {
		// Monitor for orphaned FFmpeg processes every 30 seconds
		this.processMonitorInterval = setInterval(() => {
			this.checkForOrphanedProcesses();
		}, 30000);
	}

	private async checkForOrphanedProcesses() {
		try {
			const { stdout } = await execAsync('pgrep -f "ffmpeg.*hls_output"');
			const processes = stdout.trim().split("\n").filter(Boolean);

			if (
				processes.length > 1 ||
				(processes.length === 1 && !this.ffmpegProcess)
			) {
				logger.warn(
					`Found ${processes.length} FFmpeg processes, cleaning up orphans`
				);
				await execAsync('pkill -f "ffmpeg.*hls_output"');
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		} catch (error) {
			// No processes found or error - this is usually fine
		}
	}

	async generateFFmpegHLSStream(participants: participant[]) {
		try {
			// Prevent multiple simultaneous restarts
			if (this.isRestarting) {
				logger.warn("FFmpeg restart already in progress, skipping...");
				return;
			}

			this.isRestarting = true;

			logger.info("Starting HLS stream generation", {
				participantCount: participants.length,
				participants: participants.map((p) => ({
					id: p.socketId,
					hasVideo: !!p.producers.videoProducer,
					hasAudio: !!p.producers.audioProducer,
				})),
			});

			const playlistPath = path.join(this.outputPath, "playlist.m3u8");
			const segmentPath = path.join(this.outputPath, "segment_%03d.ts");

			// Ensure complete cleanup before starting
			// There could be situation where PORTs are about to get relates
			// THEN: Wait longer for ports to be fully released
			logger.info("Waiting for ports to be fully released...");
			await new Promise((resolve) => setTimeout(resolve, 8000)); // Increased to 8 seconds

			const portAllocations = new Map<string, PortAllocation>();

			logger.info("Pre-allocating ports for all participants...");
			for (const participant of participants) {
				const allocation: PortAllocation = {};

				if (participant.producers.videoProducer) {
					allocation.video = await this.findAvailablePortWithRetry(20000, 5);
					logger.debug(
						`Allocated video port ${allocation.video} for ${participant.socketId}`
					);
				}

				if (participant.producers.audioProducer) {
					allocation.audio = await this.findAvailablePortWithRetry(21000, 5);
					logger.debug(
						`Allocated audio port ${allocation.audio} for ${participant.socketId}`
					);
				}

				portAllocations.set(participant.socketId, allocation);
			}

			logger.info("Port allocations completed", {
				allocations: Array.from(portAllocations.entries()).map(
					([id, ports]) => ({
						participantId: id,
						videoPorts: ports.video
							? `${ports.video}-${ports.video + 1}`
							: null,
						audioPorts: ports.audio
							? `${ports.audio}-${ports.audio + 1}`
							: null,
					})
				),
			});

			// Generate streams for all participants with pre-allocated ports
			for (const user of participants) {
				const ports = portAllocations.get(user.socketId);
				await this.getParticipantStreamWithPorts(user, ports);
			}

			// Log what streams were actually created
			logger.info("Participant streams created", {
				participantInfo: Array.from(this.participantInfo.entries()).map(
					([id, info]) => ({
						id,
						hasVideoSdp: !!info.videosSdpPath,
						hasAudioSdp: !!info.audioSdpPath,
						videoSdpExists: info.videosSdpPath
							? fs.existsSync(info.videosSdpPath)
							: false,
						audioSdpExists: info.audioSdpPath
							? fs.existsSync(info.audioSdpPath)
							: false,
						videoPorts: info.ports?.video,
						audioPorts: info.ports?.audio,
						videoIp: info.ips?.video,
						audioIp: info.ips?.audio,
					})
				),
			});

			// Wait for streams to become stable
			logger.info("Waiting for streams to stabilize...");
			await new Promise((resolve) => setTimeout(resolve, 5000)); // Increased wait time

			let ffmpegArgs: string[] = ["-v", "debug"];

			const videoInputs: videoInput[] = [];
			const audioInputs: audioInput[] = [];
			let inputIndex = 0;

			// Prepare inputs - only add valid SDP files
			for (const [participantId, participantInfo] of this.participantInfo) {
				if (
					participantInfo.videosSdpPath &&
					fs.existsSync(participantInfo.videosSdpPath)
				) {
					ffmpegArgs.push(
						"-protocol_whitelist",
						"file,rtp,udp",
						"-fflags",
						"+genpts",
						"-i",
						participantInfo.videosSdpPath
					);
					videoInputs.push({
						index: inputIndex,
						layout: participantInfo.layout,
						participantId,
					});
					inputIndex++;
				} else {
					logger.warn(`Video SDP not found for participant ${participantId}`, {
						sdpPath: participantInfo.videosSdpPath,
						exists: participantInfo.videosSdpPath
							? fs.existsSync(participantInfo.videosSdpPath)
							: false,
					});
				}

				if (
					participantInfo.audioSdpPath &&
					fs.existsSync(participantInfo.audioSdpPath)
				) {
					ffmpegArgs.push(
						"-protocol_whitelist",
						"file,rtp,udp",
						"-fflags",
						"+genpts",
						// "-re", // Read input at native frame rate
						"-i",
						participantInfo.audioSdpPath
					);
					audioInputs.push({
						index: inputIndex,
						participantId,
					});
					inputIndex++;
				} else {
					logger.warn(`Audio SDP not found for participant ${participantId}`, {
						sdpPath: participantInfo.audioSdpPath,
						exists: participantInfo.audioSdpPath
							? fs.existsSync(participantInfo.audioSdpPath)
							: false,
					});
				}
			}

			logger.info("FFmpeg inputs prepared", {
				videoInputs: videoInputs.length,
				audioInputs: audioInputs.length,
				totalInputs: inputIndex,
			});

			if (videoInputs.length === 0 && audioInputs.length === 0) {
				return;
			}

			// Build filters
			const filters: string[] = [];
			const maps: string[] = [];

			// Build video filter
			if (videoInputs.length > 0) {
				const videoFilter = this.buildVideoFilter(videoInputs);
				filters.push(videoFilter);
				maps.push("-map", "[mixed_video]");
			} else {
				// Create a black video if no video inputs
				filters.push(
					`color=black:size=${this.videoMixConfig.width}x${this.videoMixConfig.height}:rate=${this.videoMixConfig.fps}:duration=10[mixed_video]`
				);
				maps.push("-map", "[mixed_video]");
			}

			// Build audio filter
			if (audioInputs.length > 0) {
				const audioFilter = this.buildAudioMixer(audioInputs);
				filters.push(audioFilter);
				maps.push("-map", "[mixed_audio]");
			} else {
				// Create silent audio if no audio inputs
				filters.push(
					"anullsrc=channel_layout=stereo:sample_rate=44100[mixed_audio]"
				);
				maps.push("-map", "[mixed_audio]");
			}

			// Add filter_complex with properly joined filters
			const filterComplex = filters.join(";");
			ffmpegArgs.push("-filter_complex", filterComplex);
			ffmpegArgs.push(...maps);

			const playlistExists = fs.existsSync(playlistPath);

			const hlsFlags = playlistExists
				? "delete_segments+independent_segments+omit_endlist+append_list+round_durations+discont_start"
				: "delete_segments+independent_segments+omit_endlist+round_durations+discont_start";

			let hls_start_number = this.getLastSegmentNumber(playlistPath) + 1;
			logger.info(playlistExists);
			logger.info(hls_start_number);
			// Add encoding and output parameters
			ffmpegArgs.push(
				// Video encoding
				"-use_wallclock_as_timestamps",
				"1",
				"-c:v",
				"libx264",
				"-preset",
				"ultrafast",
				"-tune",
				"zerolatency",
				"-profile:v",
				"baseline",
				"-level",
				"3.0",
				"-pix_fmt",
				"yuv420p",
				"-r",
				this.videoMixConfig.fps.toString(),
				"-b:v",
				this.videoMixConfig.bitrate,
				"-maxrate",
				this.videoMixConfig.bitrate,
				"-bufsize",
				"4000k",
				"-keyint_min",
				"30",
				"-g",
				"60",
				"-sc_threshold",
				"0",

				// Audio encoding
				"-c:a",
				"aac",
				"-b:a",
				"128k",
				"-ar",
				"44100",
				"-ac",
				"2",

				// HLS settings
				"-f",
				"hls",
				"-hls_time",
				this.segmentDuration.toString(),
				"-hls_list_size",
				this.playlistSize.toString(),
				"-start_number",
				hls_start_number.toString(),
				"-hls_flags",
				hlsFlags,
				"-hls_segment_filename",
				segmentPath,
				"-hls_allow_cache",
				"0",

				// Output
				playlistPath,
				"-y"
			);

			logger.info("Starting FFmpeg with command", {
				command: "ffmpeg " + ffmpegArgs.join(" "),
			});
			let ffmpegStarted = false;
			const result = await this.startFFmpegProcess(ffmpegArgs);
			ffmpegStarted = result.success;

			if (!ffmpegStarted) {
				throw new Error("FFmpeg failed to start ");
			}

			logger.info("FFmpeg process started successfully");
			this.isRestarting = false;
		} catch (error) {
			logger.error("Failed to start FFmpeg stream:", error);
			this.isRestarting = false;
			await this.forceCleanup();
			throw error;
		}
	}

	private async startFFmpegProcess(
		ffmpegArgs: string[]
	): Promise<{ success: boolean; error?: string }> {
		return new Promise((resolve) => {
			const ffmpeg = spawn("/opt/homebrew/bin/ffmpeg", ffmpegArgs, {
				stdio: ["pipe", "pipe", "pipe"],
			});

			let ffmpegStarted = false;
			let errorOutput = "";

			const timeout = setTimeout(() => {
				if (!ffmpegStarted) {
					ffmpeg.kill("SIGTERM");
					resolve({ success: false, error: "FFmpeg startup timeout" });
				}
			}, 10000); // 10 second timeout

			ffmpeg.stdout.on("data", (data) => {
				logger.debug(`FFmpeg stdout: ${data}`);
			});

			ffmpeg.stderr.on("data", (data) => {
				const errorStr = data.toString();
				errorOutput += errorStr;
				// logger.error(data.toString());

				// Check if FFmpeg has started successfully
				if (
					errorStr.includes("Opening") ||
					errorStr.includes("Stream mapping") ||
					errorStr.includes("Output #0") ||
					errorStr.includes("muxer does not support non seekable output")
				) {
					if (!ffmpegStarted) {
						ffmpegStarted = true;
						clearTimeout(timeout);
						this.ffmpegProcess = ffmpeg;
						resolve({ success: true });
					}
				}

				// Log all stderr for debugging
				logger.debug(`FFmpeg stderr: ${errorStr}`);

				// Check for critical errors
				if (
					errorStr.includes("Invalid argument") ||
					errorStr.includes("No such file") ||
					errorStr.includes("Error parsing") ||
					errorStr.includes("No option name") ||
					errorStr.includes("Connection refused") ||
					errorStr.includes("Protocol not found") ||
					errorStr.includes("Invalid data found") ||
					errorStr.includes("bind failed: Address already in use")
				) {
					logger.error("Critical FFmpeg error detected:", errorStr);
					if (!ffmpegStarted) {
						clearTimeout(timeout);
						ffmpeg.kill("SIGTERM");
						resolve({ success: false, error: errorStr });
					}
				}
			});

			ffmpeg.on("close", async (code) => {
				logger.info(`FFmpeg process closed with code ${code}`);
				if (code !== 0 && code !== null && code !== 255) {
					logger.error(`FFmpeg exited with error code ${code}`, {
						errorOutput: errorOutput.slice(-1000),
					});
				}
				this.ffmpegProcess = null;

				if (!ffmpegStarted) {
					clearTimeout(timeout);
					resolve({ success: false, error: `FFmpeg exited with code ${code}` });
				}
			});

			ffmpeg.on("error", (error) => {
				logger.error("FFmpeg process error:", error);
				this.ffmpegProcess = null;

				if (!ffmpegStarted) {
					clearTimeout(timeout);
					resolve({ success: false, error: error.message });
				}
			});
			ffmpeg.on("exit", (code, signal) => {
				console.log(`Exited with code ${code}, signal ${signal}`);
			});
			ffmpeg.on("error", (err) => {
				console.error("Error:", err);
			});
		});
	}

	async findAvailablePortWithRetry(
		startPort: number,
		maxRetries: number = 5
	): Promise<number> {
		let attempts = 0;

		while (attempts < maxRetries) {
			try {
				const port = await this.findAvailablePort(startPort + attempts * 100);

				// Double-check the port is actually available by trying to bind to it
				const isActuallyAvailable = await this.verifyPortAvailable(port);
				if (isActuallyAvailable) {
					return port;
				} else {
					logger.warn(`Port ${port} verification failed, trying next port`);
					attempts++;
				}
			} catch (error) {
				logger.warn(`Port allocation attempt ${attempts + 1} failed:`, error);
				attempts++;

				if (attempts < maxRetries) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			}
		}

		throw new Error(
			`Failed to find available port after ${maxRetries} attempts`
		);
	}

	private async verifyPortAvailable(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = net.createServer();

			const timeout = setTimeout(() => {
				server.close();
				resolve(false);
			}, 3000);

			server.listen(port, () => {
				clearTimeout(timeout);
				server.close(() => {
					resolve(true);
				});
			});

			server.on("error", () => {
				clearTimeout(timeout);
				resolve(false);
			});
		});
	}

	async findAvailablePort(startPort: number = 20000): Promise<number> {
		return new Promise((resolve, reject) => {
			let attempts = 0;
			const maxAttempts = 100;

			const testPort = (port: number) => {
				if (attempts >= maxAttempts) {
					reject(new Error("No available ports found"));
					return;
				}

				// Mark ports as used IMMEDIATELY to prevent race conditions
				if (this.usedPorts.has(port) || this.usedPorts.has(port + 1)) {
					testPort(port + 2);
					return;
				}

				// Reserve ports before testing
				this.usedPorts.add(port);
				this.usedPorts.add(port + 1);

				attempts++;
				const server = net.createServer();

				server.listen(port, () => {
					server.close(() => {
						logger.debug(
							`Confirmed available port: ${port} (RTCP: ${port + 1})`
						);
						resolve(port);
					});
				});

				server.on("error", () => {
					// Remove from used ports if test failed
					this.usedPorts.delete(port);
					this.usedPorts.delete(port + 1);
					testPort(port + 2);
				});
			};

			testPort(startPort);
		});
	}

	generateSDPForFFmpeg(
		consumer: mediaSoupTypes.Consumer,
		mediaType: mediaSoupTypes.MediaKind,
		port: number,
		ip: string
	): string {
		if (!consumer.rtpParameters.codecs.length) {
			throw new Error(`No codecs available for ${mediaType} consumer`);
		}

		const codec = consumer.rtpParameters.codecs[0];
		const rtcpPort = port + 1;

		let sdp = `v=0\r\n`;
		sdp += `o=- 0 0 IN IP4 ${ip}\r\n`;
		sdp += `s=mediasoup\r\n`;
		sdp += `c=IN IP4 ${ip}\r\n`;
		sdp += `t=0 0\r\n`;

		if (mediaType === "video") {
			sdp += `m=video ${port} RTP/AVP ${codec.payloadType}\r\n`;
			sdp += `a=rtcp:${rtcpPort}\r\n`;
			sdp += `a=rtpmap:${codec.payloadType} ${codec.mimeType.split("/")[1]}/${
				codec.clockRate
			}\r\n`;

			if (codec.parameters) {
				const fmtp = Object.entries(codec.parameters)
					.map(([key, value]) => `${key}=${value}`)
					.join(";");
				sdp += `a=fmtp:${codec.payloadType} ${fmtp}\r\n`;
			}
		} else if (mediaType === "audio") {
			const channels = codec.channels || 1;
			sdp += `m=audio ${port} RTP/AVP ${codec.payloadType}\r\n`;
			sdp += `a=rtcp:${rtcpPort}\r\n`;
			sdp += `a=rtpmap:${codec.payloadType} ${codec.mimeType.split("/")[1]}/${
				codec.clockRate
			}/${channels}\r\n`;
		}

		sdp += `a=recvonly\r\n`;

		logger.debug(`Generated SDP for ${mediaType} on ${ip}:${port}:`, sdp);
		return sdp;
	}

	async getParticipantStreamWithPorts(
		participant: participant,
		allocatedPorts?: PortAllocation
	) {
		logger.info(`Setting up streams for participant ${participant.socketId}`, {
			hasVideoProducer: !!participant.producers.videoProducer,
			hasAudioProducer: !!participant.producers.audioProducer,
			allocatedPorts,
		});

		let participantInfoTemp: participantInfo = {
			id: participant.socketId,
			layout: participant.position,
			consumers: {},
			transports: {},
			ports: {},
			ips: {},
		};

		try {
			if (participant.producers.videoProducer && allocatedPorts?.video) {
				logger.info(`Creating video stream for ${participant.socketId}`);

				const videoTransport = await this.getPlainTransport();
				const ffmpegVideoPort = allocatedPorts.video;
				const transportIp = videoTransport.tuple.localIp;

				await videoTransport.connect({
					ip: transportIp,
					port: ffmpegVideoPort,
					rtcpPort: ffmpegVideoPort + 1,
				});

				const videoConsumer = await videoTransport.consume({
					producerId: participant.producers.videoProducer.id,
					paused: false,
					rtpCapabilities: this.router.rtpCapabilities,
				});

				logger.info(
					`Video transport connected: MediaSoup -> FFmpeg (${transportIp}:${ffmpegVideoPort})`
				);

				await videoConsumer.resume();

				// Request keyframes periodically
				const keyframeInterval = setInterval(async () => {
					if (!videoConsumer.closed) {
						try {
							await videoConsumer.requestKeyFrame();
						} catch (error) {
							logger.warn("Failed to request keyframe:", error);
						}
					} else {
						clearInterval(keyframeInterval);
					}
				}, 2000);

				participantInfoTemp.consumers.video = videoConsumer;
				participantInfoTemp.transports.video = videoTransport;
				participantInfoTemp.ports.video = ffmpegVideoPort;
				participantInfoTemp.ips.video = transportIp;

				const sdp = this.generateSDPForFFmpeg(
					videoConsumer,
					"video",
					ffmpegVideoPort,
					transportIp
				);
				const videoSdpPath = path.join(
					this.outputPath,
					`${participant.socketId}_video.sdp`
				);

				await fs.promises.writeFile(videoSdpPath, sdp);
				participantInfoTemp.videosSdpPath = videoSdpPath;

				logger.info(
					`Video SDP created: ${videoSdpPath} (${transportIp}:${ffmpegVideoPort})`
				);
			}

			if (participant.producers.audioProducer && allocatedPorts?.audio) {
				logger.info(`Creating audio stream for ${participant.socketId}`);

				const audioTransport = await this.getPlainTransport();
				const ffmpegAudioPort = allocatedPorts.audio;
				const transportIp = audioTransport.tuple.localIp;

				await audioTransport.connect({
					ip: transportIp,
					port: ffmpegAudioPort,
					rtcpPort: ffmpegAudioPort + 1,
				});

				const audioConsumer = await audioTransport.consume({
					producerId: participant.producers.audioProducer.id,
					paused: false,
					rtpCapabilities: this.router.rtpCapabilities,
				});

				logger.info(
					`Audio transport connected: MediaSoup -> FFmpeg (${transportIp}:${ffmpegAudioPort})`
				);

				participantInfoTemp.consumers.audio = audioConsumer;
				participantInfoTemp.transports.audio = audioTransport;
				participantInfoTemp.ports.audio = ffmpegAudioPort;
				participantInfoTemp.ips.audio = transportIp;
				await audioConsumer.resume();

				const audioSDP = this.generateSDPForFFmpeg(
					audioConsumer,
					"audio",
					ffmpegAudioPort,
					transportIp
				);
				const audioSDPpath = path.join(
					this.outputPath,
					`${participant.socketId}_audio.sdp`
				);

				await fs.promises.writeFile(audioSDPpath, audioSDP);
				participantInfoTemp.audioSdpPath = audioSDPpath;

				logger.info(
					`Audio SDP created: ${audioSDPpath} (${transportIp}:${ffmpegAudioPort})`
				);
			}

			this.participantInfo.set(participant.socketId, participantInfoTemp);

			logger.info(
				`Successfully set up streams for participant ${participant.socketId}`,
				{
					hasVideo: !!participantInfoTemp.videosSdpPath,
					hasAudio: !!participantInfoTemp.audioSdpPath,
					videoPorts: participantInfoTemp.ports.video,
					audioPorts: participantInfoTemp.ports.audio,
					videoIp: participantInfoTemp.ips.video,
					audioIp: participantInfoTemp.ips.audio,
				}
			);
		} catch (error) {
			logger.error(
				`Failed to setup participant stream for ${participant.socketId}:`,
				error
			);
			// Cleanup partial setup
			if (participantInfoTemp.consumers.video) {
				participantInfoTemp.consumers.video.close();
			}
			if (participantInfoTemp.consumers.audio) {
				participantInfoTemp.consumers.audio.close();
			}
			if (participantInfoTemp.transports.video) {
				participantInfoTemp.transports.video.close();
			}
			if (participantInfoTemp.transports.audio) {
				participantInfoTemp.transports.audio.close();
			}

			// Free up allocated ports on error
			if (allocatedPorts?.video) {
				this.usedPorts.delete(allocatedPorts.video);
				this.usedPorts.delete(allocatedPorts.video + 1);
			}
			if (allocatedPorts?.audio) {
				this.usedPorts.delete(allocatedPorts.audio);
				this.usedPorts.delete(allocatedPorts.audio + 1);
			}

			throw error;
		}
	}

	// Keep the original method for backward compatibility
	async getParticipantStream(participant: participant) {
		return this.getParticipantStreamWithPorts(participant);
	}

	buildVideoFilter(videoInputs: videoInput[]): string {
		const { height, width } = this.videoMixConfig;

		if (videoInputs.length === 1) {
			const input = videoInputs[0];
			return `[${input.index}:v]scale=${width}:${height}[mixed_video]`;
		}

		let filterParts: string[] = [];
		const scaledInputs: (videoInput & { scaledName: string })[] = [];

		// Scale all inputs
		videoInputs.forEach((input) => {
			const { layout, index } = input;
			const scaledName = `scaled${index}`;
			filterParts.push(
				`[${index}:v]scale=${layout.width}:${layout.height}[${scaledName}]`
			);
			scaledInputs.push({
				...input,
				scaledName,
			});
		});

		// Create base canvas
		filterParts.push(`color=black:size=${width}x${height}[base]`);

		// Overlay all inputs
		let currentLayer = "base";
		scaledInputs.forEach((input, i) => {
			const { scaledName, layout } = input;
			const outputLayer =
				i === scaledInputs.length - 1 ? "mixed_video" : `layer_${i}`;
			filterParts.push(
				`[${currentLayer}][${scaledName}]overlay=${layout.x}:${layout.y}[${outputLayer}]`
			);
			currentLayer = outputLayer;
		});

		return filterParts.join(";");
	}

	buildAudioMixer(audioInputs: audioInput[]): string {
		if (audioInputs.length === 1) {
			return `[${audioInputs[0].index}:a]aformat=sample_rates=44100:channel_layouts=stereo[mixed_audio]`;
		}

		const inputMaps = audioInputs.map((input) => `[${input.index}:a]`).join("");
		return `${inputMaps}amix=inputs=${audioInputs.length}:duration=longest[mixed_audio]`;
	}

	ensureDirectoryExists() {
		if (!fs.existsSync(this.outputPath)) {
			logger.info("Creating HLS output folder");
			fs.mkdirSync(this.outputPath, { recursive: true });
		}
	}

	async getPlainTransport() {
		return await this.router.createPlainTransport(config.plainTransport);
	}

	async updateParticipants(participants: participant[]) {
		logger.info("Updating participants, restarting FFmpeg...");

		// Stop current FFmpeg process gracefully
		await this.stopFFmpeg();

		// Clear old participant info but keep transports alive
		// for participants that are still present
		const currentParticipants = new Set(participants.map((p) => p.socketId));

		for (const [id, info] of this.participantInfo) {
			if (!currentParticipants.has(id)) {
				this.removeParticipaint(id);
			}
		}

		// Start new FFmpeg process
		await this.generateFFmpegHLSStream(participants);
	}

	async stopFFmpeg() {
		if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
			logger.info("Stopping FFmpeg process...");

			return new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
						logger.warn("Force killing FFmpeg process");
						this.ffmpegProcess.kill("SIGTERM");
					}
					resolve();
				}, 5000); // Increased timeout

				this.ffmpegProcess!.on("close", () => {
					clearTimeout(timeout);
					this.ffmpegProcess = null;
					resolve();
				});
				if (this.ffmpegProcess) {
					this.ffmpegProcess.kill("SIGTERM");
				}
			});
		}
	}

	async forceCleanup() {
		logger.info("Starting force cleanup process...");

		// Kill FFmpeg process
		await this.stopFFmpeg();

		// Kill any existing FFmpeg processes system-wide
		// await this.killAllFFmpegProcesses();

		// Close all transports and consumers with more thorough cleanup
		for (const [participantId, participantInfo] of this.participantInfo) {
			try {
				// Close consumers first
				if (
					participantInfo.consumers.video &&
					!participantInfo.consumers.video.closed
				) {
					participantInfo.consumers.video.close();
				}
				if (
					participantInfo.consumers.audio &&
					!participantInfo.consumers.audio.closed
				) {
					participantInfo.consumers.audio.close();
				}

				// Wait a bit for consumers to close
				await new Promise((resolve) => setTimeout(resolve, 500));

				// Then close transports
				if (
					participantInfo.transports.video &&
					!participantInfo.transports.video.closed
				) {
					participantInfo.transports.video.close();
				}
				if (
					participantInfo.transports.audio &&
					!participantInfo.transports.audio.closed
				) {
					participantInfo.transports.audio.close();
				}

				logger.debug(`Cleaned up resources for participant ${participantId}`);
			} catch (error) {
				logger.error(
					`Error closing participant resources for ${participantId}:`,
					error
				);
			}
		}

		// Clear participant info and used ports
		this.participantInfo.clear();
		this.usedPorts.clear();

		// Clean up SDP files and segments
		try {
			if (fs.existsSync(this.outputPath)) {
				const files = fs.readdirSync(this.outputPath);
				files.forEach((file) => {
					if (file.endsWith(".sdp")) {
						try {
							fs.unlinkSync(path.join(this.outputPath, file));
						} catch (error) {
							logger.warn(`Failed to delete file ${file}:`, error);
						}
					}
				});
			}
		} catch (error) {
			logger.error("Error cleaning up files:", error);
		}

		logger.info("Force cleanup completed");
	}

	async cleanup() {
		// Stop process monitoring
		if (this.processMonitorInterval) {
			clearInterval(this.processMonitorInterval);
			this.processMonitorInterval = null;
		}

		await this.forceCleanup();
	}

	async removeParticipaint(socketId: string) {
		if (this.participantInfo.has(socketId)) {
			await this.cleanup();
			const data = this.participantInfo.get(socketId);
			try {
				if (data?.consumers.audio && !data.consumers.audio.closed) {
					data.consumers.audio.close();
				}
				if (data?.consumers.video && !data.consumers.video.closed) {
					data.consumers.video.close();
				}
				if (data?.transports.audio && !data.transports.audio.closed) {
					data.transports.audio.close();
				}
				if (data?.transports.video && !data.transports.video.closed) {
					data.transports.video.close();
				}

				// Free up the ports
				if (data?.ports?.video) {
					this.usedPorts.delete(data.ports.video);
					this.usedPorts.delete(data.ports.video + 1);
				}
				if (data?.ports?.audio) {
					this.usedPorts.delete(data.ports.audio);
					this.usedPorts.delete(data.ports.audio + 1);
				}

				// Clean up SDP files
				if (data?.videosSdpPath && fs.existsSync(data.videosSdpPath)) {
					fs.unlinkSync(data.videosSdpPath);
				}
				if (data?.audioSdpPath && fs.existsSync(data.audioSdpPath)) {
					fs.unlinkSync(data.audioSdpPath);
				}
			} catch (error) {
				logger.error(`Error removing participant ${socketId}:`, error);
			}
			this.participantInfo.delete(socketId);
			logger.info(`Participant ${socketId} removed`);
		}
	}
	getLastSegmentNumber(playlistPath: string) {
		try {
			const output = execSync(
				`grep -o 'segment_[0-9]*\\.ts' ${playlistPath} | sed 's/[^0-9]//g' | tail -1`
			);
			const lastSegment = parseInt(output.toString().trim(), 10);
			return isNaN(lastSegment) ? 0 : lastSegment;
		} catch (err: any) {
			logger.error("Error reading playlist:", err.message);
			return 0;
		}
	}
}
