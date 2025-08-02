import { types as mediasoupTypes, createWorker } from "mediasoup";

import { config } from "../config/mediasoup.js";
import { StreamService } from "./streamService.js";
import logger from "../utlis/logger.js";

export class MediasoupService {
	worker: mediasoupTypes.Worker | null;
	router: mediasoupTypes.Router | null;
	webRtcServer: mediasoupTypes.WebRtcServer | null;
	producers: string[];
	constructor() {
		this.worker = null;
		this.router = null;
		this.producers = [];
		this.webRtcServer = null;
	}

	async start() {
		try {
			logger.info("Starting mediasoup");
			this.worker = await createWorker({
				logLevel: config.worker.logLevel,
				logTags: config.worker.logTags,
				rtcMinPort: config.worker.rtcMinPort,
				rtcMaxPort: config.worker.rtcMaxPort,
			});

			logger.info("mediasoup worker created");

			this.worker.on("died", () => {
				logger.error("mediasoup worker died, exiting in 2 seconds...");
				setTimeout(() => process.exit(1), 2000);
			});
			this.router = await this.worker.createRouter({
				mediaCodecs: config.router.mediaCodecs,
			});
			this.webRtcServer = await this.createWebRtcServer();
			return this.router;
		} catch (error) {
			logger.error("Error creating mediasoup worker:", error);
			throw error;
		}
	}

	async createWebRtcServer() {
		if (!this.worker) {
			logger.error("Mediasoup worker is not initialized");
			throw new Error("Mediasoup worker is not initialized");
		}
		try {
			const webRtcServer = await this.worker.createWebRtcServer({
				listenInfos: config.webRTCServer.listenInfos,
			});
			logger.info("WebRTC server created successfully");
			return webRtcServer;
		} catch (error) {
			logger.error("Error creating WebRTC server:", error);
			throw error;
		}
	}

	async createWebRtcTransport() {
		if (!this.router) {
			logger.error("Mediasoup router is not initialized");
			throw new Error("Mediasoup router is not initialized");
		}

		try {
			const transport = await this.router.createWebRtcTransport({
				webRtcServer: this.webRtcServer!,  // IT will be initilaized in start
			});
			return transport;
		} catch (error) {
			logger.error("Error creating WebRTC transport:", error);
			throw error;
		}
	}

	getRouterRtpCapabilities() {
		if (!this.router) {
			logger.error("Mediasoup router is not initialized");
			throw new Error("Mediasoup router is not initialized");
		}
		return this.router.rtpCapabilities;
	}
	getProducers() {
		return this.producers;
	}
	addProducer(producerId: string) {
		this.producers.push(producerId);
	}
	removeProducer(producerId: string) {
		const index = this.producers.indexOf(producerId);
		if (index > -1) {
			this.producers.splice(index, 1);
		} else {
			logger.warn(`Producer with ID ${producerId} not found`);
		}
	}
}
