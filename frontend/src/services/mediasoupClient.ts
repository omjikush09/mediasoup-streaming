import * as mediasoupClient from "mediasoup-client";
import {
	WebRTCTransportData,
	ConsumeRequest,
	ConsumeResponse,
	ProduceRequest,
	ProduceResponse,
	ConnectTransportRequest,
	ConnectTransportResponse,
} from "../types/mediasoupe";
import { socketEmit } from "@/util/socket";

class MediasoupClientService {
	private device: mediasoupClient.Device | null = null;
	private sendTransport: mediasoupClient.types.Transport | null = null;
	private recvTransport: mediasoupClient.types.Transport | null = null;
	private producers = new Map<string, mediasoupClient.types.Producer>();
	private consumers = new Map<string, mediasoupClient.types.Consumer>();
	public isConnected = false;

	async initialize(
		routerRtpCapabilities: mediasoupClient.types.RtpCapabilities
	): Promise<boolean> {
		try {
			this.device = new mediasoupClient.Device();
			await this.device.load({ routerRtpCapabilities });
			this.isConnected = true;
			return true;
		} catch (error) {
			console.error("Failed to initialize mediasoup device:", error);
			throw error;
		}
	}

	async createSendTransport(
		transportData: WebRTCTransportData
	): Promise<mediasoupClient.types.Transport> {
		if (!this.device) {
			throw new Error("Device not initialized");
		}

		this.sendTransport = this.device.createSendTransport(transportData);

		this.sendTransport.on(
			"connect",
			async (
				{
					dtlsParameters,
				}: { dtlsParameters: mediasoupClient.types.DtlsParameters },
				callback: () => void,
				errback: (error: Error) => void
			) => {
				try {
					console.log(dtlsParameters);
					const response = await socketEmit<ConnectTransportResponse>(
						"connectWebRTCTransport",
						{
							transportId: transportData.id,
							dtlsParameters,
						} as ConnectTransportRequest
					);

					if (response.status === "ok") {
						callback();
					} else {
						errback(new Error("Failed to connect transport"));
					}
				} catch (error) {
					errback(error as Error);
				}
			}
		);

		this.sendTransport.on(
			"produce",
			async (
				parameters: {
					kind: mediasoupClient.types.MediaKind;
					rtpParameters: mediasoupClient.types.RtpParameters;
				},
				callback: (response: { id: string }) => void,
				errback: (error: Error) => void
			) => {
				try {
					console.log({
						transportId: transportData.id,
						kind: parameters.kind,
						rtpParameters: parameters.rtpParameters,
					});
					const response = await socketEmit<ProduceResponse>("produce", {
						transportId: transportData.id,
						kind: parameters.kind,
						rtpParameters: parameters.rtpParameters,
					} as ProduceRequest);

					callback({ id: response.id });
				} catch (error) {
					errback(new Error("Failed to produce media "+error));
				}
			}
		);

		return this.sendTransport;
	}

	async createRecvTransport(
		transportData: WebRTCTransportData
	): Promise<mediasoupClient.types.Transport> {
		if (!this.device) {
			throw new Error("Device not initialized");
		}

		this.recvTransport = this.device.createRecvTransport(transportData);

		this.recvTransport.on(
			"connect",
			async (
				{
					dtlsParameters,
				}: { dtlsParameters: mediasoupClient.types.DtlsParameters },
				callback: () => void,
				errback: (error: Error) => void
			) => {
				try {
					const response = await socketEmit<ConnectTransportResponse>(
						"connectWebRTCTransport",
						{
							transportId: transportData.id,
							dtlsParameters,
						} as ConnectTransportRequest
					);

					if (response.status === "ok") {
						callback();
					} else {
						errback(new Error("Failed to connect recv transport"));
					}
				} catch (error) {
					errback(error as Error);
				}
			}
		);

		return this.recvTransport;
	}

	async produce(
		track: MediaStreamTrack
	): Promise<mediasoupClient.types.Producer> {
		if (!this.sendTransport) {
			throw new Error("Send transport not available");
		}

		const producer = await this.sendTransport.produce({ track });
		this.producers.set(producer.kind, producer);

		producer.on("trackended", () => {
			this.closeProducer(producer.kind);
		});

		return producer;
	}

	async consume(producerId: string): Promise<mediasoupClient.types.Consumer> {
		if (!this.recvTransport || !this.device) {
			throw new Error("Receive transport or device not available");
		}

		return new Promise((resolve, reject) => {
			socketEmit<ConsumeResponse>("consume", {
				producerId,
				transportId: this.recvTransport!.id,
				rtpCapabilities: this.device!.rtpCapabilities,
			} as ConsumeRequest)
				.then(async (response) => {
					try {
						if (!response || !response.consumerId || !response.rtpParameters) {
							throw new Error("Invalid consume response");
						}

						const consumer = await this.recvTransport!.consume({
							id: response.consumerId,
							producerId: response.producerId,
							kind: response.kind,
							rtpParameters: response.rtpParameters,
						});
						consumer.observer.on("close",()=>{
							console.log("Consumer close log is called")
						})

						this.consumers.set(consumer.id, consumer);

						consumer.on("transportclose", () => {
							this.consumers.delete(consumer.id);
						});

						resolve(consumer);
					} catch (error) {
						reject(error);
					}
				})
				.catch(reject);
		});
	}

	closeProducer(kind: string): void {
		const producer = this.producers.get(kind);
		if (producer) {
			producer.close();
			this.producers.delete(kind);
		}
	}

	closeConsumer(consumerId: string): void {
		const consumer = this.consumers.get(consumerId);
		if (consumer) {
			consumer.close();
			this.consumers.delete(consumerId);
		}
	}

	close(): void {
		this.producers.forEach((producer) => producer.close());
		this.consumers.forEach((consumer) => consumer.close());

		if (this.sendTransport) this.sendTransport.close();
		if (this.recvTransport) this.recvTransport.close();

		this.producers.clear();
		this.consumers.clear();
		this.isConnected = false;
	}

	get rtpCapabilities(): mediasoupClient.types.RtpCapabilities | undefined {
		return this.device?.rtpCapabilities;
	}
}

export const mediasoupService = new MediasoupClientService();
