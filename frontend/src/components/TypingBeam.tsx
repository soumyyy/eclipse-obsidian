"use client";
import React from "react";

export default function TypingBeam() {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-24 overflow-hidden rounded-full bg-neutral-800">
        <div className="absolute inset-0 animate-[beam_1.6s_linear_infinite] bg-gradient-to-r from-transparent via-neutral-300 to-transparent" />
      </div>
      <style>{`@keyframes beam { 0%{transform: translateX(-100%)} 100%{transform: translateX(100%)} }`}</style>
    </div>
  );
}


