import { useState, useCallback, useRef } from "react";
import * as mediasoupClient from "mediasoup-client";
import { mediasoupService as client } from "../services/mediasoupClient";

interface UseLocalMediaReturn {
	localStream: MediaStream | null;
	isAudioEnabled: boolean;
	isVideoEnabled: boolean;
	isScreenSharing: boolean;
	startMedia: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
	stopMedia: () => void;
	toggleAudio: () => void;
	toggleVideo: () => void;
	startScreenShare: () => Promise<void>;
}

export const useLocalMedia = (
	sendTransport: mediasoupClient.types.Transport | null
): UseLocalMediaReturn => {
	const [localStream, setLocalStream] = useState<MediaStream | null>(null);
	const [isAudioEnabled, setIsAudioEnabled] = useState<boolean>(true);
	const [isVideoEnabled, setIsVideoEnabled] = useState<boolean>(true);
	const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
	const producersRef = useRef<Map<string, mediasoupClient.types.Producer>>(
		new Map()
	);

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
				const track = stream.getVideoTracks()[0];

				track.onmute = () => console.log("PRODUCER track muted");
				track.onunmute = () => console.log("PRODUCER track unmuted");
				track.onended = () => console.warn("PRODUCER track ended");

				console.log("Producer track state:", track.readyState);

				console.log(sendTransport.connectionState +" connection State")
				// sendTransport.produce()
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

		setIsScreenSharing(false);
	}, [localStream]);

	const toggleAudio = useCallback((): void => {
		const audioProducer = producersRef.current.get("audio");
		if (audioProducer) {
			if (isAudioEnabled) {
				audioProducer.pause();
			} else {
				audioProducer.resume();
			}
			setIsAudioEnabled(!isAudioEnabled);
		}
	}, [isAudioEnabled]);

	const toggleVideo = useCallback((): void => {
		const videoProducer = producersRef.current.get("video");
		if (videoProducer) {
			if (isVideoEnabled) {
				videoProducer.pause();
			} else {
				videoProducer.resume();
			}
			setIsVideoEnabled(!isVideoEnabled);
		}
	}, [isVideoEnabled]);

	const startScreenShare = useCallback(async (): Promise<void> => {
		try {
			const screenStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: true,
			});

			// Replace video track
			const videoTrack = screenStream.getVideoTracks()[0];
			const videoProducer = producersRef.current.get("video");

			if (videoProducer) {
				await videoProducer.replaceTrack({ track: videoTrack });
			}

			setIsScreenSharing(true);

			videoTrack.onended = () => {
				setIsScreenSharing(false);
				// Restart camera
				startMedia({ video: true, audio: false });
			};
		} catch (error) {
			console.error("Failed to start screen share:", error);
		}
	}, [startMedia]);

	return {
		localStream,
		isAudioEnabled,
		isVideoEnabled,
		isScreenSharing,
		startMedia,
		stopMedia,
		toggleAudio,
		toggleVideo,
		startScreenShare,
	};
};
