"use client";

import dynamic from "next/dynamic";

const VideoPlayer = dynamic(() => import("../components/VideoPlayer"), {
	ssr: false,
	loading: () => <p>Loading video player...</p>,
});

const Watch = () => {
	return (
		<>
			<div className=" h-dvh w-dvw ">
				<div className=" h-full w-full  flex justify-center items-center ">
					<VideoPlayer />
				</div>
			</div>
		</>
	);
};
export default Watch;
