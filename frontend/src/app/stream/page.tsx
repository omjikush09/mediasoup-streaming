"use client";
import React, { useEffect, useState } from "react";

import { Socket } from "socket.io-client";
import { getSocket } from "@/util/socket";
import Stream from "../components/Stream";

const Home: React.FC = () => {
	const [socket, setSocket] = useState<Socket>(null!);

	useEffect(() => {
		const socket = getSocket();
		setSocket(socket);
	}, []);

	if (!socket ) {
		return (
			<div className="error-container">
				<h1>Connecting to Server</h1>
			</div>
		);
	}

	return <>{socket && <Stream socket={socket} />}</>;
};

export default Home;
