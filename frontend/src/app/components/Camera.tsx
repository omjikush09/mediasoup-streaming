import React from "react";
import * as mediasoupClient from "mediasoup-client";
import { useLocalMedia } from "../../hooks/useLocalMedia";

interface CameraStreamProps {
	sendTransport: mediasoupClient.types.Transport | null;
}

const CameraStream: React.FC<CameraStreamProps> = ({ sendTransport }) => {
	const {
		localStream,
		isAudioEnabled,
		isVideoEnabled,
		startMedia,
		stopMedia,
		toggleAudio,
		toggleVideo,
	} = useLocalMedia(sendTransport);
	// const [mutetVideo,setMuted]
	let localVideoStream: MediaStream;
	if (localStream) {
		localVideoStream = new MediaStream();
		localVideoStream.addTrack(localStream.getVideoTracks()[0]);
	}
	return (
		<div className="camera-stream">
			<div className="local-video-container">
				{localStream ? (
					<video
						autoPlay
						// muted
						playsInline
						className="local-video"
						ref={(video) => {
							if (video && localStream) {
								video.srcObject = localVideoStream;
							}
						}}
					/>
				) : (
					<div className="no-video">Camera not started</div>
				)}
			</div>

			<div className="media-controls">
				<button onClick={() => startMedia()} disabled={!!localStream}>
					Start Camera
				</button>
				<button onClick={stopMedia} disabled={!localStream}>
					Stop Camera
				</button>
				<button
					onClick={toggleAudio}
					disabled={!localStream}
					className={isAudioEnabled ? "enabled" : "disabled"}
				>
					{isAudioEnabled ? "Mute" : "Unmute"}
				</button>
				<button
					onClick={toggleVideo}
					disabled={!localStream}
					className={isVideoEnabled ? "enabled" : "disabled"}
				>
					{isVideoEnabled ? "Hide Video" : "Show Video"}
				</button>
			</div>
		</div>
	);
};

export default CameraStream;
