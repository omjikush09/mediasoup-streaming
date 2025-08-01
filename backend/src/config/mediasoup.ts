import { types as mediasoupTypes } from "mediasoup";
import dotenv from "dotenv";
dotenv.config();
export const config = {
	outputPath: "./hls_output",
	worker: {
		rtcMinPort: 10000,
		rtcMaxPort: 10100,
		logLevel: "warn" as mediasoupTypes.WorkerLogLevel,
		logTags: [
			"info",
			"ice",
			"dtls",
			"rtp",
			"srtp",
			"rtcp",
		] as mediasoupTypes.WorkerLogTag[],
	},
	router: {
		mediaCodecs: [
			{
				kind: "audio",
				mimeType: "audio/opus",
				clockRate: 48000,
				channels: 2,
			},
			{
				kind: "video",
				mimeType: "video/VP8",
				clockRate: 90000,
				parameters: {
					"x-google-start-bitrate": 1000,
				},
			},
		] as mediasoupTypes.RtpCodecCapability[],
	},
	webRTCServer: {
		listenInfos: [
			{
				protocol: "udp",
				ip: "0.0.0.0",
				port: 40000,
				announcedAddress: process.env.EXTERNAL_IP ?? "23.21.6.80",
			},
			{
				protocol: "tcp",
				ip: "0.0.0.0",
				port: 40000,
				announcedAddress: process.env.EXTERNAL_IP ?? "23.21.6.80",
			},
		],
	} as mediasoupTypes.WebRtcServerOptions,
	plainTransport: {
		listenIp: {
			ip: "0.0.0.0",
			// announcedIp: process.env.EXTERNAL_IP ?? "23.21.6.80",
		},
		rtcpMux: false,
		comedia: false,
		enableSrtp: false,
		enableRtx: false,
		initialAvailableOutgoingBitrate: 4000000,
	} as mediasoupTypes.PlainTransportOptions,
};
