import { types as mediasoupTypes } from "mediasoup";

export class Peer {
	socketId: string;
	transport: Map<string, mediasoupTypes.Transport>;
	producer: Map<string, mediasoupTypes.Producer>;
	consumer: Map<string, mediasoupTypes.Consumer>;

	constructor(id: string) {
		this.socketId = id;
		this.transport = new Map();
		this.producer = new Map();
		this.consumer = new Map();
	}

	addTransporte(id: string, transport: mediasoupTypes.Transport) {
		this.transport.set(id, transport);
	}

	getTransport(id: string) {
		return this.transport.get(id);
	}

	removeTransport(id: string) {
		this.transport.delete(id);
	}
	addProducer(id: string, producer: mediasoupTypes.Producer) {
		this.producer.set(id, producer);
	}
	getProducer(id: string) {
		return this.producer.get(id)?.kind;
	}

	removeProducer(id: string) {
		this.producer.delete(id);
	}
	addConsumer(id: string, consumer: mediasoupTypes.Consumer) {
		this.consumer.set(id, consumer);
	}
	getConsumer(id: string) {
		return this.consumer.get(id);
	}
	getProducers() {
		return this.producer.values();
	}
	removeConsumer(id: string) {
		this.consumer.delete(id);
	}
	getSocketId() {
		if (!this.socketId) {
			throw new Error("Socket ID is not set");
		}
		return this.socketId;
	}
}
