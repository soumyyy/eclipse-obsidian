"use client";
import { useEffect, useRef } from "react";

export default function Sound({ play }: { play: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (play && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, [play]);
  return (
    <audio ref={audioRef} preload="auto">
      <source src="data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA..." type="audio/mpeg" />
    </audio>
  );
}


