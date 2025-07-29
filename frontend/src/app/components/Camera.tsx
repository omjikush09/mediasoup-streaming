import React from "react";
import * as mediasoupClient from "mediasoup-client";
import { useLocalMedia } from "../../hooks/useLocalMedia";
import { Button } from "@/components/ui/button";

interface CameraStreamProps {
	sendTransport: mediasoupClient.types.Transport | null;
}

const CameraStream: React.FC<CameraStreamProps> = ({ sendTransport }) => {
	const { localStream, startMedia, stopMedia } = useLocalMedia(sendTransport);
	let localVideoStream: MediaStream;
	if (localStream) {
		localVideoStream = new MediaStream();
		localVideoStream.addTrack(localStream.getVideoTracks()[0]);
	}
	return (
		<div className="flex flex-col gap-4">
			<div className="local-video-container">
				{localStream ? (
					<video
						autoPlay
						playsInline
						className="h-[300] w-[500]"
						ref={(video) => {
							if (video && localStream) {
								video.srcObject = localVideoStream;
							}
						}}
					/>
				) : (
					<div className="h-[300] w-[500] bg-violet-600 ">
						Camera not started
					</div>
				)}
			</div>

			<div className="  text-center ">
				{!localStream && (
					<Button onClick={() => startMedia()}>Start Camera</Button>
				)}
				{!!localStream && <Button onClick={stopMedia}>Stop Camera</Button>}
			</div>
		</div>
	);
};

export default CameraStream;
