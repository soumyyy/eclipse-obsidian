"use client";
import { useEffect, useState } from "react";

type Task = { id: number; content: string; due_ts?: number; status: string; created_ts: number };


export default function TasksDrawer({ userId, asHeader }: { userId: string; asHeader?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");

  async function load() {
    const u = new URL("/api/tasks", location.origin);
    u.searchParams.set("user_id", userId);
    u.searchParams.set("status", "open");
    u.searchParams.set("limit", "200");
    const r = await fetch(u.toString(), { cache: "no-store" });
    const d = await r.json();
    if (d.ok) setTasks(d.tasks || []);
  }
  useEffect(() => { if (open) load(); }, [open, load]);

  // Listen for global toggle event from keyboard shortcuts
  useEffect(() => {
    const onToggle = () => setOpen((o) => !o);
    window.addEventListener('toggle-todo', onToggle as unknown as EventListener);
    return () => window.removeEventListener('toggle-todo', onToggle as unknown as EventListener);
  }, []);

  async function add() {
    if (!newTask.trim()) return;
    const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, content: newTask }) });
    if (r.ok) { setNewTask(""); load(); }
  }

  async function complete(id: number) {
    const u = new URL(`/api/tasks/${id}/complete`, location.origin);
    u.searchParams.set("user_id", userId);
    const r = await fetch(u.toString(), { method: "POST" });
    if (r.ok) load();
  }

  const containerCls = asHeader ? "absolute right-2 top-10" : "fixed right-4 bottom-24";
  return (
    <div className={`${containerCls} z-20`}>
      <button onClick={() => setOpen((o) => !o)} className="rounded-full border border-white/10 bg-black/70 backdrop-blur px-3 py-2 text-xs text-neutral-200 hover:bg-black/80 transition">{open ? "Close" : "To-Do"}</button>
      {open && (
        <div className="mt-2 w-[380px] max-h-[70vh] overflow-auto rounded-2xl border border-white/10 bg-black/80 backdrop-blur-sm p-3 space-y-3 shadow-xl">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Quick Add</div>
            <div className="flex gap-2">
              <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="New task..." className="flex-1 bg-black/60 border border-white/10 rounded px-2 py-2 text-sm" />
              <button onClick={add} className="text-xs px-3 py-2 rounded bg-white/10 border border-white/10 hover:bg-white/20">Add</button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Open Tasks</div>
            {tasks.length === 0 && <div className="text-xs text-neutral-500">Nothing due.</div>}
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <button onClick={() => complete(t.id)} className="mt-1 inline-flex w-4 h-4 rounded-sm border border-white/20 bg-black/50" aria-label="Complete" />
                  <div className="min-w-0 flex-1">
                    <div className="text-neutral-200 truncate">{t.content}</div>
                    {t.due_ts && <div className="text-[10px] text-neutral-500">Due {new Date(t.due_ts * 1000).toLocaleString()}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}


