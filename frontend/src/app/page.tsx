"use client";
import Link from "next/link";

export default function Home() {
	return (
		<>
			<Link className="m-5" href="/watch">
				Watch
			</Link>

			<Link className="" href="/stream">
				Stream
			</Link>
		</>
	);
}
