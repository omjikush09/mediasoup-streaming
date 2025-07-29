import React, { useEffect, useRef, useState } from "react";
import { RemoteStreamData } from "../../types/mediasoupe";
import { socketEmit } from "@/util/socket";

interface RemoteVideoGridProps {
	remoteStreams: RemoteStreamData[];
}

const RemoteVideoGrid: React.FC<RemoteVideoGridProps> = ({ remoteStreams }) => {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [stream, setStream] = useState<MediaStream | null>(null);

	useEffect(() => {
		const setupStream = async () => {
			if (!remoteStreams || remoteStreams.length < 2) return;

			const mediaStream = new MediaStream();

			for (const remote of remoteStreams) {
				// if (remote.consumer.paused) {
				await socketEmit("resumeConsumer", { consumerId: remote.id });
				// }

				const track = remote.consumer.track;

				track.onmute = () => console.warn("Track muted");
				track.onunmute = () =>
					console.log("Track unmuted and likely receiving frames");

				track.onended = () => console.warn("Track ended");

				console.log(track.kind);
				if (
					track.kind === "video" || track.kind === "audio" &&
					track.enabled &&
					track.readyState === "live"
				) {
					console.log("track");
					mediaStream.addTrack(track);
				}
			}

			setStream(mediaStream);
		};

		setupStream();
	}, [remoteStreams]);

	useEffect(() => {
		if (videoRef.current && stream) {
			videoRef.current.srcObject = stream;
			const playPromise = videoRef.current.play();
			if (playPromise !== undefined) {
				playPromise.catch((error) => {
					console.warn("Video play prevented:", error);
				});
			}
		}
	}, [stream]);

	if (!remoteStreams || remoteStreams.length < 2) {
		return <p>No remote video streams available</p>;
	}

	return (
		<div className="remote-video-grid ">
			<h2>Remote Streams ({remoteStreams.length})</h2>
			<div className="video-grid">
				d
				<video
					autoPlay
					playsInline
					ref={videoRef}
					className="remote-video"
					// only if needed
				/>
			</div>
		</div>
	);
};

export default RemoteVideoGrid;
