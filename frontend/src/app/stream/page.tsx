"use client";
import React, { useEffect } from "react";
import CameraStream from "../components/Camera";
import RemoteVideoGrid from "../components/RemoteVideoGrid";
import { useMediasoup } from "../../hooks/useMediasoup";
import { useRemoteStreams } from "../../hooks/useRemoteStreams";

const Home: React.FC = () => {
	const {
		isConnected,
		isInitializing,
		error,
		sendTransport,
		recvTransport,
		initialize,
	} = useMediasoup();

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
	}, [isConnected, getAllStreams]);

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
		<div className=" w-screen min-h-dvh h-auto bg-gray-400 flex flex-col">
			<h1 className="text-center text-black ">Mediasoup Video Chat</h1>
			<div className="video-layout  flex-1   flex  lg:flex-row lg:mt-10 lg:justify-evenly flex-col items-center  lg:items-start pb-10">
				<div className=" gap-5 flex flex-col ">
					<h2 className="text-center text-black">Your Camera</h2>
					<CameraStream sendTransport={sendTransport} />
				</div>

				<div className=" gap-5 flex flex-col  ">
					<h2 className="text-black text-center ">Remote Streams</h2>
					<RemoteVideoGrid remoteStreams={remoteStreams} />
				</div>
			</div>
		</div>
	);
};

export default Home;
