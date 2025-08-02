import { types as mediaSoupTypes } from "mediasoup";
import path from "path";
import * as fs from "fs";
import { ChildProcess, exec, spawn } from "child_process";
import logger from "../utlis/logger.js";
import { promisify } from "node:util";
import { fileExistsAsync } from "../utlis/fileSystem.js";
import { PortManager } from "./PortManager.js";
import { participantInfo, StreamService } from "./streamService.js";
import { SDPService } from "./SDPService.js";
import { config } from "../config/mediasoup.js";

const execAsync = promisify(exec);

export type videoInput = {
	index: number;
	participantId: string;
	layout: participantInfo["layout"];
};

export type audioInput = {
	index: number;
	participantId: string;
};

export class MultiStreamHLSMixer {
	router: mediaSoupTypes.Router;
	// participantInfo = new Map<string, participantInfo>();
	segmentDuration = 4;
	playlistSize = 10;
	outputPath: string;
	videoMixConfig;
	ffmpegProcess: ChildProcess | null;
	isRestarting = false;
	processMonitorInterval: NodeJS.Timeout | null = null;
	numberOFparticipantAtStart = 0;

	SDPService: SDPService;
	constructor(router: mediaSoupTypes.Router) {
		this.router = router;
		this.outputPath = config.outputPath;
		this.videoMixConfig = {
			width: 1920,
			height: 1080,
			fps: 30,
			bitrate: "2000k",
		};

		this.ffmpegProcess = null;
		this.ensureDirectoryExists();
		// this.startProcessMonitoring();
		this.SDPService = new SDPService(router);
	}

	async generateFFmpegHLSStream(
		participants: Map<string, participantInfo>,
		startCounter: number
	) {
		try {
			// Prevent multiple simultaneous restarts

			if (this.isRestarting) {
				logger.warn("FFmpeg restart already in progress, skipping...");
				return;
			}

			await this.SDPService.generateSDP();
			if (StreamService.HLSStreamStartCounter > startCounter) return;
			const playlistPath = path.join(this.outputPath, "playlist.m3u8");
			const segmentPath = path.join(this.outputPath, "segment_%03d.ts");

			logger.info("Waiting for ports to be fully released...");
			// await new Promise((resolve) => setTimeout(resolve, 8000)); // Increased to 8 seconds

			logger.info("Pre-allocating ports for all participants...");

			// Wait for streams to become stable
			logger.info("Waiting for streams to stabilize...");
			// await new Promise((resolve) => setTimeout(resolve, 5000)); // Increased wait time

			let ffmpegArgs: string[] = ["-v", "debug"];

			const videoInputs: videoInput[] = [];
			const audioInputs: audioInput[] = [];
			let inputIndex = 0;

			// Prepare inputs - only add valid SDP files
			for (const [
				participantId,
				participantInfo,
			] of StreamService.participaintsMap) {
				if (
					participantInfo.videosSdpPath &&
					(await fileExistsAsync(participantInfo.videosSdpPath))
				) {
					ffmpegArgs.push(
						"-protocol_whitelist",
						"file,rtp,udp",
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
					(await fileExistsAsync(participantInfo.audioSdpPath))
				) {
					ffmpegArgs.push(
						"-protocol_whitelist",
						"file,rtp,udp",
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

			const playlistExists = await fileExistsAsync(playlistPath);

			const hlsFlags = playlistExists
				? "delete_segments+independent_segments+omit_endlist+append_list+round_durations+discont_start"
				: "delete_segments+independent_segments+omit_endlist+round_durations+discont_start";

			logger.info("Playlist Exist " + playlistExists);

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
			logger.warn(
				"About to start process counter " + StreamService.HLSStreamStartCounter
			);
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
			await this.cleanup();
			throw error;
		}
	}

	private async startFFmpegProcess(
		ffmpegArgs: string[]
	): Promise<{ success: boolean; error?: string }> {
		return new Promise((resolve) => {
			const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
				stdio: ["pipe", "pipe", "pipe"],
			});

			let ffmpegStarted = false;
			let errorOutput = "";

			const timeout = setTimeout(() => {
				if (!ffmpegStarted) {
					ffmpeg.kill("SIGTERM");
					resolve({ success: false, error: "FFmpeg startup timeout" });
				}
			}, 15000); // 15 second timeout

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
				`[${index}:v]scale=${layout?.width}:${layout?.height}[${scaledName}]`
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
				`[${currentLayer}][${scaledName}]overlay=${layout?.x}:${layout?.y}[${outputLayer}]`
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

	async ensureDirectoryExists() {
		if (!(await fileExistsAsync(this.outputPath))) {
			logger.info("Creating HLS output folder");
			await fs.promises.mkdir(this.outputPath, { recursive: true });
		}
	}

	async stopFFmpeg() {
		if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
			logger.info("Stopping FFmpeg process...");

			return new Promise<void>(async (resolve) => {
				const timeout = setInterval(() => {
					if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
						this.ffmpegProcess.kill("SIGKILL");
					}
					logger.info("KILL FFMPEG INTERWAL");
					resolve();
				}, 5000); // 10 Second

				this.ffmpegProcess!.on("close", () => {
					clearTimeout(timeout);
					this.ffmpegProcess = null;
					resolve();
				});
				if (this.ffmpegProcess) {
					this.ffmpegProcess.kill("SIGTERM");
					//Wait the process to be kill and port to be released
					await new Promise<void>((resolve) =>
						setTimeout(() => {
							resolve();
						}, 8000)
					);
				}
			});
		}
	}

	async cleanup() {
		// Stop process monitoring
		await this.stopFFmpeg();

		if (this.processMonitorInterval) {
			clearInterval(this.processMonitorInterval);
			this.processMonitorInterval = null;
		}

		logger.info("Starting  cleanup process...");

		for (const [
			participantId,
			participantInfo,
		] of StreamService.participaintsMap) {
			try {
				await this.closeParticipaintTransportAndConsumer(participantId);

				logger.debug(`Cleaned up resources for participant ${participantId}`);
			} catch (error) {
				logger.error(
					`Error closing participant resources for ${participantId}:`,
					error
				);
			}
		}

		// Clear participant info and used ports
		StreamService.participaintsMap.clear();
		PortManager.usedPorts.clear();

		// Clean up SDP files
		await this.SDPService.removeSDPFiles();

		logger.info(" cleanup completed");
	}

	async removeParticipaint(socketId: string) {
		if (StreamService.participaintsMap.has(socketId)) {
			const data = StreamService.participaintsMap.get(socketId);
			try {
				this.closeParticipaintTransportAndConsumer(socketId);

				// Free up the ports
				if (data?.ports?.video) {
					PortManager.usedPorts.delete(data.ports.video);
					PortManager.usedPorts.delete(data.ports.video + 1);
				}
				if (data?.ports?.audio) {
					PortManager.usedPorts.delete(data.ports.audio);
					PortManager.usedPorts.delete(data.ports.audio + 1);
				}

				// Clean up SDP files
				await this.SDPService.removeSDPFiles(data);
			} catch (error) {
				logger.error(`Error removing participant ${socketId}:`, error);
			}
			StreamService.participaintsMap.delete(socketId);
			if (this.ffmpegProcess) {
				await this.stopFFmpeg(); // Stop so that FFmpeg does not throw error that packet's are not coming
			}
			logger.info(`Participant ${socketId} removed`);
		}
	}

	private async closeParticipaintTransportAndConsumer(socketId: string) {
		if (StreamService.participaintsMap.has(socketId)) {
			const data = StreamService.participaintsMap.get(socketId);

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
		}
	}
}
