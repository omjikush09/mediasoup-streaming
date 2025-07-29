import { useState, useCallback, useRef } from "react";
import { types as mediasoupTypes } from "mediasoup-client";
import { mediasoupService as client } from "../services/mediasoupClient";

interface UseLocalMediaReturn {
	localStream: MediaStream | null;
	startMedia: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
	stopMedia: () => void;
}

export const useLocalMedia = (
	sendTransport: mediasoupTypes.Transport | null
): UseLocalMediaReturn => {
	const [localStream, setLocalStream] = useState<MediaStream | null>(null);
	const producersRef = useRef<Map<string, mediasoupTypes.Producer>>(new Map());

	const startMedia = useCallback(
		async (constraints: MediaStreamConstraints = {}): Promise<MediaStream> => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: constraints.video !== false,
					audio: constraints.audio !== false,
				});

				setLocalStream(stream);

				if (!sendTransport) {
					console.warn("Send transport not available, cannot produce media");
					return stream;
				}

				// Produce tracks
				const videoTracks = stream.getVideoTracks();
				const audioTracks = stream.getAudioTracks();

				if (videoTracks.length > 0) {
					const videoProducer = await client.produce(videoTracks[0]);
					producersRef.current.set("video", videoProducer);
				}

				if (audioTracks.length > 0) {
					const audioProducer = await client.produce(audioTracks[0]);
					producersRef.current.set("audio", audioProducer);
				}

				return stream;
			} catch (error) {
				console.error("Failed to start media:", error);
				throw error;
			}
		},
		[sendTransport]
	);

	const stopMedia = useCallback((): void => {
		if (localStream) {
			localStream.getTracks().forEach((track) => track.stop());
			setLocalStream(null);
		}
		producersRef.current.forEach((producer, kind) => {
			client.closeProducer(kind);
		});
		producersRef.current.clear();
	}, [localStream]);

	return {
		localStream,
		startMedia,
		stopMedia,
	};
};
