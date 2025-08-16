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
  const listRef = useRef<HTMLDivElement | null>(null);

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
  }

  return (
    <div className="min-h-dvh flex flex-col bg-black relative">
      <HUD />
      <header className="border-b border-white/10 sticky top-0 bg-black/50 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-3 lg:px-6 py-3 flex items-center justify-between">
          <div className="font-semibold tracking-tight">Eclispe</div>
          <div className="flex items-center gap-3">
            <button onClick={clearChat} className="text-xs text-neutral-400 hover:text-neutral-100 transition">New chat</button>
            <div className="text-xs text-neutral-500">Connected</div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div ref={listRef} className="max-w-5xl mx-auto px-3 lg:px-6 py-6 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 140px)" }}>
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
        <div className="max-w-5xl mx-auto px-3 lg:px-6 py-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={loading ? "Waiting for reply..." : "Ask anything about your vault"}
            className="flex-1 rounded-2xl bg-black/50 text-neutral-100 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-700/50 backdrop-blur"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl px-5 py-3 bg-white/90 text-black disabled:opacity-50 hover:bg-white transition"
          >
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
      <Sound play={messages[messages.length - 1]?.role === "assistant"} />
    </div>
  );
}
