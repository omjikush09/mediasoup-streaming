export const SERVER_URL =
	process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8000";

export const PLAYLIST_URL =
	process.env.NEXT_PUBLIC_PLAYLIST_URL ?? `${SERVER_URL}/hls/playlist.m3u8`;
