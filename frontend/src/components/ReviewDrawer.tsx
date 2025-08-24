"use client";
import { useEffect, useState } from "react";

type PendingItem = {
  id: number;
  ts: number;
  type: string;
  content: string;
  confidence?: number;
  priority?: number;
  due_ts?: number;
  extra?: string;
};

export default function ReviewDrawer({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/memories/pending?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setItems(d.items || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { if (open) load(); }, [open, load]);

  async function approve(id: number) {
    const r = await fetch(`/api/memories/pending/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
    const d = await r.json();
    if (d.ok) setItems((it) => it.filter((x) => x.id !== id));
  }

  async function reject(id: number) {
    const r = await fetch(`/api/memories/pending/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
    const d = await r.json();
    if (d.ok) setItems((it) => it.filter((x) => x.id !== id));
  }

  return (
    <div className="fixed right-3 bottom-20 z-20">
      <button onClick={() => setOpen((o) => !o)} className="rounded-full border border-white/10 bg-black/60 backdrop-blur px-3 py-2 text-xs text-neutral-200 hover:bg-black/70 transition">
        {open ? "Close review" : `Review (${items.length})`}
      </button>
      {open && (
        <div className="mt-2 w-[360px] max-h-[60vh] overflow-auto rounded-2xl border border-white/10 bg-black/60 backdrop-blur p-3 space-y-2">
          {loading && <div className="text-xs text-neutral-400">Loading…</div>}
          {!loading && items.length === 0 && <div className="text-xs text-neutral-400">No pending items</div>}
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-white/10 bg-black/50 p-3">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                <span>{it.type}</span>
                {!!it.confidence && <span>conf {Math.round(it.confidence * 100)}%</span>}
              </div>
              <div className="text-sm text-neutral-100 whitespace-pre-wrap">{it.content}</div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button onClick={() => reject(it.id)} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10">Reject</button>
                <button onClick={() => approve(it.id)} className="text-xs px-2 py-1 rounded bg-white/90 text-black hover:bg-white">Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


