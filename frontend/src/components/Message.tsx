"use client";

import React, { useMemo, useState, useCallback, Children } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkSlug from "remark-slug";
import remarkExternalLinks from "remark-external-links";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

type Source = { path: string; score: number };

export interface MessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

function normalizeOutsideFences(input: string, transform: (segment: string) => string) {
  const parts = input.split(/(```[\s\S]*?```)/g);
  return parts.map((p) => (p.startsWith("```") ? p : transform(p))).join("");
}

function normalizeSpaces(txt: string) {
  return txt
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]{3,}/g, "  ")
    .replace(/\n{4,}/g, "\n\n\n");
}

function ensureNewlineBeforeHeadings(txt: string) {
  return txt
    .replace(/([^\n])\n?(#{1,6}\s)/g, "$1\n\n$2")
    .replace(/^(#{1,6}\s[^\n]+)(?!\n)/gm, "$1\n");
}

function ensureListLines(txt: string) {
  return txt
    .replace(/\s{2,}-\s/g, "\n- ")
    .replace(/\s{2,}(\d+)\.\s/g, "\n$1. ")
    .replace(/[•▪‣]\s/g, "\n- ");
}

function ensureBalancedFences(txt: string) {
  const fences = (txt.match(/```/g) || []).length;
  return fences % 2 === 1 ? txt + "\n```" : txt;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function headingWithAnchor<Tag extends "h1" | "h2" | "h3" | "h4" | "h5" | "h6">(tag: Tag) {
  return function Heading({ children, id, ...props }: React.ComponentProps<Tag> & { id?: string }) {
    const TagEl = tag as any;
    const fallbackId = String(children ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    const anchorId = id || fallbackId;
    return (
      <TagEl {...props} id={anchorId} className="group scroll-mt-20">
        {children}
        {!!anchorId && (
          <a
            href={`#${anchorId}`}
            className="opacity-0 group-hover:opacity-100 text-xs ml-2 text-neutral-400 hover:text-neutral-200 transition-opacity no-underline hidden"
            aria-label="Link to heading"
          >
            #
          </a>
        )}
      </TagEl>
    );
  };
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [code]);

  return (
    <div className="my-2 rounded-xl border border-white/10 bg-black/60 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-2 border-b border-white/10">
        <div className="flex items-center gap-2 text-[11px] text-neutral-300">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500/70" />
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-500/70" />
          <span className="inline-block w-2 h-2 rounded-full bg-green-500/70" />
          <span className="ml-2 uppercase tracking-wide">{lang || "text"}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWrap((w) => !w)}
            className="text-[11px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 border border-white/10"
            aria-pressed={wrap}
          >
            {wrap ? "nowrap" : "wrap"}
          </button>
          <button
            onClick={onCopy}
            className="text-[11px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 border border-white/10"
          >
            {copied ? "✓ copied" : "copy"}
          </button>
        </div>
      </div>
      <pre
        className={[
          "p-2 text-xs md:text-sm leading-relaxed max-h-96 overflow-auto",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        ].join(" ")}
      >
        <code className={lang ? `language-${lang}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

export default function Message({ role, content, sources }: MessageProps) {
  const isUser = role === "user";
  const [open, setOpen] = useState(false);

  const normalized = useMemo(() => {
    const raw = String(content || "");
    let pre = raw.replace(/<br\s*\/>/gi, "\n").replace(/<br\s*>/gi, "\n");
    pre = normalizeOutsideFences(pre, (segment) => {
      segment = normalizeSpaces(segment);
      segment = ensureNewlineBeforeHeadings(segment);
      segment = ensureListLines(segment);
      segment = ensureBalancedFences(segment);
      return segment.trim();
    });
    return pre;
  }, [content]);

  const components: import("react-markdown").Components = {
    a({ href, children, ...props }) {
      return (
        <a
          href={String(href)}
          target="_blank"
          rel="noreferrer"
          {...props}
          className="underline decoration-dotted underline-offset-4 hover:text-cyan-300 transition-colors"
        >
          {children}
        </a>
      );
    },
    h1: headingWithAnchor("h1"),
    h2: headingWithAnchor("h2"),
    h3: headingWithAnchor("h3"),
    h4: headingWithAnchor("h4"),
    h5: headingWithAnchor("h5"),
    h6: headingWithAnchor("h6"),
    blockquote({ children, ...props }) {
      return (
        <blockquote
          {...props}
          className="border-l-2 border-cyan-500/50 bg-white/5 rounded-r px-3 py-2 text-neutral-200 italic"
        >
          {children}
        </blockquote>
      );
    },
    ul({ children, ...props }) {
      return <ul {...props} className="list-disc pl-6 space-y-1 my-3">{children}</ul>;
    },
    ol({ children, ...props }) {
      return <ol {...props} className="list-decimal pl-6 space-y-1 my-3">{children}</ol>;
    },
    li({ children, ...props }) {
      return <li {...props} className="text-neutral-200">{children}</li>;
    },
    p({ children, ...props }) {
      return <p {...props} className="text-neutral-200 leading-relaxed my-3">{children}</p>;
    },
    strong({ children, ...props }) {
      return <strong {...props} className="font-semibold text-white">{children}</strong>;
    },
    b({ children, ...props }) {
      return <b {...props} className="font-semibold text-white">{children}</b>;
    },
    em({ children, ...props }) {
      return <em {...props} className="italic text-neutral-100">{children}</em>;
    },
    code({ className, children }: any) {
      const raw = Children.toArray(children)
        .map((c: any) => (typeof c === "string" ? c : c?.props?.children ?? ""))
        .join("");
      const isBlock = /\blanguage-/.test(String(className || ""));
      const lang = String(className || "").replace("language-", "") || undefined;
      if (!isBlock) {
        return <code className="bg-white/10 text-cyan-300 rounded px-1.5 py-0.5 text-[12px] font-mono">{children}</code>;
      }
      return <CodeBlock code={raw} lang={lang} />;
    },
    table({ children, ...props }) {
      return (
        <div className="w-full overflow-x-auto my-4">
          <table className="w-full border-collapse rounded-lg overflow-hidden bg-white/5" {...props}>
            {children}
          </table>
        </div>
      );
    },
    thead({ children, ...props }) {
      return <thead className="bg-white/10 sticky top-0" {...props}>{children}</thead>;
    },
    tbody({ children, ...props }) {
      return <tbody {...props}>{children}</tbody>;
    },
    tr({ children, ...props }) {
      return <tr {...props} className="border-b border-white/10 last:border-b-0">{children}</tr>;
    },
    th({ children, ...props }) {
      return <th className="text-left text-sm font-semibold px-3 py-2 text-neutral-200" {...props}>{children}</th>;
    },
    td({ children, ...props }) {
      return <td className="text-sm px-3 py-2 align-top text-neutral-200" {...props}>{children}</td>;
    },
    hr(props) {
      return <hr className="my-6 border-white/20" {...props} />;
    },
    img({ src, alt, ...props }) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...props}
          src={src}
          alt={alt}
          className="rounded-lg max-w-full h-auto border border-white/10"
          loading="lazy"
        />
      );
    },
    del({ children, ...props }) {
      return <del {...props} className="line-through text-neutral-400">{children}</del>;
    },
  };

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "relative max-w-[85%] rounded-2xl px-3 py-2 border backdrop-blur-md bg-gradient-to-br",
          "shadow-[0_0_0_1px_rgba(255,255,255,0.04)]",
          isUser
            ? "from-cyan-400/10 to-transparent border-cyan-500/30"
            : "from-white/10 to-transparent border-white/10",
        ].join(" ")}
      >
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)" }}
        />

        <div className="prose prose-invert prose-xs sm:prose-sm md:prose-sm max-w-none [--tw-prose-pre-code:theme(fontSize.sm)]">
          <ReactMarkdown
            remarkPlugins={[
              remarkGfm,
              remarkBreaks,
              remarkSlug,
              [remarkExternalLinks, { target: "_blank", rel: ["noreferrer", "noopener"] }],
            ]}
            rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }], [rehypeSanitize, {
              ...defaultSchema,
              attributes: {
                ...defaultSchema.attributes,
                code: [
                  ...(defaultSchema.attributes?.code || []),
                  ["className", /^language-[a-z0-9-]+$/],
                ],
                span: [
                  ...(defaultSchema.attributes?.span || []),
                  ["className", /^hljs-.*$/],
                ],
              },
            }]]}
            components={components}
          >
            {normalized}
          </ReactMarkdown>
        </div>

        {!!sources?.length && (
          <details className="mt-2 text-xs text-neutral-300 border-t border-white/10 pt-2">
            <summary className="cursor-pointer text-neutral-400">Sources</summary>
            <ul className="mt-2 space-y-1">
              {sources.map((s, i) => {
                const label = `${s.path} (${(s.score ?? 0).toFixed(3)})`;
                const base = process.env.NEXT_PUBLIC_VAULT_BASE_URL?.replace(/\/+$/, "");
                const href = base ? `${base}/${encodePath(s.path)}` : undefined;
                return (
                  <li key={i} className="flex items-center gap-2 min-w-0">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500 shrink-0" />
                    {href ? (
                      <a className="truncate underline decoration-dotted" href={href} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    ) : (
                      <span className="truncate">{label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}


