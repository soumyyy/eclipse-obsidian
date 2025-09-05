"use client";

import React from "react";

type FileLike = { name: string; type?: string } | File;

export default function FileIcon({ file }: { file: FileLike }) {
  const name = file?.name || "file";
  const type = file?.type || "";
  const ext = name.split(".").pop()?.toLowerCase();

  if (type.includes("pdf") || ext === "pdf") {
    return (
      <div className="w-4 h-4 sm:w-5 sm:h-5 bg-red-500 rounded flex items-center justify-center text-white text-[10px] font-bold">
        PDF
      </div>
    );
  }
  if (type.includes("markdown") || ext === "md" || ext === "markdown") {
    return (
      <div className="w-4 h-4 sm:w-5 sm:h-5 bg-blue-500 rounded flex items-center justify-center text-white text-[10px] font-bold">
        MD
      </div>
    );
  }
  if (type.includes("text") || ext === "txt") {
    return (
      <div className="w-4 h-4 sm:w-5 sm:h-5 bg-green-500 rounded flex items-center justify-center text-white text-[10px] font-bold">
        TXT
      </div>
    );
  }
  return (
    <div className="w-4 h-4 sm:w-5 sm:h-5 bg-gray-500 rounded flex items-center justify-center text-white text-[10px] font-bold">
      FILE
    </div>
  );
}

