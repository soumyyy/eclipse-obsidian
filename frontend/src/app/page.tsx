"use client";
import { useState, useRef, useEffect } from "react";
import Message from "@/components/Message";
import Sound from "@/components/Sound";

import HUD from "@/components/HUD";
import TasksPanel from "@/components/TasksPanel";
import ChatSidebar from "@/components/ChatSidebar";
import { Plus, Mic, SendHorizonal, MessageSquare } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  formatted?: boolean;
  attachments?: { name: string; type: string }[];
}

interface FileAttachment {
  name: string;
  type: string;
}

// File icon component for different file types
function FileIcon({ file }: { file: File }) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const type = file.type;
  
  if (type.includes('pdf') || ext === 'pdf') {
    return <div className="w-5 h-5 bg-red-500 rounded flex items-center justify-center text-white text-xs font-bold">PDF</div>;
  }
  if (type.includes('markdown') || ext === 'md' || ext === 'markdown') {
    return <div className="w-5 h-5 bg-blue-500 rounded flex items-center justify-center text-white text-xs font-bold">MD</div>;
  }
  if (type.includes('text') || ext === 'txt') {
    return <div className="w-5 h-5 bg-green-500 rounded flex items-center justify-center text-white text-xs font-bold">TXT</div>;
  }
  return <div className="w-5 h-5 bg-gray-500 rounded flex items-center justify-center text-white text-xs font-bold">FILE</div>;
}

