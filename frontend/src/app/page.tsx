"use client";
import Image from "next/image";
import CameraStream from "./components/Camera";
import { io, Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import { useEffect } from "react";
import { RtpCapabilities } from "mediasoup-client/types";
import Link from "next/link";
// export let socket: Socket;
export default function Home() {
	let device: mediasoupClient.Device;
	useEffect(() => {
		// socket = io("ws://localhost:8000");
		// device = new mediasoupClient.Device();
		// socket.on("connect", () => {
		// 	console.log(socket.id);
		// });
	}, []);
	return (
		<>
			
			<Link className="m-5" href="/watch">
				Watch
			</Link>

			<Link className="" href="/stream">
				Stream
			</Link>
		</>
	);
}
