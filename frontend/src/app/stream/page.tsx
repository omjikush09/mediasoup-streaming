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

	const { remoteStreams, getOtherStreams } = useRemoteStreams({
		recvTransport,
	});

	useEffect(() => {
		initialize();
	}, [initialize]);

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
		<div className="app-container">
			<h1>Mediasoup Video Chat</h1>
			{recvTransport?.connectionState + " conection state"}
			<div className="video-layout  ">
				<div className="local-section">
					<h2>Your Camera</h2>
					<CameraStream sendTransport={sendTransport} />
				</div>

				<div className="remote-section">
					<RemoteVideoGrid remoteStreams={remoteStreams} />
				</div>
				<button onClick={getOtherStreams}>GET OTHER Strem</button>
			</div>
		</div>
	);
};

export default Home;
