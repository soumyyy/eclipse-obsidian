"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

export interface MessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  formatted?: boolean;
}

function normalizeLLMMarkdown(input: string): string {
  if (!input) return "";
  let text = input;
  // Minimal: fix invisible characters and mid-word breaks; keep structure
  text = text.replace(/[\u00A0\u202F\u2007]/g, " ");
  text = text.replace(/[\u200B-\u200D\u2060\u00AD]/g, "");
  text = text.replace(/([A-Za-z0-9])\s*\n\s*([A-Za-z0-9])/g, "$1$2");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export default function Message({ role, content, formatted }: MessageProps) {
  const isUser = role === "user";
  const normalized = React.useMemo(() => (isUser || formatted ? content : normalizeLLMMarkdown(content)), [content, isUser, formatted]);

  // joinInline removed per simplification; headings render children directly

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "relative max-w-[85%] rounded-2xl border shadow-sm",
          isUser
            ? "px-5 sm:px-6 py-3.5 border-cyan-500/30 bg-cyan-950/20" 
            : "px-6 sm:px-7 py-4 border-white/10 bg-gray-900/25 animate-slide-in-up",
        ].join(" ")}
      >
        {isUser ? (
          <pre className="whitespace-pre-wrap break-words text-sm text-neutral-100">
            {content}
          </pre>
        ) : (
          <ReactMarkdown
            className="prose prose-invert prose-sm max-w-none"
            remarkPlugins={[remarkGfm, remarkBreaks, remarkMath] as any}
            rehypePlugins={[
              rehypeKatex,
              [rehypeSanitize, { ...defaultSchema }],
            ] as any}
            components={{
              h1: ({children}) => (
                <h1 className="text-xl font-bold text-white mb-3 mt-4 first:mt-0 border-b border-gray-700 pb-2">{children}</h1>
              ),
              h2: ({children}) => (
                <h2 className="text-lg font-bold text-white mb-3 mt-6 first:mt-0">{children}</h2>
              ),
              h3: ({children}) => (
                <h3 className="text-base font-bold text-white mb-2 mt-3 first:mt-0">{children}</h3>
              ),
              h4: ({children}) => (
                <h4 className="text-sm font-bold text-white mb-2 mt-3 first:mt-0">{children}</h4>
              ),
              
              p: ({children}) => (
                <p className="text-sm text-gray-100 mb-3 leading-relaxed">
                  {children}
                </p>
              ),
              
              strong: ({children}) => (
                <strong className="font-bold text-white">
                  {children}
                </strong>
              ),
              em: ({children}) => (
                <em className="italic text-gray-200">
                  {children}
                </em>
              ),
              
              ul: ({children}) => (
                <ul className="list-disc ml-5 mb-3 space-y-1">
                  {children}
                </ul>
              ),
              ol: ({children}) => (
                <ol className="list-decimal ml-5 mb-3 space-y-1">
                  {children}
                </ol>
              ),
              li: ({children}) => (
                <li className="text-sm text-gray-100">
                  {children}
                </li>
              ),
              
              a: ({children, href}) => (
                <a 
                  href={href} 
                  className="text-cyan-400 hover:text-cyan-300 underline" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              
              blockquote: ({children}) => (
                <blockquote className="border-l-4 border-cyan-500/50 pl-4 my-3 italic text-gray-300">
                  {children}
                </blockquote>
              ),
              
              code: ({children, className}) => {
                if (className?.includes("language-")) {
                  const language = className.replace("language-", "");
                  const codeString = String(children);
                  return (
                    <div className="my-4 rounded-lg bg-gray-900/50 border border-gray-700/50">
                      <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-700/50 text-xs text-gray-400 flex items-center justify-between">
                        <span>{language}</span>
                        <button
                          type="button"
                          onClick={async () => { try { await navigator.clipboard.writeText(codeString); } catch {} }}
                          className="text-gray-300 hover:text-white"
                          aria-label="Copy code"
                        >
                          Copy
                        </button>
                      </div>
                      <pre className="p-4 overflow-x-auto"><code className="text-sm font-mono text-gray-100">{codeString}</code></pre>
                    </div>
                  );
                }
                return <code className="px-1.5 py-0.5 bg-gray-800/50 rounded text-sm font-mono text-cyan-300">{children}</code>;
              },
              
              table: ({children}) => (
                <div className="my-4 overflow-x-auto rounded-xl border border-gray-700/60 bg-gray-900/30 shadow-sm inline-block max-w-full">
                  <table className="table-auto w-auto max-w-full">
                    {children}
                  </table>
                </div>
              ),
              
              th: ({children}) => (
                <th className="border border-gray-700/50 px-3.5 py-2.5 bg-gray-800/60 text-white font-semibold text-left text-sm whitespace-normal break-words align-top">
                  {children}
                </th>
              ),
              
              td: ({children}) => (
                <td className="border border-gray-700/50 px-3.5 py-2.5 text-gray-100 text-sm whitespace-normal break-words align-top">
                  {children}
                </td>
              ),
              tbody: ({children}) => (
                <tbody className="divide-y divide-gray-700/40">{children}</tbody>
              ),
              tr: ({children}) => (
                <tr className="odd:bg-gray-900/30">{children}</tr>
              ),
              
              hr: () => <hr className="my-6 border-gray-600" />
            }}
          >
            {normalized}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}