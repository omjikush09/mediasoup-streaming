import * as mediasoupClient from "mediasoup-client";

export interface WebRTCTransportData {
	id: string;
	iceParameters: mediasoupClient.types.IceParameters;
	iceCandidates: mediasoupClient.types.IceCandidate[];
	dtlsParameters: mediasoupClient.types.DtlsParameters;
}

export interface ConsumeResponse {
	consumerId: string;
	producerId: string;
	rtpParameters: mediasoupClient.types.RtpParameters;
	kind: mediasoupClient.types.MediaKind;
	appData: mediasoupClient.types.AppData;
}

export interface ProduceRequest {
	transportId: string;
	kind: mediasoupClient.types.MediaKind;
	rtpParameters: mediasoupClient.types.RtpParameters;
}

export interface ProduceResponse {
	id: string;
}

export interface ConnectTransportRequest {
	transportId: string;
	dtlsParameters: mediasoupClient.types.DtlsParameters;
}

export interface ConnectTransportResponse {
	status: string;
}

export interface ConsumeRequest {
	producerId: string;
	transportId: string;
	rtpCapabilities: mediasoupClient.types.RtpCapabilities;
}

export interface RemoteStreamData {
	id: string;
	producerId: string;
	consumer: mediasoupClient.types.Consumer;
	kind: mediasoupClient.types.MediaKind;
}

export interface ProducerInfo {
	id: string;
	kind: mediasoupClient.types.MediaKind;
}
