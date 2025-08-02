"use client";
import { useRef } from "react";
import ReactHlsPlayer from "react-hls-player";
import { PLAYLIST_URL } from "../../util/config";
const VideoPlayer = () => {
	const streamUrl = PLAYLIST_URL;

	const playerRef = useRef(null!);
	return (
		<>
			<ReactHlsPlayer
				src={streamUrl}
				playerRef={playerRef}
				autoPlay={true}
				controls={true}
				width="80%"
				height="80%"
				hlsConfig={{
					manifestLoadingMaxRetry: 3,
					manifestLoadingRetryDelay: 3000,
					liveSyncDurationCount: 3,
					maxBufferLength: 30,
					lowLatencyMode: true,
					minBufferLength: 5,
				}}
			/>
		</>
	);
};

export default VideoPlayer;
