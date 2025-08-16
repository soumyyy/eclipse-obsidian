"use client";
import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";

export default function Message({ role, content, sources }: { role: "user" | "assistant"; content: string; sources?: { path: string; score: number }[]; }) {
  const [showSources, setShowSources] = useState(false);
  const rendered = useMemo(() => content, [content]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {}
  };

  const isUser = role === "user";

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={(isUser ? "from-cyan-400/10 to-transparent border-cyan-500/30 " : "from-white/10 to-transparent border-white/10 ") + "relative max-w-[85%] rounded-2xl p-4 border backdrop-blur-md bg-gradient-to-br shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"}>
        <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)" }} />

        <div className="prose prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight, rehypeRaw]}
            components={{
              a({ href, children, ...props }) {
                return (
                  <a href={String(href)} target="_blank" rel="noreferrer" {...props} className="underline decoration-dotted underline-offset-4">
                    {children}
                  </a>
                );
              },
              code({ className, children, ...props }: any) {
                const code = String(children);
                const isBlock = /language-/.test(String(className || ""));
                if (!isBlock) {
                  return <code className="bg-white/10 rounded px-1.5 py-0.5">{children}</code>;
                }
                const copyBlock = async () => {
                  try { await navigator.clipboard.writeText(code); } catch {}
                };
                return (
                  <div className="relative group">
                    <button onClick={copyBlock} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/10">copy</button>
                    <pre className="!bg-black/60 !border !border-white/10 !p-3 !rounded-xl overflow-auto"><code className={className} {...props}>{children}</code></pre>
                  </div>
                );
              },
              table({ children }) {
                return <table className="w-full border-collapse my-3">{children}</table>;
              },
              thead({ children }) {
                return <thead className="bg-white/5">{children}</thead>;
              },
              th({ children }) {
                return <th className="text-left text-sm font-semibold px-3 py-2 border border-white/10">{children}</th>;
              },
              td({ children }) {
                return <td className="text-sm px-3 py-2 border border-white/10">{children}</td>;
              },
              hr() { return <hr className="my-4 border-white/10" />; },
            }}
          >
            {rendered}
          </ReactMarkdown>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          {!!sources?.length && (
            <button onClick={() => setShowSources((s) => !s)} className="text-[11px] text-neutral-400 hover:text-neutral-100 transition">{showSources ? "−" : "+"} sources</button>
          )}
          <button onClick={copy} className="text-[11px] text-neutral-400 hover:text-neutral-100 transition">copy</button>
        </div>

        {showSources && !!sources?.length && (
          <div className="mt-2 text-xs text-neutral-300 border-t border-white/10 pt-2">
            {sources.map((s, idx) => (
              <div key={idx} className="flex items-center gap-2 py-0.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500" />
                <span className="truncate">{s.path}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


