import { types as mediasoupTypes } from "mediasoup";
import { Peer } from "../lib/peer.js";
import { MultiStreamHLSMixer } from "./multiStreamHLSMixer.js";
import logger from "../utlis/logger.js";

export class StreamService {
	router: mediasoupTypes.Router;
	peers: Map<string, Peer>;
	static participaintsMap = new Map<string, participantInfo>();
	HLSMixer: MultiStreamHLSMixer | null;
	private restartTimeout: NodeJS.Timeout | null = null;
	static HLSStreamStartCounter = 0;
	transport: mediasoupTypes.PlainTransport | null;

	constructor({ router, peers }: StreamServiceInterface) {
		this.router = router;
		this.peers = peers;
		this.HLSMixer = null;
		this.transport = null;
	}

	async initailize() {
		logger.info("Stream Servie initialized");

		this.HLSMixer = new MultiStreamHLSMixer(this.router);
	}

	async addParitipaint(socketId: string) {
		const data = this.peers.get(socketId);
		logger.info("Adding participaint to stream service");
		if (!data) return;
		// Make sure both audio and video is coming
		if (Array.from(data?.getProducers()).length < 1) return;
		let audioProducer: mediasoupTypes.Producer;
		let videoProducer: mediasoupTypes.Producer;
		for (let p of data?.getProducers()!) {
			if (p.kind == "audio") {
				audioProducer = p;
			} else {
				videoProducer = p;
			}
		}
		// Adding Prticipaint
		StreamService.participaintsMap.set(socketId, {
			id: socketId,
			consumers: {},
			ips: {},
			ports: {},
			transports: {},
			producers: {
				audioProducer: audioProducer!,
				videoProducer: videoProducer!,
			},
		});
		if (this.restartTimeout) {
			clearTimeout(this.restartTimeout);
		}
		StreamService.HLSStreamStartCounter++;
		this.restartTimeout = setTimeout(async () => {
			await this.startHLSStream(StreamService.HLSStreamStartCounter);
			this.restartTimeout = null;
		}, 5000);
	}

	async removeParticipaint(socketId: string) {
		if (!StreamService.participaintsMap.has(socketId)) {
			logger.warn("While removing participaint socketId not found");
			return;
		} else if (
			!StreamService.participaintsMap.get(socketId)?.producers.audioProducer
				.closed ||
			!StreamService.participaintsMap.get(socketId)?.producers.videoProducer
				.closed
		) {
			return;
		}

		if (this.restartTimeout) {
			clearTimeout(this.restartTimeout);
		}
		StreamService.HLSStreamStartCounter++;
		await this.HLSMixer?.removeParticipaint(socketId);

		this.restartTimeout = setTimeout(async () => {
			await this.startHLSStream(StreamService.HLSStreamStartCounter);
			this.restartTimeout = null;
		}, 5000);
	}

	private async startHLSStream(startCounter: number) {
		logger.info("Participaint info start, about to add layout");
		logger.info("Paritipaint Map", [
			...StreamService.participaintsMap.entries(),
		]);
		await this.killFFmegProcss();

		const len = StreamService.participaintsMap.size;
		if (len == 0) {
			return;
		}
		let index = 0;
		// Generating all participaints again with new layout
		StreamService.participaintsMap.forEach((value) => {
			value.layout = this.getLayoutOfCurrentStream({
				numberOfParticipaint: len,
				index,
			});
			index++;
		});
		// Checking if new process start request already come
		if (StreamService.HLSStreamStartCounter > startCounter) return;
		await this.HLSMixer?.generateFFmpegHLSStream(
			StreamService.participaintsMap,
			startCounter
		);
	}

	private async killFFmegProcss() {
		if (this.HLSMixer?.ffmpegProcess) {
			logger.info("Closing the FFmpeg Server");
			this.HLSMixer.stopFFmpeg();
			await new Promise((resolve) => setTimeout(resolve, 10000));
		}
	}
	// Close all transport and stream
	async cleanup() {
		await this.HLSMixer?.cleanup();
	}

	private getLayoutOfCurrentStream({
		numberOfParticipaint,
		index,
	}: {
		numberOfParticipaint: number;
		index: number;
	}) {
		const cols = Math.ceil(Math.sqrt(numberOfParticipaint));
		const rows = Math.ceil(numberOfParticipaint / cols);

		const cellWidth = 1920 / cols;
		const cellHeight = 1080 / rows;

		const row = Math.floor(index / cols);
		const col = index % cols;

		return {
			x: col * cellWidth,
			y: row * cellHeight,
			width: cellWidth,
			height: cellHeight,
		};
	}
}

interface StreamServiceInterface {
	router: mediasoupTypes.Router;
	peers: Map<string, Peer>;
}

export interface participantInfo {
	id: string;
	layout?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	consumers: {
		video?: mediasoupTypes.Consumer;
		audio?: mediasoupTypes.Consumer;
	};
	transports: {
		video?: mediasoupTypes.PlainTransport;
		audio?: mediasoupTypes.PlainTransport;
	};
	producers: {
		audioProducer: mediasoupTypes.Producer;
		videoProducer: mediasoupTypes.Producer;
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
