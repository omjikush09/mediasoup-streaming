import { useState, useEffect, useCallback } from "react";
import * as mediasoupClient from "mediasoup-client";
import { mediasoupService } from "../services/mediasoupClient"; // Updated import
import { WebRTCTransportData } from "../types/mediasoupe";
import { getSocket, socketEmit } from "@/util/socket";

const socket = getSocket();
interface UseMediasoupReturn {
	isConnected: boolean;
	isInitializing: boolean;
	error: string | null;
	sendTransport: mediasoupClient.types.Transport | null;
	recvTransport: mediasoupClient.types.Transport | null;
	initialize: () => Promise<void>;
	disconnect: () => void;
}

export const useMediasoup = (serverUrl: string): UseMediasoupReturn => {
	const [isConnected, setIsConnected] = useState<boolean>(false);
	const [isInitializing, setIsInitializing] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);
	const [sendTransport, setSendTransport] =
		useState<mediasoupClient.types.Transport | null>(null);
	const [recvTransport, setRecvTransport] =
		useState<mediasoupClient.types.Transport | null>(null);

	const initialize = useCallback(async (): Promise<void> => {
		if (isInitializing || isConnected) return;

		setIsInitializing(true);
		setError(null);

		try {
			// Get router RTP capabilities
			const rtpCapabilities =
				await socketEmit<mediasoupClient.types.RtpCapabilities>(
					"getRouterRTPCapabilities"
				);
			console.log(rtpCapabilities + " Router ");
			// Initialize mediasoup device
			await mediasoupService.initialize(rtpCapabilities); // Updated reference

			// Create WebRTC transports
			const sendTransportData = await socketEmit<WebRTCTransportData>(
				"createWebRTCTransport"
			);

			const recvTransportData = await socketEmit<WebRTCTransportData>(
				"createWebRTCTransport"
			);

			// Create send transport
			const sendTransportInstance = await mediasoupService.createSendTransport(
				// Updated reference
				sendTransportData
			);
			setSendTransport(sendTransportInstance);

			// Create receive transport
			const recvTransportInstance = await mediasoupService.createRecvTransport(
				// Updated reference
				recvTransportData
			);
			setRecvTransport(recvTransportInstance);
			console.log(
				recvTransportInstance?.connectionState +
					" in. media soupt recv connection state"
			);
			console.log(
				sendTransportInstance?.connectionState +
					" in. media soup send  connection state"
			);

			setIsConnected(true);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Unknown error";
			setError(errorMessage);
			console.error("Mediasoup initialization failed:", err);
		} finally {
			setIsInitializing(false);
		}
	}, [serverUrl, isInitializing, isConnected]);

	const disconnect = useCallback((): void => {
		mediasoupService.close(); // Updated reference
		socket.disconnect();
		setIsConnected(false);
		setSendTransport(null);
		setRecvTransport(null);
	}, []);

	useEffect(() => {
		return () => {
			disconnect();
		};
	}, [disconnect]);

	return {
		isConnected,
		isInitializing,
		error,
		sendTransport,
		recvTransport,
		initialize,
		disconnect,
	};
};