export default function Home() {
  const STORAGE_KEY = "eclipse_chat_messages";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
  const transcribeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activeSession, setActiveSession] = useState<string>(sessionId);
  const [showTasks, setShowTasks] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  const [healthy, setHealthy] = useState<boolean | null>(null);

  const createNewChatSession = async () => {
    try {
      setCreatingSession(true);
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
        },
        body: JSON.stringify({
          user_id: "soumya",
          title: "New Chat"
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setActiveSession(data.session.id);
        setMessages([]);
        inputRef.current?.focus();
      }
    } catch (error) {
      console.error("Error creating new session:", error);
    } finally {
      setCreatingSession(false);
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    setActiveSession(sessionId);
    setMessages([]);
    
    // Load session history from Redis
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions/${sessionId}/history?user_id=soumya`, {
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const historyMessages: ChatMessage[] = (data.messages || []).map((msg: { role: string; content: string; sources?: { path: string; score: number }[] }) => ({
          role: msg.role,
          content: msg.content,
          sources: msg.sources || [],
          formatted: true
        }));
        setMessages(historyMessages);
      }
    } catch (error) {
      console.error("Error loading session history:", error);
    }
  };

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
        createNewChatSession();
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setShowTasks(!showTasks);
      }
      // Mic hotkeys: Cmd+M, F2, or F5 toggle recording
      if ((mod && e.key.toLowerCase() === 'm') || e.key === 'F2' || e.key === 'F5') {
        e.preventDefault();
        if (recording) {
          stopRecording();
        } else {
          startRecording();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, showTasks]);

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;
    
    // Create a new session if none exists
    let currentSessionId = activeSession;
    if (!currentSessionId) {
      try {
        setCreatingSession(true);
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions`, {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
          },
          body: JSON.stringify({
            user_id: "soumya",
            title: input.substring(0, 50) + (input.length > 50 ? "..." : "")
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          currentSessionId = data.session.id;
          setActiveSession(currentSessionId);
        }
      } catch (error) {
        console.error("Error creating session:", error);
      } finally {
        setCreatingSession(false);
      }
    }
    
    const userMsg: ChatMessage = { role: "user", content: input };
    setInput("");
    setLoading(true);
    try {
      // If there are pending files, upload first and then show chips ABOVE the text message
      if (pendingFiles.length > 0) {
        const form = new FormData();
        form.append('session_id', activeSession || sessionId);
        for (const f of pendingFiles) form.append('files', f);
        try {
          const r = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/upload`, { 
            method: 'POST', 
            body: form,
            headers: {
              'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
            }
          });
          const d = await r.json();
          if (!r.ok || !d?.ok) throw new Error(d?.error || 'Upload failed');
          // first add the attachments chip row, then the user's text
          const atts: FileAttachment[] = pendingFiles.map(f => ({ name: f.name, type: f.type || 'application/octet-stream' }));
          setMessages((m) => [...m, { role: 'user', content: "", attachments: atts }, userMsg]);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
          console.error(errorMessage);
          // even if upload fails, still show the text message
          setMessages((m) => [...m, userMsg]);
        }
        setPendingFiles([]);
      } else {
        // No attachments: just add the user's text
        setMessages((m) => [...m, userMsg]);
      }
      // If this is the very first message in this session, set the session title to the prompt
      try {
        if (messages.length === 0 && currentSessionId) {
          await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions/${currentSessionId}/title?user_id=soumya&title=${encodeURIComponent(userMsg.content.slice(0, 80))}`, {
            method: 'POST',
            headers: { 'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop' }
          });
        }
      } catch {}
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

      const resp = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/chat/stream`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
        },
        body: JSON.stringify({ user_id: "soumya", message: userMsg.content, save_fact, make_note, save_task, session_id: currentSessionId }),
      });
      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error || "Server error");
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
                finalSources = meta.sources as { path: string; score: number }[];
                continue;
              }
              if (meta?.type === 'final_md' && typeof meta?.content === 'string') {
                finalMd = meta.content as string;
                // Immediately replace last assistant message with final content
                setMessages((m) => {
                  const out = [...m];
                  if (out[out.length - 1]?.role === 'assistant') out[out.length - 1] = { role: 'assistant', content: finalMd, formatted: true } as ChatMessage;
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
          if (last?.role === 'assistant') out[out.length - 1] = { ...(last as ChatMessage), sources: finalSources };
          return out;
        });
      }
      if (finalMd) {
        setMessages((m) => {
          const out = [...m];
          if (out[out.length - 1]?.role === 'assistant') out[out.length - 1] = { role: 'assistant', content: finalMd, formatted: true } as ChatMessage;
          return out;
        });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${errorMessage}` }]);
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
        try { 
          if (transcribeIntervalRef.current) {
            clearInterval(transcribeIntervalRef.current); 
          }
        } catch {}
        transcribeIntervalRef.current = setInterval(() => {
          setTranscribingDots((d) => (d.length >= 3 ? "" : d + "."));
        }, 350);
        try {
          const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' });
          const form = new FormData();
          form.append('audio', blob, 'audio.webm');
          const resp = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = await resp.json();
          if (!resp.ok) throw new Error((data as { error?: string })?.error || 'Transcription failed');
          const txt = (data as { text?: string })?.text || '';
          setInput((prev) => (prev ? prev + ' ' + txt : txt));
          inputRef.current?.focus();
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
          console.error(errorMessage);
        } finally {
          // release tracks
          stream.getTracks().forEach(t => t.stop());
          setTranscribing(false);
          try { 
            if (transcribeIntervalRef.current) {
              clearInterval(transcribeIntervalRef.current); 
            }
          } catch {}
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



  // Drag & drop uploads (PDF/MD) — ephemeral per-session
  // Files are now handled as pending attachments until manually sent

  useEffect(() => {
    const el = dropRef.current || document;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const onDragLeave = (e: DragEvent) => { e.preventDefault(); setDragOver(false); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault(); setDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      // Don't auto-upload, just add to pending files
      setPendingFiles((prev) => [...prev, ...files]);
    };
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      if (!items || items.length === 0) return;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("text/")) {
          item.getAsString((text) => {
            if (!text) return;
            const looksLikeCode = /```[\s\S]*```/.test(text) ||
                                  (text.includes('\n') && /\b(function|class|import|export|const|let|var|if|for|while|return)\b/.test(text));
            if (looksLikeCode) {
              const blob = new Blob([text], { type: 'text/markdown' });
              const file = new File([blob], 'pasted-code.md', { type: 'text/markdown' });
              setPendingFiles(prev => [...prev, file]);
            } else {
              setInput(prev => (prev ? prev + (prev.endsWith(' ') ? '' : ' ') + text : text));
            }
          });
        } else if (item.type.startsWith("application/") || item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) setPendingFiles(prev => [...prev, file]);
        }
      }
    };
    el.addEventListener('dragover', onDragOver as EventListener);
    el.addEventListener('dragleave', onDragLeave as EventListener);
    el.addEventListener('drop', onDrop as unknown as EventListener);
    el.addEventListener('paste', onPaste as unknown as EventListener);
    return () => {
      el.removeEventListener('dragover', onDragOver as EventListener);
      el.removeEventListener('dragleave', onDragLeave as EventListener);
      el.removeEventListener('drop', onDrop as unknown as EventListener);
      el.removeEventListener('paste', onPaste as unknown as EventListener);
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white">
      {/* Main Content */}
      <div className="transition-all duration-300">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-xl border-b border-gray-600 shadow-2xl">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <button
                  onClick={() => setChatSidebarOpen(true)}
                  className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border border-gray-600"
                  title="Open chats"
                  aria-label="Open chats"
                >
                  <MessageSquare className="w-5 h-5" />
                </button>
                
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowTasks(!showTasks)}
                    className="text-sm text-gray-300 hover:text-white transition-colors hover:bg-gray-700 px-3 py-1 rounded-lg"
                  >
                    Tasks
                  </button>
                  <a
                    href="/memories"
                    className="text-sm text-gray-300 hover:text-white transition-colors hover:bg-gray-700 px-3 py-1 rounded-lg"
                  >
                    Memories
                  </a>
                </div>
                

              </div>
              
              <div className="flex items-center gap-4">
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/admin/reindex`, { 
                        method: "POST",
                        headers: {
                          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
                        }
                      });
                      const d = await r.json();
                      if (!r.ok || !d?.ok) throw new Error(d?.error || "Reindex failed");
                      alert("Reindex started / completed.");
                    } catch (e: unknown) {
                      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
                      alert(`Reindex error: ${errorMessage}`);
                    }
                  }}
                  className="text-xs text-gray-400 hover:text-white transition-colors hover:bg-gray-700 px-3 py-1 rounded-lg border border-gray-600"
                >
                  Reindex
                </button>
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/health`, { cache: "no-store" });
                      const d = await r.json();
                      setHealthy(d.status === "ok");
                      if (d.status !== "ok") alert(`Backend issue: ${d.error || "unknown"}`);
                      else alert("Backend is healthy!");
                    } catch (e: unknown) {
                      setHealthy(false);
                      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
                      alert(`Backend issue: ${errorMessage}`);
                    }
                  }}
                  className="relative text-xs text-gray-400 hover:text-white transition-colors hover:bg-gray-700 px-3 py-1 rounded-lg border border-gray-600"
                  aria-label="backend status"
                  title="Backend status"
                >
                  Health
                  <span className={(healthy === null ? "bg-gray-500" : healthy ? "bg-green-500" : "bg-red-500") + " absolute -top-1 -right-1 w-2 h-2 rounded-full"} />
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div ref={listRef} className="scrollbar-thin max-w-5xl mx-auto px-3 lg:px-6 py-5 space-y-3.5 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 140px)", scrollbarGutter: "stable both-edges" }}>
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} sources={m.sources} attachments={m.attachments} />
            ))}
            {/* Removed in-message typing loader for minimal design */}
          </div>
        </main>

        {/* Floating input bar */}
        <div className="fixed bottom-4 inset-x-0 px-3 pointer-events-none">
          <form onSubmit={sendMessage} className="max-w-5xl mx-auto pointer-events-auto">
            <div className="relative rounded-2xl border border-gray-600 bg-black/80 backdrop-blur-xl shadow-2xl flex items-center gap-2 px-3 py-2">
              {loading && <div className="loading-underline" />}
              <button
                type="button"
                aria-label="Upload files"
                title="Upload files"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border border-gray-600"
              >
                <Plus size={18} />
              </button>
              <div className="flex-1 min-w-0 relative">
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="inline-flex items-center gap-2 text-sm bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 backdrop-blur-sm">
                      <FileIcon file={f} />
                      <span className="text-gray-200 font-medium">{f.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                        className="opacity-60 hover:opacity-100 ml-2 text-gray-400 hover:text-white transition-opacity"
                      >
                        ×
                      </button>
                    </div>
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
                placeholder={loading ? "Waiting for reply..." : creatingSession ? "Creating new chat..." : "Hey soumya"}
                ref={inputRef}
                rows={1}
                className="w-full bg-transparent text-white px-3 py-2 pr-12 outline-none placeholder:text-gray-500 resize-none overflow-y-auto"
              />
              {transcribing && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
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
                if (files.length) {
                  // Don't auto-upload, just add to pending files
                  setPendingFiles((prev) => [...prev, ...files]);
                }
                // reset so selecting same file again re-triggers change
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="hidden"
            />
              <button
                type="button"
                aria-label={recording ? "Stop recording" : "Start recording"}
                title={recording ? "Stop recording" : "Start recording (F5 / F2 / Cmd+M)"}
                onClick={() => { 
                  if (recording) {
                    stopRecording(); 
                  } else {
                    startRecording();
                  }
                }}
                className={"inline-flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 " + (recording ? "bg-gray-700 text-white border border-gray-600 animate-pulse" : "text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-600")}
              >
                <Mic size={18} />
              </button>
              <button
                type="submit"
                disabled={loading}
                aria-label="Send"
                title="Send"
                className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-700 text-white disabled:opacity-50 hover:bg-gray-600 border border-gray-600 shadow-lg"
              >
                <SendHorizonal size={18} />
              </button>
            </div>
          </form>
        </div>
        <Sound play={messages[messages.length - 1]?.role === "assistant"} />
      </div>
      
             {/* Existing Components */}
       <HUD />
       <TasksPanel isOpen={showTasks} onClose={() => setShowTasks(false)} />
       <ChatSidebar 
         isOpen={chatSidebarOpen}
         onClose={() => setChatSidebarOpen(false)}
         onSessionSelect={handleSessionSelect}
         currentSessionId={activeSession}
       />
    </div>
  );
}
