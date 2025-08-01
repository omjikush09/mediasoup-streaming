import express from "express";
import { Server } from "socket.io";
import http from "http";
import cors from "cors";
import { config } from "./config/mediasoup";
import { MediasoupService } from "./services/mediasoupService";
import { Peer } from "./lib/peer";
import logger from "./utlis/logger";
import { StreamService } from "./services/streamService";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename).split("/").slice(0, -1).join("/");
dotenv.config({});
const app = express();
app.use(cors());
app.use(express.json({}));
app.use(express.urlencoded({ extended: true }));

console.log(path.join(__dirname, config.outputPath));

app.use(
	"/hls",
	express.static(path.join(__dirname, config.outputPath), {
		setHeaders(res, filePath) {
			if (filePath.endsWith(".m3u8")) {
				res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
				res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
				res.setHeader("Pragma", "no-cache");
				res.setHeader("Expires", "0");
			} else if (filePath.endsWith(".ts")) {
				res.setHeader("Content-Type", "video/MP2T");
				res.setHeader("Cache-Control", "no-cache, must-revalidate");
			}
		},
	})
);

app.get("/", (req, res) => {
	res.json({
		message: "Hello",
	});
});

const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: process.env.CLIENT_URL,
		methods: ["GET", "POST"],
		credentials: true,
	},
});

const peerMap = new Map<string, Peer>();

let mediasoupService: MediasoupService | null = null;
let stream: StreamService;
async function startMediasoup() {
	mediasoupService = new MediasoupService();
	const router = await mediasoupService.start();
	stream = new StreamService({ router, peers: peerMap });
	await stream.initailize();
}

