import { io, Socket } from "socket.io-client";
import { SERVER_URL } from "./config";

let socket: Socket;

export const getSocket = () => {
	if (!socket) {
		socket = io(SERVER_URL, {
			transports: ["websocket"],
			withCredentials: true,
		});
	}
	return socket;
};

export const socketEmit = <T = any>(event: string, data?: any): Promise<T> => {
	console.log("Emitting event:", event, "with data:", data);
	if (data != undefined) {
		return new Promise((resolve, reject) => {
			socket.emit(event, data, (response: any) => {
				if (response && response.error) {
					reject(new Error(response.error));
				} else {
					// if (callback) {
					// 	callback(response);
					// }
					resolve(response);
				}
			});
		});
	} else {
		console.log("data is undefined");
		return new Promise((resolve, reject) => {
			socket.emit(event, (response: any) => {
				if (response && response.error) {
					reject(new Error(response.error));
				} else {
					// if (callback) {
					// 	callback(response);
					// }
					resolve(response);
				}
			});
		});
	}
};
