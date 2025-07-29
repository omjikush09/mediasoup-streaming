import { types as mediasoupTypes } from "mediasoup";

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
	webRtcTransport: {
		listenIps: [
			{
				ip: "0.0.0.0",
				announcedIp: "127.0.0.1",
			},
		],
		maxIncomingBitrate: 1500000,
		initialAvailableOutgoingBitrate: 1000000,
	},
	plainTransport: {
		listenIp: { ip: "127.0.0.1", announcedIp: "127.0.0.1" },
		rtcpMux: false,
		comedia: false,
		enableSrtp: false,
		enableRtx: false,
		initialAvailableOutgoingBitrate: 4000000,
	} as mediasoupTypes.PlainTransportOptions,
};
