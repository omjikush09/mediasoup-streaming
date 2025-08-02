import logger from "../utlis/logger.js";
import { types as mediaSoupTypes } from "mediasoup";
import fs from "fs";
import path from "path";
import { participantInfo, StreamService } from "./streamService.js";
import { PortManager } from "./PortManager.js";
import { config } from "./../config/mediasoup.js";
import { fileExistsAsync } from "../utlis/fileSystem.js";

export class SDPService {
	private router: mediaSoupTypes.Router;
	portManager: PortManager;
	constructor(router: mediaSoupTypes.Router) {
		this.router = router;
		this.portManager = PortManager.getInstance();
	}
	async generateSDP() {
		logger.info("SGENERSTE SDP is called");
		await this.portManager.allocatePort();
		let promises: Promise<void>[] = [];
		StreamService.participaintsMap.forEach((value) => {
			if (value.audioSdpPath && value.videosSdpPath) return;
			promises.push(this.getParticipantStreamWithPorts(value));
		});
		try {
			await Promise.all(promises);
		} catch (error: unknown) {
			if (error instanceof Error) {
				logger.error(error.message);
			}
			throw error;
		}
	}

	private async getParticipantStreamWithPorts(
		participantInfo: participantInfo
	) {
		logger.info(`Setting up streams for participant ${participantInfo.id}`, {
			hasVideoProducer: !!participantInfo.producers.videoProducer,
			hasAudioProducer: !!participantInfo.producers.audioProducer,
			ports: participantInfo?.ports,
			closedProdcuer: !participantInfo.producers.videoProducer.closed,
		});

		try {
			if (
				participantInfo.producers.videoProducer &&
				participantInfo?.ports?.video &&
				!participantInfo.producers.videoProducer.closed
			) {
				logger.info(`Creating video stream for ${participantInfo.id}`);

				const videoTransport = await this.getPlainTransport();
				const ffmpegVideoPort = participantInfo?.ports?.video;
				const transportIp = videoTransport.tuple.localIp;

				await videoTransport.connect({
					ip: transportIp,
					port: ffmpegVideoPort,
					rtcpPort: ffmpegVideoPort + 1,
				});

				const videoConsumer = await videoTransport.consume({
					producerId: participantInfo.producers.videoProducer.id,
					paused: false,
					rtpCapabilities: this.router.rtpCapabilities,
				});

				logger.info(
					`Video transport connected: MediaSoup -> FFmpeg (${transportIp}:${ffmpegVideoPort})`
				);

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

				participantInfo.consumers.video = videoConsumer;
				participantInfo.transports.video = videoTransport;
				participantInfo.ports.video = ffmpegVideoPort;
				participantInfo.ips.video = transportIp;

				const sdp = this.generateSDPForFFmpeg(
					videoConsumer,
					"video",
					ffmpegVideoPort,
					transportIp
				);
				const videoSdpPath = path.join(
					config.outputPath,
					this.getSDPFileName(participantInfo.id, "video")
				);

				await fs.promises.writeFile(videoSdpPath, sdp);
				participantInfo.videosSdpPath = videoSdpPath;

				logger.info(
					`Video SDP created: ${videoSdpPath} (${transportIp}:${ffmpegVideoPort})`
				);
			} else {
				logger.info("Failed to created SDP  check above log", {
					participantId: participantInfo.id,
				});
			}

			if (
				participantInfo.producers.audioProducer &&
				participantInfo.ports?.audio &&
				!participantInfo.producers.audioProducer.closed
			) {
				logger.info(`Creating audio stream for ${participantInfo.id}`);

				const audioTransport = await this.getPlainTransport();
				const ffmpegAudioPort = participantInfo.ports.audio;
				const transportIp = audioTransport.tuple.localIp;

				await audioTransport.connect({
					ip: transportIp,
					port: ffmpegAudioPort,
					rtcpPort: ffmpegAudioPort + 1,
				});

				const audioConsumer = await audioTransport.consume({
					producerId: participantInfo.producers.audioProducer.id,
					paused: false,
					rtpCapabilities: this.router.rtpCapabilities,
				});

				logger.info(
					`Audio transport connected: MediaSoup -> FFmpeg (${transportIp}:${ffmpegAudioPort})`
				);

				participantInfo.consumers.audio = audioConsumer;
				participantInfo.transports.audio = audioTransport;
				participantInfo.ports.audio = ffmpegAudioPort;
				participantInfo.ips.audio = transportIp;

				const audioSDP = this.generateSDPForFFmpeg(
					audioConsumer,
					"audio",
					ffmpegAudioPort,
					transportIp
				);
				const audioSDPpath = path.join(
					config.outputPath,
					this.getSDPFileName(participantInfo.id, "audio")
				);
				await fs.promises.writeFile(audioSDPpath, audioSDP);
				participantInfo.audioSdpPath = audioSDPpath;

				logger.info(
					`Audio SDP created: ${audioSDPpath} (${transportIp}:${ffmpegAudioPort})`
				);
			}
		} catch (error) {
			logger.error(
				`Failed to setup participant stream for ${participantInfo.id}:`,
				error
			);
			// Cleanup partial setup
			if (participantInfo.consumers.video) {
				participantInfo.consumers.video.close();
			}
			if (participantInfo.consumers.audio) {
				participantInfo.consumers.audio.close();
			}
			if (participantInfo.transports.video) {
				participantInfo.transports.video.close();
			}
			if (participantInfo.transports.audio) {
				participantInfo.transports.audio.close();
			}

			// Free up allocated ports on error
			if (participantInfo.ports?.video) {
				PortManager.usedPorts.delete(participantInfo.ports.video);
				PortManager.usedPorts.delete(participantInfo.ports.video + 1);
			}
			if (participantInfo.ports.audio) {
				PortManager.usedPorts.delete(participantInfo.ports.audio);
				PortManager.usedPorts.delete(participantInfo.ports.audio + 1);
			}

			throw error;
		}
	}

	private generateSDPForFFmpeg(
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

	private async getPlainTransport() {
		return await this.router.createPlainTransport(config.plainTransport);
	}

	async removeSDPFiles(participaintInfo?: participantInfo) {
		if (participaintInfo) {
			try {
				if (
					participaintInfo.audioSdpPath &&
					(await fileExistsAsync(participaintInfo.audioSdpPath))
				) {
					await fs.promises.unlink(participaintInfo.audioSdpPath);
					participaintInfo.audioSdpPath = undefined;
				}
				if (
					participaintInfo.videosSdpPath &&
					(await fileExistsAsync(participaintInfo.videosSdpPath))
				) {
					await fs.promises.unlink(participaintInfo.videosSdpPath);
					participaintInfo.videosSdpPath = undefined;
				}
			} catch (error) {
				logger.error("Error cleaning up files:", error);
			}
		} else {
			try {
				if (await fileExistsAsync(config.outputPath)) {
					const files = await fs.promises.readdir(config.outputPath);
					files.forEach(async (file) => {
						if (file.endsWith(".sdp")) {
							try {
								await fs.promises.unlink(path.join(config.outputPath, file));
							} catch (error) {
								logger.warn(`Failed to delete file ${file}:`, error);
							}
						}
					});
				}
			} catch (error) {
				logger.error("Error cleaning up files:", error);
			}
		}
	}

	getSDPFileName(
		participantId: string,
		type: mediaSoupTypes.MediaKind
	): string {
		if (type == "audio") {
			return `${participantId}_audio.sdp`;
		}
		return `${participantId}_video.sdp`;
	}
}
