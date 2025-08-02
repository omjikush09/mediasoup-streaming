import { access, constants } from "fs/promises";
import logger from "./logger.js";

export async function fileExistsAsync(filePath: string) {
	try {
		await access(filePath, constants.F_OK);
		return true; // File exists
	} catch (error: any) {
		if (error.code === "ENOENT") {
			return false; // File does not exist
		}
		
		logger.error(`Error checking file ${filePath}:`, error.message);
		throw error;
	}
}
