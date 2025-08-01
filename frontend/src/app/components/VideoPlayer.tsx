"use client";
import { useRef } from "react";
import ReactHlsPlayer from "react-hls-player";
import { SERVER_URL } from "../../util/config";
const VideoPlayer = () => {
	const streamUrl = SERVER_URL + "/hls/playlist.m3u8";

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
					minBufferLength: 3,
				}}
			/>
		</>
	);
};

export default VideoPlayer;
