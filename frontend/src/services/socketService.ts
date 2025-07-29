// import { io, Socket } from "socket.io-client";
// import { ProducerInfo } from "../types/mediasoupe";

// type EventHandler = (...args: any[]) => void;

// class SocketService {
// 	private _socket: Socket | null = null;
// 	private _eventHandlers = new Map<string, Set<EventHandler>>();

// 	connect(url: string): Socket {
// 		this._socket = io(url);

// 		this._socket.on("connect", () => {
// 			console.log("Connected to server:", this._socket?.id);
// 		});

// 		this._socket.on("disconnect", () => {
// 			console.log("Disconnected from server");
// 		});

// 		this._socket.on("exitingProducers", (producers: ProducerInfo[]) => {
// 			this.emit("exitingProducers", producers);
// 		});

// 		return this._socket;
// 	}

// 	// Helper method for promise-based socket emissions
// 	request<T = any>(event: string, data?: any): Promise<T> {
// 		return new Promise((resolve, reject) => {
// 			if (!this.socket) {
// 				reject(new Error("Socket not connected"));
// 				return;
// 			}

// 			// If no data is provided, pass callback as second parameter
// 			if (data === undefined) {
// 				console.log("Requesting event without data:", event);
// 				this.socket.emit(event, (response: T) => {
// 					resolve(response);
// 				});
// 			} else {
// 				// If data is provided, pass callback as third parameter
// 				this.socket.emit(event, data, (response: T) => {
// 					resolve(response);
// 				});
// 			}
// 		});
// 	}

// 	on(event: string, handler: EventHandler): void {
// 		if (!this._eventHandlers.has(event)) {
// 			this._eventHandlers.set(event, new Set());
// 		}
// 		this._eventHandlers.get(event)!.add(handler);
// 	}

// 	off(event: string, handler: EventHandler): void {
// 		if (this._eventHandlers.has(event)) {
// 			this._eventHandlers.get(event)!.delete(handler);
// 		}
// 	}

// 	emit(event: string, data?: any): void {
// 		if (this._eventHandlers.has(event)) {
// 			this._eventHandlers.get(event)!.forEach((handler) => handler(data));
// 		}
// 	}

// 	disconnect(): void {
// 		if (this._socket) {
// 			this._socket.disconnect();
// 			this._socket = null;
// 		}
// 		this._eventHandlers.clear();
// 	}

// 	get socket(): Socket | null {
// 		return this._socket;
// 	}

// 	get isConnected(): boolean {
// 		return this.socket?.connected ?? false;
// 	}
// }

// export const socketService = new SocketService();
