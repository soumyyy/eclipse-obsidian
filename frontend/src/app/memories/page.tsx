"use client";
import { useEffect, useMemo, useState } from "react";

type Mem = { id: number; ts: number; type: string; content: string };
type Pending = { id: number; ts?: number; type: string; content: string };

export default function MemoriesPage() {
  const userId = "soumya";
  const [items, setItems] = useState<Mem[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState<Record<number, string>>({});
  const [draftType, setDraftType] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    const u = new URL("/api/memories", location.origin);
    u.searchParams.set("user_id", userId);
    u.searchParams.set("limit", "1000");
    if (q) u.searchParams.set("contains", q);
    if (type) u.searchParams.set("type", type);
    const r = await fetch(u.toString(), { cache: "no-store" });
    const d = await r.json();
    if (d.ok) setItems(d.items || []);
    // Load pending suggestions too
    try {
      const pr = await fetch(`/api/memories/pending?user_id=${encodeURIComponent(userId)}&limit=100`, { cache: "no-store" });
      const pd = await pr.json();
      if (pd.ok) setPending(pd.items || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load();
    const onVis = () => { if (!document.hidden) load(); };
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  async function save(mem: Mem) {
    const r = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mem_id: mem.id, user_id: userId, content: mem.content, type: mem.type }) });
    const d = await r.json();
    if (d.ok) {
      setEditingId(null);
      setDraftContent((prev) => { const n = { ...prev }; delete n[mem.id]; return n; });
      setDraftType((prev) => { const n = { ...prev }; delete n[mem.id]; return n; });
      load();
    }
  }

  async function remove(id: number) {
    const r = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mem_id: id, user_id: userId, action: "delete" }) });
    const d = await r.json();
    if (d.ok) setItems((prev) => prev.filter((m) => m.id !== id));
  }

  async function approve(pid: number) {
    const r = await fetch(`/api/memories/pending/${pid}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
    const d = await r.json();
    if (d.ok) load();
  }

  async function reject(pid: number) {
    const r = await fetch(`/api/memories/pending/${pid}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
    const d = await r.json();
    if (d.ok) setPending((prev) => prev.filter((p) => p.id !== pid));
  }

  async function deleteAll() {
    if (!confirm("Delete all memories?")) return;
    const r = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, action: "delete_all" }) });
    const d = await r.json();
    if (d.ok) load();
  }

  const merged = useMemo(() => {
    // Combine pending and saved into a single chronological list
    const saved = items.map((m) => ({
      kind: "saved" as const,
      id: m.id,
      ts: m.ts || 0,
      type: m.type,
      content: m.content,
      raw: m,
    }));
    const pend = pending.map((p) => ({
      kind: "pending" as const,
      id: p.id,
      ts: p.ts || 0,
      type: p.type,
      content: p.content,
      raw: p,
    }));
    return [...saved, ...pend].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }, [items, pending]);

  return (
    <div className="min-h-dvh bg-[#0b0c10] text-neutral-100">
      <header className="border-b border-white/10 sticky top-0 bg-black/40 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-semibold tracking-tight">Memories</div>
          <a href="/" className="text-xs text-neutral-400 hover:text-neutral-100">Back</a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-2 text-sm" />
          <select value={type} onChange={(e) => setType(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-2 text-sm">
            <option value="">All</option>
            <option value="fact">Fact</option>
            <option value="note">Note</option>
            <option value="summary">Summary</option>
          </select>
          <button onClick={load} className="text-xs px-3 py-2 rounded bg-white/10 border border-white/10">Filter</button>
          <button onClick={deleteAll} className="text-xs px-3 py-2 rounded bg-red-600/20 border border-red-500/30 text-red-300">Delete all</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {merged.map((row) => (
            <div key={`${row.kind}-${row.id}`} className="rounded-2xl border border-white/10 bg-black/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded border ${row.kind === 'pending' ? 'border-amber-500/40 bg-amber-600/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-600/10 text-emerald-300'}`}>{row.kind === 'pending' ? 'Pending' : 'Saved'}</span>
                <div className="ml-auto flex items-center gap-2">
                  {row.kind === 'pending' ? (
                    <>
                      <button onClick={() => approve(row.id)} className="px-2 py-1 text-[11px] rounded border border-amber-500/40 bg-amber-600/10 text-amber-200 hover:bg-amber-600/20">Approve</button>
                      <button onClick={() => reject(row.id)} className="px-2 py-1 text-[11px] rounded border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10">Reject</button>
                    </>
                  ) : (
                    <div className="relative">
                      <button onClick={() => setMenuOpenId((cur) => (cur === row.id ? null : row.id))} className="px-2 py-1 text-xs rounded bg-white/10 border border-white/10">⋯</button>
                      {menuOpenId === row.id && (
                        <div className="absolute right-0 mt-1 w-32 rounded border border-white/10 bg-black/80 backdrop-blur p-1 text-xs space-y-1 z-10">
                          <button onClick={() => { setEditingId(row.id); setMenuOpenId(null); }} className="w-full text-left px-2 py-1 hover:bg-white/10 rounded">Edit</button>
                          <button onClick={() => { setMenuOpenId(null); remove(row.id); }} className="w-full text-left px-2 py-1 hover:bg-white/10 rounded text-red-300">Delete</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {row.kind === 'saved' ? (
                editingId === row.id ? (
                  <div className="space-y-2">
                    <select value={draftType[row.id] ?? (row.raw as Mem).type} onChange={(e) => setDraftType((prev) => ({ ...prev, [row.id]: e.target.value }))} className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs">
                      <option value="fact">fact</option>
                      <option value="note">note</option>
                      <option value="summary">summary</option>
                    </select>
                    <textarea value={draftContent[row.id] ?? (row.raw as Mem).content} onChange={(e) => setDraftContent((prev) => ({ ...prev, [row.id]: e.target.value }))} className="w-full bg-black/40 border border-white/10 rounded px-2 py-2 text-sm min-h-[120px]" />
                    {((draftContent[row.id] ?? (row.raw as Mem).content) !== (row.raw as Mem).content || (draftType[row.id] ?? (row.raw as Mem).type) !== (row.raw as Mem).type) && (
                      <button onClick={() => save({ id: row.id, ts: (row.raw as Mem).ts, type: (draftType[row.id] ?? (row.raw as Mem).type), content: (draftContent[row.id] ?? (row.raw as Mem).content) })} className="text-xs px-2 py-1 rounded bg-white/10 border border-white/10">Save</button>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-neutral-300 whitespace-pre-wrap">{(row.raw as Mem).content}</div>
                )
              ) : (
                <div className="text-sm text-neutral-300 whitespace-pre-wrap">{row.content}</div>
              )}
            </div>
          ))}
        </div>
        {!loading && items.length === 0 && <div className="text-sm text-neutral-500">No memories to show.</div>}
      </main>
    </div>
  );
}


