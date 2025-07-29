import { io } from "socket.io-client";

export const socket = io("ws://localhost:8000");

export const socketEmit = <T = any>(
	event: string,
	data?: any,
	callback?: Function
): Promise<T> => {
	console.log("Emitting event:", event, "with data:", data);
	if (data != undefined) {
		return new Promise((resolve, reject) => {
			socket.emit(event, data, (response: any) => {
				if (response && response.error) {
					reject(new Error(response.error));
				} else {
					if (callback) {
						callback(response);
					}
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
					if (callback) {
						callback(response);
					}
					resolve(response);
				}
			});
		});
	}
};
