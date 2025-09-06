"use client";

import React from "react";
import FileIcon from "@/components/FileIcon";
import MarkdownRenderer from "@/components/MarkdownRenderer";

export interface MessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  formatted?: boolean;
  attachments?: { name: string; type: string }[];
  stickyTopRight?: boolean;
  outerRef?: React.Ref<HTMLDivElement>;
}

// (Removed unused normalize helper; backend now formats markdown robustly.)


export default function Message({ role, content, attachments, sources, stickyTopRight, outerRef }: MessageProps) {
  const isUser = role === "user";
  // Do not render any assistant bubble when it's just a placeholder (empty content)
  if (!isUser && (!content || content.trim().length === 0)) {
    return null;
  }
  const isAssistantPlaceholder = !isUser && (!content || content.trim().length === 0);
  const normalized = React.useMemo(() => {
    if (isUser) return content;
    let txt = content || "";
    // Live-stream normalizer to help ReactMarkdown spot code blocks while streaming
    try {
      // 1) If opening fence has language + code on same line, insert a newline after language
      txt = txt.replace(/```([A-Za-z0-9_+\-]+)[ \t]+(?=\S)/g, "```$1\n");
      // 2) Ensure opening fences start on their own line
      txt = txt.replace(/(?<!\n)```([A-Za-z0-9_+\-]*)/g, "\n\n```$1");
      // 3) If closing fence is followed by text on same line, split to next line
      txt = txt.replace(/```[ \t]*([^\n\s])/g, "```\n\n$1");
      // 4) If we have an odd number of fences, temporarily close to stabilize rendering
      const tickCount = (txt.match(/```/g) || []).length;
      if (tickCount % 2 === 1) txt = txt + "\n```\n";
    } catch {}
    return txt;
  }, [content, isUser]);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(normalized || "");
    } catch {
      // noop
    }
  }, [normalized]);

  // Minimal attachments-only row (no chat bubble)
  if ((attachments && attachments.length > 0) && (!content || content.trim().length === 0)) {
    return (
      <div className={isUser ? "flex justify-end" : "flex justify-start"}>
        <div className="mb-1 flex flex-wrap gap-2">
          {attachments.map((file, i) => (
            <div key={i} className="inline-flex items-center gap-2 text-sm bg-white/5 border border-white/20 rounded-lg px-3 py-2 backdrop-blur-sm">
              <FileIcon file={file} />
              <span className="text-neutral-100 font-medium">{file.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rowClass = [
    isUser ? "flex justify-end" : "flex justify-start",
    stickyTopRight && isUser ? "sticky top-2 z-20" : "",
  ].join(" ");

  return (
    <div className={rowClass} ref={outerRef}>
              <div
        className={[
          "relative max-w-[85%] sm:max-w-[85%] rounded-2xl border shadow-sm",
          isUser
            ? "px-3 sm:px-4 lg:px-5 py-2.5 sm:py-3.5 border-white/20 bg-white/5" 
            : "px-3 sm:px-4 lg:px-5 py-3 sm:py-4 border-white/10 bg-white/5 animate-slide-in-up",
        ].join(" ")}
      >
        {isUser ? (
          <div>
            {attachments && attachments.length > 0 && (
              <div className="mb-2 sm:mb-3 flex flex-wrap gap-2">
                {attachments.map((file, i) => (
                  <div key={i} className="inline-flex items-center gap-2 text-xs sm:text-sm bg-white/5 border border-white/20 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 backdrop-blur-sm">
                    <FileIcon file={file} />
                    <span className="text-white/90 font-medium max-w-[100px] sm:max-w-none truncate">{file.name}</span>
                  </div>
                ))}
              </div>
            )}
            {content && (
          <pre className="whitespace-pre-wrap break-words text-sm text-neutral-100">
            {content}
          </pre>
            )}
          </div>
        ) : (
          <MarkdownRenderer content={normalized} />
        )}

        {/* Sources section */}
        {sources && sources.length > 0 && (
          <div className="mt-3 sm:mt-4 pt-2 sm:pt-3 border-t border-white/10">
            <div className="text-xs text-white/50 mb-2">Sources:</div>
            <div className="space-y-1 sm:space-y-2">
              {sources.map((source, index) => (
                <div key={index} className="flex items-center justify-between text-xs bg-white/5 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2">
                  <span className="text-white/70 font-mono truncate">{source.path}</span>
                  <span className="text-white/50 ml-2 sm:ml-3">{(source.score * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Floating Copy button (assistant only) */}
        {!isUser && (normalized && normalized.length > 0) && (
          <button
            onClick={handleCopy}
            aria-label="Copy"
            className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/10 hover:bg-white/10 text-white/80 border border-black/10 shadow-sm backdrop-blur-sm"
            title="Copy"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
