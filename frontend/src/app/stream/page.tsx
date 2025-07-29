"use client";
import React, { useEffect } from "react";
import CameraStream from "../components/Camera";
import RemoteVideoGrid from "../components/RemoteVideoGrid";
import { useMediasoup } from "../../hooks/useMediasoup";
import { useRemoteStreams } from "../../hooks/useRemoteStreams";
import { SERVER_URL } from "../../../config";

const Home: React.FC = () => {
	const {
		isConnected,
		isInitializing,
		error,
		sendTransport,
		recvTransport,
		initialize,
	} = useMediasoup(SERVER_URL);

	const { remoteStreams, getAllStreams } = useRemoteStreams({
		recvTransport,
	});

	useEffect(() => {
		initialize();
	}, [initialize]);

	useEffect(() => {
		if (isConnected) {
			setTimeout(() => {
				getAllStreams();
			}, 1000);
		}
	}, [isConnected]);

	if (error) {
		return (
			<div className="error-container">
				<h1>Connection Error</h1>
				<p>{error}</p>
				<button onClick={initialize}>Retry</button>
			</div>
		);
	}

	if (isInitializing) {
		return (
			<div className="loading-container">
				<h1>Connecting...</h1>
				<p>Initializing mediasoup connection</p>
			</div>
		);
	}

	if (!isConnected) {
		return (
			<div className="connection-container">
				<h1>Not Connected</h1>
				<button onClick={initialize}>Connect</button>
			</div>
		);
	}

	return (
		<div className="h-dvh w-dvw bg-gray-400 relative">
			<h1 className="text-center text-black ">Mediasoup Video Chat</h1>
			{recvTransport?.connectionState + " conection state"}
			<div className="video-layout  w-full  flex  flex-row mt-10 justify-evenly  ">
				<div className="local-section  gap-5 flex flex-col ">
					<h2 className="text-center text-black">Your Camera</h2>
					<CameraStream sendTransport={sendTransport} />
				</div>

				<div className="remote-section gap-5 flex flex-col justify-start">
					<h2 className="text-black text-center ">Remote Streams</h2>
					<RemoteVideoGrid remoteStreams={remoteStreams} />
				</div>
			</div>
		</div>
	);
};

export default Home;
