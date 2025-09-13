"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import Message from "@/components/Message";
import Sound from "@/components/Sound";
import { getBackendUrl } from "@/utils/config";
import { apiSessionsList } from "@/lib/api";
import { useTaskManagement } from "@/hooks/useTaskManagement";
import { useChat } from "@/hooks/useChat";

import HUD from "@/components/HUD";
import TasksPanel from "@/components/TasksPanel";
import ChatSidebar from "@/components/ChatSidebar";

import { ArrowRight, Paperclip, Mic, MessageSquarePlus } from "lucide-react";
import FileIcon from "@/components/FileIcon";
import { ChatMessage, ChatSession, RawSession } from "@/types/chat";



export default function Home() {
  const STORAGE_KEY = "eclipse_chat_messages";

  // Use the chat hook for all chat-related state and logic
  const {
    messages,
    setMessages,
    input,
    setInput,
    loading,
    pendingFiles,
    setPendingFiles,
    sendMessage: sendChatMessage
  } = useChat();

  // Simplified input handlers
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, [setInput]);

  const sendMessageRef = useRef<((message: string) => Promise<void>) | null>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation(); // Prevent form submission
      console.log("DEBUG: Enter key pressed, calling sendMessage");
      sendMessageRef.current?.(input);
    }
  }, [input]);
  
  // Generate session ID in backend-compatible format
  const [sessionId] = useState<string>(() => {
    try {
      // Check if we have an existing session ID
      const existing = (typeof window !== 'undefined' && localStorage.getItem('eclipse_session_id')) || '';
      if (existing) return existing;
      
      // Generate backend-compatible session ID
      const deterministicId = `session_${Math.floor(Date.now() / 1000)}`;
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('eclipse_session_id', deterministicId);
      }
      return deterministicId;
    } catch {
      // Fallback to time-based ID
      return `session_${Math.floor(Date.now() / 1000)}`;
    }
  });
  
  // Refs
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const scrollAnimRef = useRef<number | null>(null);
  const transcribeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // State
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const [activeSession, setActiveSession] = useState<string>(sessionId);
  const [showTasks, setShowTasks] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [prefetchedSessions, setPrefetchedSessions] = useState<ChatSession[]>([]);
  const [isClient, setIsClient] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);


  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [refreshSidebar, setRefreshSidebar] = useState(0);

  // Task management integration
  const {
    taskCandByIndex,
    handleTaskAdd,
    handleTaskDismiss,
    extractTaskCandidates
  } = useTaskManagement();


  // (Removed unused local updateSessionTitle helper — apiSessionUpdateTitle covers this.)

  // Initialize component on mount
  useEffect(() => {
    setIsClient(true);
    inputRef.current?.focus();
  }, []);

  const createNewChatSession = useCallback(async () => {
    try {
      setCreatingSession(true);

      // Clear all current context to prevent bleeding
      setMessages([]);
      setPendingFiles([]);

      // Generate session ID in backend-compatible format
      const newSessionId = `session_${Math.floor(Date.now() / 1000)}`;

      // Generate a default title that will be updated after first message
      const defaultTitle = `New Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      const response = await fetch(`${getBackendUrl()}/api/sessions`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        },
        body: JSON.stringify({
          user_id: "soumya",
          title: defaultTitle,
          session_id: newSessionId
        })
      });

      if (response.ok) {
        await response.json();
        setActiveSession(newSessionId);

        // Store new session ID in localStorage for persistence (only on client)
        if (isClient) {
          localStorage.setItem('eclipse_session_id', newSessionId);
        }

        inputRef.current?.focus();
      }
    } catch (error) {
      console.error("Error creating new session:", error);
    } finally {
      setCreatingSession(false);
    }
  }, [isClient, setMessages, setPendingFiles]);

  const handleSessionSelect = async (sessionId: string) => {
    // Clear current session context to prevent bleeding
    setMessages([]);
    setPendingFiles([]);
    
    setActiveSession(sessionId);
    
    // Load session history from Redis
    try {
      const response = await fetch(`${getBackendUrl()}/api/sessions/${sessionId}/history?user_id=soumya`, {
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
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
     const el = listRef.current;
     if (!el) return;
     // Only auto-scroll if user is already near the bottom
     const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
     if (nearBottom) {
       el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
     }
   }, [messages]);

  // Load data and initialize on mount
  useEffect(() => {
    if (!isClient) return;

    // Load persisted messages
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {}

    // Load sessions
    (async () => {
      try {
        const data = await apiSessionsList("soumya");
        const rawSessions: RawSession[] = data.sessions || [];
        const sessions: ChatSession[] = rawSessions.map((s) => ({
          id: String(s.id),
          title: (s.title ?? 'New Chat') as string,
          last_message: (s.last_message ?? '') as string,
          created_at: (s.created_at ?? new Date().toISOString()) as string,
          message_count: typeof s.message_count === 'number' ? s.message_count : Number(s.message_count ?? 0),
          is_active: Boolean(s.is_active),
        }));
        setPrefetchedSessions(sessions);

          localStorage.setItem("eclipse_chat_sessions_cache", JSON.stringify({
          sessions, timestamp: Date.now()
          }));
      } catch {}
    })();

    // Focus input
    inputRef.current?.focus();
  }, [isClient, setMessages]);

  // Persist messages on change
  useEffect(() => {
    if (!isClient) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages, isClient]);
  
  // Check health on mount
  useEffect(() => {
    // Initial health check
    checkHealth();
    
    // Set up periodic health checks every 30 seconds
    const healthInterval = setInterval(checkHealth, 30000);
    
    return () => clearInterval(healthInterval);
  }, []);
  
  // Health check function
  const checkHealth = async () => {
    try {
      const response = await fetch(`${getBackendUrl()}/health`, { cache: "no-store" });
      const data = await response.json();
      setHealthy(data.status === "ok");
    } catch (error) {
      setHealthy(false);
      console.error("Health check failed:", error);
    }
  };

  const startRecording = useCallback(async () => {
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
        // Transcribing dots animation removed to reduce clutter
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
        }
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setRecording(false);
    }
  }, [setInput, setTranscribing, setRecording]);

  const stopRecording = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop();
    } catch {}
    setRecording(false);
  }, [setRecording]);

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
  }, [recording, showTasks, createNewChatSession, startRecording, stopRecording]);

  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    // Prevent multiple simultaneous calls
    if (isSendingMessage) {
      console.warn("DEBUG: sendMessage already in progress, ignoring duplicate call");
      return;
    }

    console.log("DEBUG: page.tsx sendMessage called with:", userMessage.substring(0, 50) + "...");
    setIsSendingMessage(true);

    try {
      // Call the hook's sendMessage function (handles task extraction and session title updates)
      await sendChatMessage(
        userMessage,
        activeSession,
        extractTaskCandidates,
        smoothScrollToBottom,
        listRef as React.RefObject<HTMLDivElement>
      );

      // Trigger sidebar refresh after message is sent (for session title updates)
      if (messages.length === 0) {
          console.log("DEBUG: Triggering sidebar refresh for first message");
          setRefreshSidebar(prev => prev + 1);
      }
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Update the ref after sendMessage is defined
  sendMessageRef.current = sendMessage;


  // Smooth scroll helper for message list
  function smoothScrollToBottom(duration = 500) {
    const el = listRef.current as HTMLDivElement | null;
    if (!el) return;
    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    const start = el.scrollTop;
    const end = el.scrollHeight - el.clientHeight;
    const change = end - start;
    const startTime = performance.now();
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now: number) => {
      const elapsed = Math.min((now - startTime) / duration, 1);
      el.scrollTop = start + change * ease(elapsed);
      if (elapsed < 1) {
        scrollAnimRef.current = requestAnimationFrame(step);
      } else {
        scrollAnimRef.current = null;
      }
    };
    scrollAnimRef.current = requestAnimationFrame(step);
  }





  // Paste functionality for text and code
  useEffect(() => {
    const el = document;
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
    el.addEventListener('paste', onPaste as unknown as EventListener);
    return () => {
      el.removeEventListener('paste', onPaste as unknown as EventListener);
    };
  }, [setInput, setPendingFiles]);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Main Content */}
      <div className="transition-all duration-300">
        {/* Header */}
                <header className="sticky top-0 z-30 bg-black/90 backdrop-blur-xl border-b border-white/10 shadow-lg">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 sm:gap-4">
                <button
                  onClick={() => setChatSidebarOpen(!chatSidebarOpen)}
                  className="text-white/60 hover:text-white transition-colors cursor-pointer"
                  aria-label="Toggle chat sidebar"
                >
                  <svg className="w-7 h-7 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5"/>
                    <line x1="8" y1="3" x2="8" y2="21" strokeWidth="1.5"/>
                    <line x1="10" y1="7" x2="6" y2="7" strokeWidth="1.5"/>
                    <line x1="10" y1="11" x2="6" y2="11" strokeWidth="1.5"/>
                  </svg>
                </button>
                <div className="hidden sm:flex items-center gap-2">
                  <h1 className="text-lg sm:text-xl font-bold text-white">Eclipse</h1>
                  <span className="text-xs text-white/40 bg-white/10 px-2 py-1 rounded-lg">Assistant</span>
                </div>
                <div className="sm:hidden">
                  <h1 className="text-lg font-bold text-white">Eclipse</h1>
                </div>
              </div>
              
              <div className="flex items-center gap-2 sm:gap-4">
                {/* Tasks button always visible, Memories/Reindex only on desktop */}
                <button
                  onClick={() => setShowTasks(!showTasks)}
                  className="text-xs text-white/60 hover:text-white transition-colors hover:bg-white/10 px-2 sm:px-3 py-0.5 rounded-lg border border-white/20 ml-6"
                >
                  <span>Tasks</span>
                </button>
                {/* Chart button on mobile */}
                <button
                  onClick={() => {/* Add chart functionality here */}}
                  className="sm:hidden flex items-center justify-center text-white/60 hover:text-white transition-colors hover:bg-white/10 px-2 py-0.5 h-6"
                >
                  <MessageSquarePlus size={24} />
                </button>
                {/* Desktop only: Memories and Reindex */}
                <div className="hidden sm:flex items-center gap-2">
                  <button
                    onClick={() => window.location.href = '/memories'}
                    className="text-xs text-white/60 hover:text-white transition-colors hover:bg-white/10 px-2 sm:px-3 py-1 rounded-lg border border-white/20"
                  >
                    <span>Memories</span>
                  </button>
                  <button
                      onClick={async () => {
                        try {
                          const r = await fetch(`${getBackendUrl()}/admin/reindex`, {
                            method: "POST",
                            headers: {
                              'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
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
                      className="text-xs text-white/60 hover:text-white transition-colors hover:bg-white/10 px-2 sm:px-3 py-1 rounded-lg border border-white/20"
                    >
                      <span>Reindex</span>
                    </button>
                </div>
                  <div className="hidden sm:flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                        healthy === null ? "bg-gray-500" : 
                        healthy ? "bg-green-500" : "bg-red-500"
                      }`} />
                    </div>
                  </div>
                <div className="sm:hidden">
                  <div className="flex items-center gap-2">
                    {/* <div className="text-xs text-white/40">
                      Backend
                    </div> */}
                    <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                      healthy === null ? "bg-gray-500" : 
                      healthy ? "bg-green-500" : "bg-red-500"
                    }`} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div ref={listRef} className="scrollbar-thin max-w-5xl mx-auto px-2 sm:px-3 lg:px-6 py-3 sm:py-5 space-y-3 sm:space-y-3.5 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 140px)", scrollbarGutter: "stable both-edges" }}>
            {(() => {
              console.log("DEBUG: Rendering messages in main page, total count:", messages.length);
              console.log("DEBUG: Messages to render:", messages.map((m, idx) => ({
                index: idx,
                role: m.role,
                contentLength: m.content?.length || 0,
                contentPreview: (m.content || "").substring(0, 50) + ((m.content || "").length > 50 ? "..." : ""),
                formatted: m.formatted
              })));

              return messages.map((m, i) => {
                // Use a stable key based on role, content hash, and index
                const contentHash = m.content.substring(0, 20).replace(/\s+/g, '-').toLowerCase();
                const stableKey = `${m.role}-${contentHash}-${i}`;

                console.log(`DEBUG: Rendering message ${i}: role=${m.role}, contentLength=${m.content.length}, key=${stableKey}`);

                return (
                  <Message
                    key={stableKey}
                    role={m.role}
                    content={m.content}
                    sources={m.sources}
                    attachments={m.attachments}
                    taskCandidates={m.role === 'user' ? (taskCandByIndex[i] || []) : []}
                    onTaskAdd={async (title: string) => {
                      const result = await handleTaskAdd(title)();
                      if (result && result.success) {
                        // Add task creation info to chat context for LLM awareness
                        const taskMessage = {
                          role: 'system' as const,
                          content: `Task "${title}" has been ${result.isAutoAdded ? 'automatically ' : ''}added to your task list.`,
                          sources: [],
                          formatted: true
                        };
                        setMessages(prev => [...prev, taskMessage]);
                      }
                    }}
                    onTaskDismiss={handleTaskDismiss(i)}
                  />
                );
              });
            })()}
            {/* Removed in-message typing loader for minimal design */}
          </div>
        </main>

        {/* Floating input bar */}
        <div className="fixed bottom-4 sm:bottom-6 inset-x-0 px-2 sm:px-3 pointer-events-none">
          <div className="max-w-5xl mx-auto pointer-events-auto">
            {/* File uploads display - above the input bar */}
            {pendingFiles.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2 justify-center">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="inline-flex items-center gap-2 text-xs sm:text-sm bg-white/10 border border-white/20 rounded-lg px-3 py-2 backdrop-blur-sm max-w-full">
                    <FileIcon file={f} />
                    <span className="text-white/90 font-medium max-w-[120px] sm:max-w-[150px] lg:max-w-none truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="opacity-60 hover:opacity-100 ml-2 text-gray-400 hover:text-white transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Main input bar - Responsive layout */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim() && !loading) {
                  sendMessageRef.current?.(input);
                }
              }}
              className="relative rounded-2xl border border-white/20 bg-black/80 backdrop-blur-xl shadow-2xl transition-all duration-200 overflow-hidden pt-2"
            >
              {loading && <div className="loading-underline" />}

              {/* Mobile: Two-row layout, Desktop: Single row */}
              <div className="md:hidden">
                {/* Mobile Upper Row - Text Input */}
                <div className="px-2 py-1">
                  <div className="relative">
                    <textarea
                      id="chat-input"
                      name="chat-input"
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder={loading ? "Waiting for reply..." : creatingSession ? "Creating new chat..." : "Hey soumya"}
                      ref={inputRef}
                      rows={1}
                      className="w-full bg-transparent text-white px-0 py-0.5 outline-none placeholder:text-white/40 resize-none overflow-y-auto text-sm sm:text-base"
                      style={{
                        border: 'none',
                        boxShadow: 'none',
                        minHeight: '0px'
                      }}
                    />
                  </div>
                </div>

                {/* Mobile Lower Row - Action Buttons */}
                <div className="flex items-center justify-between px-2 py-0.5">
                  {/* Left side - Attachment button */}
                  <button
                    type="button"
                    aria-label="Upload files"
                    title="Upload files"
                    disabled={loading}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center w-7 h-7 text-white/60 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 rounded-lg"
                  >
                    <Paperclip size={20} className="sm:w-[20px] sm:h-[20px]" />
                  </button>

                  {/* Right side - Mic and Send buttons */}
                  <div className="flex items-center gap-1">
                    {/* Microphone button */}
                    <button
                      type="button"
                      aria-label={recording ? "Stop recording" : transcribing ? "Transcribing..." : "Start recording"}
                      title={recording ? "Stop recording" : transcribing ? "Transcribing..." : "Start recording (F5 / F2 / Cmd+M)"}
                      onClick={() => {
                        if (recording) {
                          stopRecording();
                        } else if (!transcribing) {
                          startRecording();
                        }
                      }}
                      className={"inline-flex items-center justify-center w-7 h-7 rounded-xl border transition-all duration-200 flex-shrink-0 relative " + (recording ? "bg-red-500/20 text-red-400 border-red-500/30" : transcribing ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "text-white/60 hover:text-white hover:bg-white/10 border-white/20")}
                    >
                      <div className="relative">
                        {/* Show mic icon only when not recording or transcribing */}
                        {!recording && !transcribing && (
                          <Mic size={20} className="sm:w-[20px] sm:h-[20px]" />
                        )}
                        {recording && (
                          // Wave animation for recording
                          <div className="flex items-center justify-center">
                            <div className="flex space-x-0.5">
                              <div className="w-0.5 h-2 bg-red-400 animate-pulse" style={{ animationDelay: '0ms', animationDuration: '1s' }}></div>
                              <div className="w-0.5 h-3 bg-red-400 animate-pulse" style={{ animationDelay: '200ms', animationDuration: '1s' }}></div>
                              <div className="w-0.5 h-2 bg-red-400 animate-pulse" style={{ animationDelay: '400ms', animationDuration: '1s' }}></div>
                            </div>
                          </div>
                        )}
                        {transcribing && (
                          // Loading spinner for transcribing
                          <div className="flex items-center justify-center">
                            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Send button */}
                    <button
                      type="submit"
                      disabled={loading}
                      aria-label="Send"
                      title="Send"
                      className="inline-flex items-center justify-center w-20 h-6 rounded-xl bg-white text-black/80 disabled:opacity-50 hover:bg-gray-100 border border-white/20 shadow-md flex-shrink-0 transition-all duration-200 px-2"
                    >
                      <span className="text-sm font-medium">Send</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Desktop: Single row layout */}
              <div className="hidden md:flex items-center gap-3 px-4 py-4">
                {/* Upload button */}
                <button
                  type="button"
                  aria-label="Upload files"
                  title="Upload files"
                  disabled={loading}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center justify-center w-9 h-9 text-white/60 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 rounded-lg"
                >
                  <Paperclip size={18} className="sm:w-[18px] sm:h-[18px]" />
                </button>

                {/* Text input area */}
                <div className="flex-1 min-w-0 relative">
                  <textarea
                    id="chat-input"
                    name="chat-input"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={loading ? "Waiting for reply..." : creatingSession ? "Creating new chat..." : "Hey soumya"}
                    ref={inputRef}
                    rows={1}
                    className="w-full bg-transparent text-white px-2 py-1 outline-none placeholder:text-white/40 resize-none overflow-y-auto text-sm sm:text-base"
                    style={{
                      border: 'none',
                      boxShadow: 'none',
                      minHeight: '0px'
                    }}
                  />
                </div>

                {/* Microphone button */}
                <button
                  type="button"
                  aria-label={recording ? "Stop recording" : transcribing ? "Transcribing..." : "Start recording"}
                  title={recording ? "Stop recording" : transcribing ? "Transcribing..." : "Start recording (F5 / F2 / Cmd+M)"}
                  onClick={() => {
                    if (recording) {
                      stopRecording();
                    } else if (!transcribing) {
                      startRecording();
                    }
                  }}
                  className={"inline-flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-200 flex-shrink-0 relative " + (recording ? "bg-red-500/20 text-red-400 border-red-500/30" : transcribing ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "text-white/60 hover:text-white hover:bg-white/10 border-white/20")}
                >
                  <div className="relative">
                    {/* Show mic icon only when not recording or transcribing */}
                    {!recording && !transcribing && (
                      <Mic size={18} className="sm:w-[18px] sm:h-[18px]" />
                    )}
                    {recording && (
                      // Wave animation for recording
                      <div className="flex items-center justify-center">
                        <div className="flex space-x-0.5">
                          <div className="w-0.5 h-2 bg-red-400 animate-pulse" style={{ animationDelay: '0ms', animationDuration: '1s' }}></div>
                          <div className="w-0.5 h-3 bg-red-400 animate-pulse" style={{ animationDelay: '200ms', animationDuration: '1s' }}></div>
                          <div className="w-0.5 h-2 bg-red-400 animate-pulse" style={{ animationDelay: '400ms', animationDuration: '1s' }}></div>
                        </div>
                      </div>
                    )}
                    {transcribing && (
                      // Loading spinner for transcribing
                      <div className="flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>
                </button>

                {/* Send button */}
                <button
                  type="submit"
                  disabled={loading}
                  aria-label="Send"
                  title="Send"
                  className="inline-flex items-center justify-center w-10 h-8 rounded-full bg-white text-black/80 disabled:opacity-50 hover:bg-gray-100 border border-white/20 shadow-md flex-shrink-0 transition-all duration-200"
                >
                  <ArrowRight size={16} className="sm:w-[16px] sm:h-[16px]" />
                </button>
              </div>

              {/* Hidden file input */}
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
            </form>
          </div>
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
         refreshTrigger={refreshSidebar}
         initialSessions={prefetchedSessions}
       />

    </div>
  );
}
