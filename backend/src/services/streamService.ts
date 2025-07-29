import { types as mediaSoupTypes } from "mediasoup";
import { Peer } from "../lib/peer";
import { MultiStreamHLSMixer, participant } from "./multiStreamHLSMixer";
import { config } from "../config/mediasoup";
import logger from "../utlis/logger";

interface StreamServiceInterface {
	router: mediaSoupTypes.Router;
	peers: Map<string, Peer>;
}

export class StreamService {
	router: mediaSoupTypes.Router;
	peers: Map<string, Peer>;
	static participaint: string[] = [];
	HLSMixer: MultiStreamHLSMixer | null;
	private restartTimeout: NodeJS.Timeout | null = null;
	private isRestarting = false;
	transport: mediaSoupTypes.PlainTransport | null;
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
		StreamService.participaint.push(socketId);
		if (this.restartTimeout) {
			clearTimeout(this.restartTimeout);
		}

		this.restartTimeout = setTimeout(async () => {
			await this.startHLSStream();
			this.restartTimeout = null;
		}, 15000);
	}

	async startHLSStream() {
		logger.info("Participaint info");
		logger.info(StreamService.participaint.length);
		await this.killFFmegProcss();

		const len = StreamService.participaint.length;
		if (len == 0) {
			return;
		}
		// Generating all participaints again with new layout
		const participantsWithLayout: participant[] =
			StreamService.participaint.map((id, index) => {
				const data = this.peers.get(id);

				let info: participant = {
					socketId: id,
					producers: {},
					position: this.getLayoutOfCurrentStream({
						numberOfParticipaint: len,
						index,
					}),
				};
				for (let p of data?.getProducers()!) {
					if (p.kind == "audio") {
						info.producers.audioProducer = p;
					} else {
						info.producers.videoProducer = p;
					}
				}
				return info;
			});
		await this.HLSMixer?.generateFFmpegHLSStream(participantsWithLayout);
	}

	async removeParticipaint(socketId: string) {
		if (!StreamService.participaint.includes(socketId)) return;
		StreamService.filterParticipaint(socketId);
		if (this.restartTimeout) {
			clearTimeout(this.restartTimeout);
		}
		await this.HLSMixer?.removeParticipaint(socketId);

		this.restartTimeout = setTimeout(async () => {
			await this.startHLSStream();
			this.restartTimeout = null;
		}, 15000);
	}
	static filterParticipaint(socketId: string) {
		StreamService.participaint = StreamService.participaint.filter((value) => {
			return socketId != value;
		});
		logger.info("Filtering Partiipant");
		logger.info(StreamService.participaint);
	}

	async killFFmegProcss() {
		if (this.HLSMixer?.ffmpegProcess) {
			logger.info("Closing the FFmpeg Server");
			this.HLSMixer.cleanup();
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}

	getLayoutOfCurrentStream({
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
