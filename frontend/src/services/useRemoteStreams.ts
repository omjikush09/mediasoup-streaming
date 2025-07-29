// import { useState, useEffect, useCallback } from "react";
// import { mediasoupService } from "../services/mediasoupClient"; // Updated import
// import { RemoteStreamData, ProducerInfo } from "../types/mediasoupe";

// interface UseRemoteStreamsReturn {
// 	remoteStreams: RemoteStreamData[];
// 	subscribeToProducer: (producerId: string) => Promise<void>;
// 	removeStream: (consumerId: string) => void;
// }

// export const useRemoteStreams = (): UseRemoteStreamsReturn => {
// 	const [remoteStreams, setRemoteStreams] = useState<RemoteStreamData[]>([]);

// 	const subscribeToProducer = useCallback(
// 		async (producerId: string): Promise<void> => {
// 			try {
// 				const consumer = await mediasoupService.consume(
// 					// Updated reference
// 					producerId
// 				);

// 				const stream = new MediaStream([consumer.track]);

// 				const streamData: RemoteStreamData = {
// 					id: consumer.id,
// 					producerId,
// 					stream,
// 					consumer,
// 					kind: consumer.kind,
// 				};

// 				setRemoteStreams((prev) => [...prev, streamData]);
// 			} catch (error) {
// 				console.error("Failed to subscribe to producer:", error);
// 			}
// 		},
// 		[]
// 	);

// 	const handleExitingProducers = useCallback(
// 		async (producers: ProducerInfo[]): Promise<void> => {
// 			console.log("Existing producers:", producers);

// 			for (const producer of producers) {
// 				await subscribeToProducer(producer.id);
// 			}
// 		},
// 		[subscribeToProducer]
// 	);

// 	useEffect(() => {
// 		socketService.on("exitingProducers", handleExitingProducers);
// 		socketService.on("newProducer", subscribeToProducer);

// 		return () => {
// 			socketService.off("exitingProducers", handleExitingProducers);
// 			socketService.off("newProducer", subscribeToProducer);
// 		};
// 	}, [handleExitingProducers]);

// 	const removeStream = useCallback((consumerId: string): void => {
// 		setRemoteStreams((prev) => {
// 			const streamData = prev.find((s) => s.id === consumerId);
// 			if (streamData) {
// 				mediasoupService.closeConsumer(consumerId); // Updated reference
// 			}
// 			return prev.filter((s) => s.id !== consumerId);
// 		});
// 	}, []);

// 	return {
// 		remoteStreams,
// 		subscribeToProducer,
// 		removeStream,
// 	};
// };
