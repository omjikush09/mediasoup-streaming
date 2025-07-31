import * as net from "net";
import logger from "../utlis/logger";
import { StreamService } from "./streamService";

export class PortManager {
	static usedPorts: Set<number> = new Set();
	static instance: PortManager | null = null;
	private constructor() {}

	static getInstance() {
		if (this.instance) {
			return this.instance;
		}
		return new PortManager();
	}

	async allocatePort() {
		for (const [
			participant,
			participaintInfo,
		] of StreamService.participaintsMap) {
			if (!!participaintInfo.ports.audio && !!participaintInfo.ports.video)
				continue;
			if (participaintInfo.producers.videoProducer) {
				participaintInfo.ports.video = await this.findAvailablePortWithRetry(
					20000,
					5
				);
			}

			if (participaintInfo.producers.audioProducer) {
				participaintInfo.ports.audio = await this.findAvailablePortWithRetry(
					21000,
					5
				);
			}
		}
	}
	private async findAvailablePortWithRetry(
		startPort: number,
		maxRetries: number = 5
	): Promise<number> {
		let attempts = 0;

		while (attempts < maxRetries) {
			try {
				// Rely on findAvailablePort to return a genuinely available port
				const port = await this.findAvailablePort(startPort + attempts * 100);
				return port; // If findAvailablePort succeeded, we're good
			} catch (error) {
				logger.warn(`Port allocation attempt ${attempts + 1} failed:`, error);
				attempts++;

				if (attempts < maxRetries) {
					// Add a delay before retrying the next range
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			}
		}

		throw new Error(
			`Failed to find available port after ${maxRetries} attempts`
		);
	}

	private async findAvailablePort(startPort: number = 20000): Promise<number> {
		return new Promise((resolve, reject) => {
			let attempts = 0;
			const maxAttempts = 100;

			const testPort = (port: number) => {
				if (attempts >= maxAttempts) {
					reject(new Error("No available ports found"));
					return;
				}

				// Mark ports as used IMMEDIATELY to prevent race conditions
				if (
					PortManager.usedPorts.has(port) ||
					PortManager.usedPorts.has(port + 1)
				) {
					testPort(port + 2);
					return;
				}

				// Reserve ports before testing
				PortManager.usedPorts.add(port);
				PortManager.usedPorts.add(port + 1);

				attempts++;
				const server = net.createServer();

				server.listen(port, () => {
					server.close(() => {
						logger.debug(
							`Confirmed available port: ${port} (RTCP: ${port + 1})`
						);
						resolve(port);
					});
				});

				server.on("error", () => {
					// Remove from used ports if test failed
					PortManager.usedPorts.delete(port);
					PortManager.usedPorts.delete(port + 1);
					testPort(port + 2);
				});
			};

			testPort(startPort);
		});
	}
}
