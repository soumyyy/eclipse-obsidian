"use client";
import { useEffect, useRef, useState } from "react";
import Message from "@/components/Message";
import TypingBeam from "@/components/TypingBeam";
import Sound from "@/components/Sound";
import HUD from "@/components/HUD";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
};

export default function Home() {
  const STORAGE_KEY = "eclipse_chat_messages";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Load persisted conversation on mount
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every change
  useEffect(() => {
    try {
      if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "soumya", message: userMsg.content }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Server error");
      const assistant: ChatMessage = {
        role: "assistant",
        content: data.reply || "",
        sources: data.sources || [],
      };
      setMessages((m) => [...m, assistant]);
    } catch (err: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${err?.message || err}` }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    try { if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY); } catch {}
    inputRef.current?.focus();
  }

  return (
    <div className="min-h-dvh flex flex-col bg-black relative">
      <HUD />
      <header className="border-b border-white/10 sticky top-0 bg-black/50 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-2 lg:px-4 py-2 flex items-center justify-between">
          <div className="font-medium tracking-tight text-neutral-200">Eclipse</div>
          <div className="flex items-center gap-3">
            <button onClick={clearChat} className="text-xs text-neutral-400 hover:text-neutral-100 transition">New chat</button>
            <button
              onClick={async () => {
                try {
                  const r = await fetch("/api/health", { cache: "no-store" });
                  const d = await r.json();
                  setHealthy(d.ok === true);
                  if (!d.ok) alert(`Backend issue: ${d.error || "unknown"}`);
                } catch (e: any) { setHealthy(false); alert(`Backend issue: ${e?.message || e}`); }
              }}
              className="relative"
              aria-label="backend status"
              title="Backend status"
            >
              <span className={(healthy === null ? "bg-neutral-500" : healthy ? "bg-emerald-500" : "bg-red-500") + " inline-block w-2.5 h-2.5 rounded-full"} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div ref={listRef} className="scrollbar-thin max-w-5xl mx-auto px-2 lg:px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 140px)", scrollbarGutter: "stable both-edges" }}>
          {messages.map((m, i) => (
            <Message key={i} role={m.role} content={m.content} sources={m.sources} />
          ))}
          {loading && (
            <div className="px-4">
              <TypingBeam />
            </div>
          )}
        </div>
      </main>

      <form onSubmit={sendMessage} className="sticky bottom-0 border-t border-white/10 bg-black/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-2 lg:px-4 py-2 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={loading ? "Waiting for reply..." : "Ask anything about your vault"}
            ref={inputRef}
            className="flex-1 rounded-2xl bg-black/50 text-neutral-100 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-700/50 backdrop-blur placeholder:text-neutral-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl px-4 py-2 bg-white/90 text-black disabled:opacity-50 hover:bg-white transition"
          >
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
      <Sound play={messages[messages.length - 1]?.role === "assistant"} />
    </div>
  );
}
