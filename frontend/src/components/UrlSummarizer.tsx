"use client";
import { useState } from "react";

export default function UrlSummarizer() {
  const [url, setUrl] = useState("");
  const [res, setRes] = useState<{ title?: string; summary?: string; url?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const r = await fetch("/api/summarize-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, user_id: "soumya" }) });
      const d = await r.json();
      if (d.ok) setRes({ title: d.title, summary: d.summary, url: d.url });
      else setRes({ title: "Error", summary: d.error || "" });
    } catch (e: any) {
      setRes({ title: "Error", summary: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed left-3 bottom-20 z-20">
      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur p-3 w-[360px]">
        <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">URL Summarizer</div>
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-sm" />
          <button onClick={run} disabled={loading} className="text-xs px-2 py-1 rounded bg-white/10 border border-white/10 disabled:opacity-50">{loading ? "..." : "Summarize"}</button>
        </div>
        {res && (
          <div className="mt-3 text-sm text-neutral-200 space-y-2">
            {res.title && <div className="font-semibold">{res.title}</div>}
            {res.url && (
              <a href={res.url} target="_blank" className="text-xs underline decoration-dotted text-neutral-400" rel="noreferrer">Open original</a>
            )}
            {res.summary && <div className="whitespace-pre-wrap text-neutral-300">{res.summary}</div>}
          </div>
        )}
      </div>
    </div>
  );
}


