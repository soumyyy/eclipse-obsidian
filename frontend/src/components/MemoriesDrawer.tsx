"use client";
import { useEffect, useState } from "react";

type Mem = { id: number; ts: number; type: string; content: string };

export default function MemoriesDrawer({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Mem[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const u = new URL("/api/memories", location.origin);
    u.searchParams.set("user_id", userId);
    if (q) u.searchParams.set("contains", q);
    if (type) u.searchParams.set("type", type);
    const r = await fetch(u.toString(), { cache: "no-store" });
    const d = await r.json();
    if (d.ok) setItems(d.items || []);
    setLoading(false);
  }

  useEffect(() => { if (open) load(); }, [open, load]);

  async function save(mem: Mem) {
    const r = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mem_id: mem.id, user_id: userId, content: mem.content, type: mem.type }) });
    const d = await r.json();
    if (d.ok) load();
  }

  async function remove(id: number) {
    const r = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mem_id: id, user_id: userId, action: "delete" }) });
    const d = await r.json();
    if (d.ok) setItems((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="fixed right-3 bottom-36 z-20">
      <button onClick={() => setOpen((o) => !o)} className="rounded-full border border-white/10 bg-black/60 backdrop-blur px-3 py-2 text-xs text-neutral-200 hover:bg-black/70 transition">{open ? "Close memories" : "Memories"}</button>
      {open && (
        <div className="mt-2 w-[380px] max-h-[65vh] overflow-auto rounded-2xl border border-white/10 bg-black/60 backdrop-blur p-3 space-y-3">
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-sm" />
            <select value={type} onChange={(e) => setType(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm">
              <option value="">All</option>
              <option value="fact">Fact</option>
              <option value="note">Note</option>
              <option value="summary">Summary</option>
            </select>
            <button onClick={load} className="text-xs px-2 py-1 rounded bg-white/10 border border-white/10">Go</button>
          </div>
          {loading && <div className="text-xs text-neutral-400">Loading…</div>}
          {!loading && items.length === 0 && <div className="text-xs text-neutral-400">No memories</div>}
          {items.map((m) => (
            <div key={m.id} className="rounded-xl border border-white/10 bg-black/50 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <select value={m.type} onChange={(e) => setItems((prev) => prev.map((x) => x.id === m.id ? { ...x, type: e.target.value } as Mem : x))} className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs">
                  <option value="fact">fact</option>
                  <option value="note">note</option>
                  <option value="summary">summary</option>
                </select>
                <button onClick={() => save(m)} className="ml-auto text-xs px-2 py-1 rounded bg-white/10 border border-white/10">Save</button>
                <button onClick={() => remove(m.id)} className="text-xs px-2 py-1 rounded bg-red-600/20 border border-red-500/30 text-red-300">Delete</button>
              </div>
              <textarea value={m.content} onChange={(e) => setItems((prev) => prev.map((x) => x.id === m.id ? { ...x, content: e.target.value } as Mem : x))} className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-sm min-h-[80px]" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


