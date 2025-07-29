import { useState, useEffect, useCallback } from "react";
import { mediasoupService } from "../services/mediasoupClient";
import { types as mediasoupTypes } from "mediasoup-client";
import { RemoteStreamData, ProducerInfo } from "../types/mediasoupe";
import { getSocket, socketEmit } from "@/util/socket";

const socket = getSocket();

interface UseRemoteStreamsReturn {
	remoteStreams: RemoteStreamData[];
	subscribeToProducer: (producerId: string) => Promise<void>;
	removeStream: (consumerId: string) => void;
	getAllStreams: () => void;
}

export const useRemoteStreams = ({
	recvTransport,
}: {
	recvTransport: mediasoupTypes.Transport | null;
}): UseRemoteStreamsReturn => {
	const [remoteStreams, setRemoteStreams] = useState<RemoteStreamData[]>([]);
	console.log(recvTransport?.connectionState + ". connection state of recev");
	const subscribeToProducer = useCallback(
		async (producerId: string): Promise<void> => {
			try {
				const consumer = await mediasoupService.consume(producerId);

				const streamData: RemoteStreamData = {
					id: consumer.id,
					producerId,
					consumer,
					kind: consumer.kind,
				};

				setRemoteStreams((prev) => [...prev, streamData]);
			} catch (error) {
				console.error("Failed to subscribe to producer:", error);
			}
		},
		[]
	);

	const handleExitingProducers = useCallback(
		async (producers: string[]): Promise<void> => {
			if (!recvTransport) {
				console.log("recev Transport not found");
			}
			console.log("recv Transport Found");
			console.log("Existing producers:", producers);

			for (const producerId of producers) {
				await subscribeToProducer(producerId);
			}
		},
		[subscribeToProducer, recvTransport]
	);

	const getOtherStreams = async () => {
		console.log("get Other Streams");
		const producer = await socketEmit<string[]>("existingProducers");
		handleExitingProducers(producer);
	};

	useEffect(() => {
		// socketService.on("exitingProducers", handleExitingProducers);

		socket.on("newProducer", async ({ producerId, kind, appData }) => {
			await subscribeToProducer(producerId);
		});

		return () => {
			socket.off("exitingProducers", handleExitingProducers);
			socket.off("newProducer", subscribeToProducer);
		};
	}, []);

	const removeStream = useCallback((consumerId: string): void => {
		setRemoteStreams((prev) => {
			const streamData = prev.find((s) => s.id === consumerId);
			if (streamData) {
				mediasoupService.closeConsumer(consumerId);
			}
			return prev.filter((s) => s.id !== consumerId);
		});
	}, []);

	return {
		remoteStreams,
		subscribeToProducer,
		removeStream,
		getAllStreams: getOtherStreams,
	};
};