startMediasoup();
io.on("connection", (socket) => {
	console.log("CONNECTED");
	console.log(socket.id);
	const peer = new Peer(socket.id);
	peerMap.set(socket.id, peer);

	socket.on("existingProducers", async (callback) => {
		const producers = mediasoupService?.getProducers() || [];
		logger.info(producers + " producers");

		logger.info("Sending Existing connections");
		socket.emit("exitingProducers", producers);

		callback(producers);
	});

	socket.on("getRouterRTPCapabilities", async (callback) => {
		logger.info("GET ROUTER RTP CAPABILITIES");
		// console.log(mediasoupService?.router?.rtpCapabilities);
		console.log(callback);
		callback(mediasoupService?.getRouterRtpCapabilities());
	});

	socket.on("createWebRTCTransport", async (callback) => {
		logger.info("createWebRTCTransprot ");
		const transport = await mediasoupService?.createWebRtcTransport();
		if (!transport) {
			logger.error("Failed to create WebRTC transport");
			return;
		}
		const peer = peerMap.get(socket.id);
		if (!peer) {
			logger.error("Peer not found for socket:", socket.id);
			return;
		}
		peer.addTransporte(transport.id, transport);
		transport.on("dtlsstatechange", (dtlsState) => {
			if (dtlsState === "closed") {
				console.log(
					`[${socket.id}] Transport DTLS closed [transportId:${transport.id}]`
				);
				transport.close();
				peerMap.get(socket.id)?.transport.delete(transport.id);
			}
		});
		logger.info("ENV " + process.env.EXTERNAL_IP);
		callback({
			id: transport?.id,
			iceParameters: transport?.iceParameters,
			iceCandidates: transport?.iceCandidates,
			dtlsParameters: transport?.dtlsParameters,
		});
	});

	socket.on(
		"connectWebRTCTransport",
		async ({ transportId, dtlsParameters }, callback) => {
			const peer = peerMap.get(socket.id);
			if (!peer) {
				logger.error("Peer not found for socket:", socket.id);
				return;
			}
			const transport = peer.getTransport(transportId);
			if (!transport) {
				logger.error("Transport not found for ID:", transportId);
				return;
			}
			await transport.connect({ dtlsParameters: dtlsParameters });
			callback({ status: "ok" });
		}
	);

	socket.on(
		"produce",
		async ({ transportId, kind, rtpParameters }, callback) => {
			const peer = peerMap.get(socket.id);
			logger.info("Produce socket called" + transportId + rtpParameters);
			if (!peer) {
				logger.error("Peer not found for socket:", socket.id);
				return;
			}
			const transport = peer.getTransport(transportId);
			if (!transport) {
				logger.error("Transport not found for ID:", transportId);
				return;
			}

			const producer = await transport.produce({
				kind: kind,
				rtpParameters: {
					...rtpParameters,
					encodings: [
						{
							...rtpParameters.encodings[0],
							maxFramerate: 30,
						},
					],
				},
			});
			peer.addProducer(producer.id, producer);
			mediasoupService?.addProducer(producer.id);
			callback({
				id: producer.id,
			});
			if ([...peer.getProducers()].length >= 2) {
				await stream.addParitipaint(socket.id);
			}
			socket.broadcast.emit("newProducer", {
				producerId: producer.id,
				kind: producer.kind,
				appData: producer.appData,
			});
			producer.on("transportclose", async () => {
				console.log(
					`[${socket.id}] Producer transport closed [producerId:${producer.id}]`
				);
				mediasoupService?.removeProducer(producer.id);
				peer.removeProducer(producer.id);
			});
			producer.observer.on("close", async () => {
				console.log(`[${socket.id}] Producer is closed `);
				// Remove from HLS stream
				await stream.removeParticipaint(socket.id);
			});
		}
	);

	socket.on(
		"consume",
		async ({ transportId, producerId, rtpCapabilities }, callback) => {
			const peer = peerMap.get(socket.id);
			if (!peer) {
				logger.error("Peer not found for socket:", socket.id);
				return;
			}
			const transport = peer.getTransport(transportId);
			if (!transport) {
				logger.error("Transport not found for ID:", transportId);
				return;
			}
			const canConsumer = mediasoupService?.router?.canConsume({
				producerId,
				rtpCapabilities: rtpCapabilities,
			});
			logger.info(" Can consumer " + canConsumer);
			if (mediasoupService?.router?.rtpCapabilities === undefined) {
				logger.error("Router RTP capabilities are not initialized");
				return;
			}
			const consumer = await transport.consume({
				producerId: producerId,
				rtpCapabilities: rtpCapabilities,
				paused: true,
			});
			if (!consumer) {
				logger.error("Failed to create consumer for producer ID:", producerId);
				return;
			}
			consumer.on("transportclose", () => {
				console.log(
					`[${socket.id}] Consumer transport closed [consumerId:${consumer.id}]`
				);
				peer.removeConsumer(consumer.id);
			});
			consumer.on("producerclose", () => {
				console.log(
					`[${socket.id}] Consumer producer closed [consumerId:${consumer.id}]`
				);
				consumer.close();
				peer.removeConsumer(consumer.id);
			});
			logger.info("consume is emited");
			peer.addConsumer(consumer.id, consumer);
			callback({
				consumerId: consumer.id,
				producerId: consumer.producerId,
				rtpParameters: consumer.rtpParameters,
				kind: consumer.kind,
				appData: consumer.appData,
			});
		}
	);

	socket.on("resumeConsumer", async ({ consumerId }, callback) => {
		const peer = peerMap.get(socket.id);
		if (!peer) {
			logger.error("Peer not found for socket:", socket.id);
			return;
		}
		const consumer = peer.getConsumer(consumerId);
		if (!consumer) {
			logger.error("Consumer not found for ID:", consumerId);
			return;
		}
		logger.info(consumer.paused + " is consumer pasued");
		if (consumer.paused) {
			await consumer.resume();
			logger.info(
				`Consumer resumed [consumerId:${consumer.id}] for socket [${socket.id}]`
			);
			callback({ status: "ok" });
		} else {
			logger.warn(
				`Consumer already resumed [consumerId:${consumer.id}] for socket [${socket.id}]`
			);
			callback({ status: "already_resumed" });
		}
	});

	socket.on("disconnect", async () => {
		console.log("DISCONNECT");
		const peer = peerMap.get(socket.id);
		if (!peer) {
			console.log("Peer not found for socket:", socket.id);
			return;
		}
		// Clean up transports, producers, and consumers for the peer
		peer.transport.forEach((transport) => {
			transport.close();
		});
		peer.producer.forEach((producer) => {
			producer.close();
		});

		peer.consumer.forEach((consumer) => {
			consumer.close();
		});
		peerMap.delete(socket.id);
	});
});

const close = async () => {
	logger.warn("STARTING THE CLEANUP");
	io.close();
	await stream.cleanup();
	mediasoupService?.router?.close();
	mediasoupService?.worker?.close();
	process.exit(0);
};

process.on("SIGINT", async () => {
	await close();
});

process.on("SIGTERM", async () => {
	await close();
});

const port = Number(process.env.PORT) || 8000;

server.listen(port, () => {
	logger.info(`Server is starting ${port}`);
});
