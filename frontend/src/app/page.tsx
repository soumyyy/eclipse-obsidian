"use client";
import { useEffect, useRef, useState } from "react";
import Message from "@/components/Message";
import Sound from "@/components/Sound";
import HUD from "@/components/HUD";
import TasksDrawer from "@/components/TasksDrawer";
import { Plus, Mic, SendHorizonal } from "lucide-react";

type FileAttachment = { name: string; type: string };
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  attachments?: FileAttachment[];
  formatted?: boolean;
};

export default function Home() {
  const STORAGE_KEY = "eclipse_chat_messages";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [sessionId] = useState<string>(() => {
    try {
      const existing = (typeof window !== 'undefined' && localStorage.getItem('eclipse_session_id')) || '';
      if (existing) return existing;
      const sid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      if (typeof window !== 'undefined') localStorage.setItem('eclipse_session_id', sid);
      return sid;
    } catch {
      return Math.random().toString(36).slice(2);
    }
  });
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribingDots, setTranscribingDots] = useState("");
  const transcribeIntervalRef = useRef<any>(null);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        clearChat();
      }
      if (mod && (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'i')) {
        e.preventDefault();
        // Notify TasksDrawer to toggle
        window.dispatchEvent(new CustomEvent('toggle-todo'));
      }
      // Mic hotkeys: Cmd+M, F2, or F5 toggle recording
      if ((mod && e.key.toLowerCase() === 'm') || e.key === 'F2' || e.key === 'F5') {
        e.preventDefault();
        if (recording) stopRecording(); else startRecording();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording]);

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      // If there are pending files, upload first and show chips as a message
      if (pendingFiles.length > 0) {
        await uploadFiles(pendingFiles);
        setPendingFiles([]);
      }
      // Slash commands to persist memories/tasks explicitly
      let save_fact: string | undefined;
      let make_note: string | undefined;
      let save_task: string | undefined;
      const trimmed = userMsg.content.trim();
      if (/^\/(remember)\s+/i.test(trimmed)) {
        save_fact = trimmed.replace(/^\/(remember)\s+/i, "");
      } else if (/^\/(note)\s+/i.test(trimmed)) {
        make_note = trimmed.replace(/^\/(note)\s+/i, "");
      } else if (/^\/(task)\s+/i.test(trimmed)) {
        save_task = trimmed.replace(/^\/(task)\s+/i, "");
      }

      const resp = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "soumya", message: userMsg.content, save_fact, make_note, save_task, session_id: sessionId }),
      });
      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as any)?.error || "Server error");
      }
      // Insert a live assistant placeholder for streaming updates
      setMessages((m) => [...m, { role: "assistant", content: "", formatted: false }]);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let assistantContent = "";
      let finalSources: { path: string; score: number }[] | undefined;
      let finalMd: string | undefined;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const parts = acc.split("\n\n");
        acc = parts.pop() || "";
        for (const p of parts) {
          if (!p.startsWith("data: ")) continue;
          const chunk = p.slice(6);
          if (chunk === "[DONE]") {
            continue;
          }
          if (chunk.startsWith("{")) {
            try {
              const meta = JSON.parse(chunk);
              if (meta?.type === 'meta' && Array.isArray(meta?.sources)) {
                finalSources = meta.sources as any;
                continue;
              }
              if (meta?.type === 'final_md' && typeof meta?.content === 'string') {
                finalMd = meta.content as string;
                // Immediately replace last assistant message with final content
                setMessages((m) => {
                  const out = [...m];
                  if (out[out.length - 1]?.role === 'assistant') out[out.length - 1] = { role: 'assistant', content: finalMd, formatted: true } as any;
                  return out;
                });
                continue;
              }
            } catch {}
          }
          assistantContent += chunk;
          // live token rendering
          setMessages((m) => {
            const out = [...m];
            if (out[out.length - 1]?.role === "assistant") out[out.length - 1] = { role: "assistant", content: assistantContent, formatted: false } as ChatMessage;
            return out;
          });
        }
      }
      // attach sources and final formatted markdown once stream ends
      if (finalSources) {
        setMessages((m) => {
          const out = [...m];
          const last = out[out.length - 1];
          if (last?.role === 'assistant') out[out.length - 1] = { ...(last as any), sources: finalSources };
          return out;
        });
      }
      if (finalMd) {
        setMessages((m) => {
          const out = [...m];
          if (out[out.length - 1]?.role === 'assistant') out[out.length - 1] = { role: 'assistant', content: finalMd, formatted: true } as any;
          return out;
        });
      }
    } catch (err: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${err?.message || err}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) recordedChunksRef.current.push(evt.data);
      };
      mr.onstop = async () => {
        setTranscribing(true);
        try { clearInterval(transcribeIntervalRef.current); } catch {}
        transcribeIntervalRef.current = setInterval(() => {
          setTranscribingDots((d) => (d.length >= 3 ? "" : d + "."));
        }, 350);
        try {
          const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' });
          const form = new FormData();
          form.append('audio', blob, 'audio.webm');
          const resp = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = await resp.json();
          if (!resp.ok) throw new Error((data as any)?.error || 'Transcription failed');
          const txt = (data as any)?.text || '';
          setInput((prev) => (prev ? prev + ' ' + txt : txt));
          inputRef.current?.focus();
        } catch (err: any) {
          console.error(err);
        } finally {
          // release tracks
          stream.getTracks().forEach(t => t.stop());
          setTranscribing(false);
          try { clearInterval(transcribeIntervalRef.current); } catch {}
          setTranscribingDots("");
        }
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setRecording(false);
    }
  }

  function stopRecording() {
    try {
      mediaRecorderRef.current?.stop();
    } catch {}
    setRecording(false);
  }

  function clearChat() {
    setMessages([]);
    try { if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY); } catch {}
    inputRef.current?.focus();
  }

  // Drag & drop uploads (PDF/MD) — ephemeral per-session
  async function uploadFiles(files: File[]) {
    if (!files || files.length === 0) return;
    const form = new FormData();
    form.append('session_id', sessionId);
    for (const f of files) form.append('files', f);
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: form });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Upload failed');
      // show attachments as a chat message with chips
      const atts: FileAttachment[] = files.map(f => ({ name: f.name, type: f.type || 'application/octet-stream' }));
      setMessages((m) => [...m, { role: 'user', content: "", attachments: atts }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `Upload error: ${e?.message || e}` }]);
    }
  }

  useEffect(() => {
    const el = dropRef.current || document;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const onDragLeave = (e: DragEvent) => { e.preventDefault(); setDragOver(false); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault(); setDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      uploadFiles(files);
    };
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const files = Array.from(e.clipboardData.files || []);
      if (files.length > 0) {
        e.preventDefault();
        setPendingFiles((prev) => [...prev, ...files]);
        return;
      }
      const text = e.clipboardData.getData('text/plain');
      if (text && text.trim().length > 0) {
        // Treat pasted text as a markdown file
        e.preventDefault();
        const md = new File([text], 'pasted.md', { type: 'text/markdown' });
        setPendingFiles((prev) => [...prev, md]);
      }
    };
    el.addEventListener('dragover', onDragOver as any);
    el.addEventListener('dragleave', onDragLeave as any);
    el.addEventListener('drop', onDrop as any);
    el.addEventListener('paste', onPaste as any);
    return () => {
      el.removeEventListener('dragover', onDragOver as any);
      el.removeEventListener('dragleave', onDragLeave as any);
      el.removeEventListener('drop', onDrop as any);
      el.removeEventListener('paste', onPaste as any);
    };
  }, [sessionId]);

  return (
    <div ref={dropRef} className={"min-h-dvh flex flex-col bg-black relative " + (dragOver ? "outline-2 outline-cyan-500/60" : "") }>
      <HUD />
      <header className="border-b border-white/10 sticky top-0 bg-black/50 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-2 lg:px-4 py-2 flex items-center justify-center gap-4">
          <div className="flex items-center gap-3">
            <TasksDrawer userId="soumya" asHeader />
            <a href="/memories" className="text-xs text-neutral-400 hover:text-neutral-100 transition">Memories</a>
            <button onClick={clearChat} className="text-xs text-neutral-400 hover:text-neutral-100 transition">New chat</button>
            <button
              onClick={async () => {
                try {
                  const r = await fetch("/api/admin/reindex", { method: "POST" });
                  const d = await r.json();
                  if (!r.ok || !d?.ok) throw new Error(d?.error || "Reindex failed");
                  alert("Reindex started / completed.");
                } catch (e: any) {
                  alert(`Reindex error: ${e?.message || e}`);
                }
              }}
              className="text-xs text-neutral-400 hover:text-neutral-100 transition"
            >
              Reindex
            </button>
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
        <div ref={listRef} className="scrollbar-thin max-w-5xl mx-auto px-3 lg:px-6 py-5 space-y-3.5 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 140px)", scrollbarGutter: "stable both-edges" }}>
          {messages.map((m, i) => (
            <Message key={i} role={m.role} content={m.content} sources={m.sources} />
          ))}
          {/* Removed in-message typing loader for minimal design */}
        </div>
      </main>

      {/* Floating input bar */}
      <div className="fixed bottom-4 inset-x-0 px-3 pointer-events-none">
        <form onSubmit={sendMessage} className="max-w-3xl mx-auto pointer-events-auto">
          <div className="relative rounded-full border border-white/10 bg-black/60 backdrop-blur shadow-lg flex items-center gap-2 px-2 py-1.5">
            {loading && <div className="loading-underline" />}
            <button
              type="button"
              aria-label="Upload files"
              title="Upload files"
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-neutral-300 hover:text-white hover:bg-white/10"
            >
              <Plus size={18} />
            </button>
            <div className="flex-1 min-w-0 relative">
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {pendingFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-white/10 border border-white/10 rounded-full px-2 py-0.5">
                    <span className="inline-block w-3 h-3 rounded bg-white/80" aria-hidden />
                    <span className="truncate max-w-[12rem]" title={f.name}>{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="opacity-70 hover:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              id="chat-input"
              name="chat-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // auto-resize
                const el = inputRef.current;
                if (el) {
                  el.style.height = 'auto';
                  const max = 160; // px max
                  el.style.height = Math.min(el.scrollHeight, max) + 'px';
                }
              }}
              onKeyDown={(e) => {
                // Enter to send; Shift+Enter inserts newline
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={loading ? "Waiting for reply..." : "Hey soumya"}
              ref={inputRef}
              rows={1}
              className="w-full bg-transparent text-neutral-100 px-2 py-1.5 pr-12 outline-none placeholder:text-neutral-500 resize-none overflow-y-auto"
            />
            {transcribing && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">
                Transcribing{transcribingDots}
              </span>
            )}
            </div>
          <input
            type="file"
            accept=".pdf,.md,.markdown,text/markdown,text/plain,application/pdf"
            multiple
            ref={fileInputRef}
            id="file-upload"
            name="file-upload"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) uploadFiles(files);
              // reset so selecting same file again re-triggers change
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="hidden"
          />
            <button
              type="button"
              aria-label={recording ? "Stop recording" : "Start recording"}
              title={recording ? "Stop recording" : "Start recording (F5 / F2 / Cmd+M)"}
              onClick={() => { if (recording) stopRecording(); else startRecording(); }}
              className={"inline-flex items-center justify-center w-8 h-8 rounded-full " + (recording ? "bg-red-600 text-white" : "text-neutral-300 hover:text-white hover:bg-white/10")}
            >
              <Mic size={18} />
            </button>
            <button
              type="submit"
              disabled={loading}
              aria-label="Send"
              title="Send"
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white text-black disabled:opacity-50 hover:bg-neutral-200"
            >
              <SendHorizonal size={18} />
            </button>
          </div>
        </form>
      </div>
      <Sound play={messages[messages.length - 1]?.role === "assistant"} />
    </div>
  );
}
