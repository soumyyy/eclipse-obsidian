"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import remarkSmartypants from "remark-smartypants";
import remarkExternalLinks from "remark-external-links";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

type Props = {
  content: string;
  className?: string;
};

export default function MarkdownRenderer({ content, className }: Props) {
  // Extract plain text from React children for copy behavior
  const extractText = (node: unknown): string => {
    if (node == null) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(extractText).join("");
    if (typeof node === "object" && node !== null && "props" in node) {
      const nodeWithProps = node as { props: { children?: unknown } };
      if (nodeWithProps.props && nodeWithProps.props.children) {
        return extractText(nodeWithProps.props.children);
      }
    }
    return "";
  };

  // Local component to render fenced code with Copy and pleasant UI
  const CodeBlock: React.FC<{ lang: string; className: string; contentNode: React.ReactNode; rawText: string }> = ({ lang, className, contentNode, rawText }) => {
    const [copied, setCopied] = React.useState(false);
    const onCopy = async () => {
      try { await navigator.clipboard.writeText(rawText); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
    };
    return (
      <div className="relative my-3 sm:my-4 rounded-xl border border-white/15 bg-gradient-to-b from-white/5 to-white/10 shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1 border-b border-white/10 bg-black/2">
          <span className="text-xs uppercase tracking-wide text-white/60 font-medium">{lang}</span>
          <button
            onClick={onCopy}
            className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white/80 border border-white/10"
            aria-label="Copy code"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="mt-0 mb-0 text-xs sm:text-sm text-white/90 px-3 sm:p-4 font-mono overflow-x-auto leading-relaxed bg-transparent">
          <code className={`${className} bg-transparent`}>{contentNode}</code>
        </pre>
        {copied && (
          <div className="absolute bottom-2 right-2 text-xs px-2 py-1 rounded-md bg-black/60 text-white/90 border border-white/10">
            Copied
          </div>
        )}
      </div>
    );
  };
  return (
    <ReactMarkdown
      className={
        className ||
        [
          "prose prose-invert prose-sm max-w-none",
          // Tables
          "[&_table]:my-0 [&_table]:mt-0 [&_table]:mb-0 [&_th]:pl-3 sm:[&_th]:pl-6 [&_th]:pr-3 sm:[&_th]:pr-6 [&_td]:pl-3 sm:[&_td]:pl-6 [&_td]:pr-3 sm:[&_td]:pr-6",
          "[&_tbody_tr:nth-child(odd)]:bg-white/5 [&_tbody_tr:hover]:bg-white/10",
          // Heading anchors
          "[&_a.anchor]:ml-2 [&_a.anchor]:text-white/30 hover:[&_a.anchor]:text-white/60",
          // Remove background/padding from code inside pre blocks
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:border-0 [&_pre_code]:shadow-none",
        ].join(" ")
      }
      remarkPlugins={[
        remarkGfm,
        remarkBreaks,
        remarkMath,
        remarkSmartypants,
        [remarkExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] }],
      ]}
      rehypePlugins={[
        rehypeSlug,
        [rehypeAutolinkHeadings, { behavior: "append", properties: { className: ["anchor"] } }],
        rehypeKatex,
        [
          rehypeSanitize,
          {
            ...defaultSchema,
            attributes: {
              ...defaultSchema.attributes,
              code: [...(defaultSchema.attributes?.code || []), "className"],
              pre: [...(defaultSchema.attributes?.pre || []), "className"],
            },
          },
        ],
      ]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base sm:text-lg font-bold text-white mb-2 sm:mb-3">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm sm:text-base font-bold text-white mb-2">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="text-sm sm:text-base text-white/90 mb-2 sm:mb-3 leading-relaxed">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="text-sm sm:text-base text-white/90 mb-2 sm:mb-3 space-y-1 sm:space-y-2 list-disc list-inside">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="text-sm sm:text-base text-white/90 mb-2 sm:mb-3 space-y-1 sm:space-y-2 list-decimal list-inside">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="text-sm sm:text-base text-white/90">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="text-sm sm:text-base text-white/70 border-l-2 border-white/20 pl-3 sm:pl-4 py-1 sm:py-2 my-2 sm:my-3 bg-white/5 rounded-r-lg">
            {children}
          </blockquote>
        ),
        // Inline code
        code: ({ children, className }) => {
          const isBlock = className && className.includes("language-");
          if (isBlock) {
            // Let the custom pre renderer handle fenced blocks for richer UI
            return <code className={className}>{children}</code>;
          }
          return (
            <code className="text-xs sm:text-sm bg-white/10 text-white/90 px-1.5 sm:px-2 py-0.5 rounded-md font-mono border border-white/10">
              {children}
            </code>
          );
        },
        // Fenced code blocks with language: custom boxed UI with header + copy
        pre: ({ children }) => {
          try {
            const child = Array.isArray(children) ? children[0] : (children as { type?: string; props?: { className?: string; children?: unknown } });
            const isCode = child && child.type === 'code';
            const className = isCode ? (child.props?.className || '') : '';
            const lang = (className.match(/language-([a-zA-Z0-9_+-]+)/)?.[1] || 'code').toLowerCase();
            const rawText = extractText(isCode ? child.props.children : children);
            return <CodeBlock lang={lang || 'code'} className={className} contentNode={isCode ? child.props.children : children} rawText={rawText} />;
          } catch {
            return (
              <pre className="text-xs sm:text-sm bg-white/10 text-white/90 p-2 sm:p-3 rounded-lg font-mono overflow-x-auto my-2 sm:my-3 border border-white/10">
                {children}
              </pre>
            );
          }
        },
        a: ({ children, href }) => (
          <a
            href={href}
            className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-400/30 hover:decoration-cyan-400/50 transition-colors"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2 sm:my-3">
            <table className="min-w-full border-collapse border border-white/20 rounded-lg overflow-hidden">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="text-xs sm:text-sm font-bold text-white bg-white/10 px-2 sm:px-3 py-2 border border-white/20 text-left sticky top-0 z-10">
            {children}
          </th>
        ),
        td: ({ children }) => {
          const text = extractText(children);
          const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
          const bulletLines = lines.filter(l => /^([\-*•])\s+/.test(l));
          if (bulletLines.length >= 2) {
            const items = lines
              .map(l => l.replace(/^([\-*•])\s+/, '').trim())
              .filter(Boolean);
            return (
              <td className="text-xs sm:text-sm text-white/90 px-2 sm:px-3 py-2 border border-white/20 align-top">
                <ul className="list-disc list-inside space-y-1">
                  {items.map((it, idx) => (
                    <li key={idx}>{it}</li>
                  ))}
                </ul>
              </td>
            );
          }
          // Otherwise, preserve newlines
          return (
            <td className="text-xs sm:text-sm text-white/90 px-2 sm:px-3 py-2 border border-white/20">
              <div className="whitespace-pre-wrap">{children}</div>
            </td>
          );
        },
        strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-white/80">{children}</em>,
        hr: () => <hr className="border-white/20 my-3 sm:my-4" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
