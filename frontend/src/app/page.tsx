"use client";
import { useState, useRef, useEffect } from "react";
import Message from "@/components/Message";
import Sound from "@/components/Sound";
import { getBackendUrl } from "@/utils/config";
import { apiChatStream } from "@/lib/api";

import HUD from "@/components/HUD";
import TasksPanel from "@/components/TasksPanel";
import ChatSidebar from "@/components/ChatSidebar";
import { apiSessionUpdateTitle, apiSessionsList } from "@/lib/api";

import { Plus, Mic, SendHorizonal } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  formatted?: boolean;
  attachments?: { name: string; type: string }[];
}



// File icon component for different file types
function FileIcon({ file }: { file: File }) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const type = file.type;
  
  if (type.includes('pdf') || ext === 'pdf') {
    return <div className="w-4 h-4 sm:w-5 sm:h-5 bg-red-500 rounded flex items-center justify-center text-white text-xs font-bold">PDF</div>;
  }
  if (type.includes('markdown') || ext === 'md' || ext === 'markdown') {
    return <div className="w-4 h-4 sm:w-5 sm:h-5 bg-blue-500 rounded flex items-center justify-center text-white text-xs font-bold">MD</div>;
  }
  if (type.includes('text') || ext === 'txt') {
    return <div className="w-4 h-4 sm:w-5 sm:h-5 bg-green-500 rounded flex items-center justify-center text-white text-xs font-bold">TXT</div>;
  }
  return <div className="w-4 h-4 sm:w-5 sm:h-5 bg-gray-500 rounded flex items-center justify-center text-white text-xs font-bold">FILE</div>;
}

export default function Home() {
  const STORAGE_KEY = "eclipse_chat_messages";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const streamingRef = useRef(false);
  const typewriterRef = useRef<{ timer: ReturnType<typeof setInterval> | null; buffer: string }>({ timer: null, buffer: "" });

  const stopTypewriter = () => {
    try { if (typewriterRef.current.timer) { clearInterval(typewriterRef.current.timer); } } catch {}
    typewriterRef.current.timer = null;
  };

  const ensureTypewriter = () => {
    if (typewriterRef.current.timer) return;
    // Markdown-aware typewriter effect for better formatting
    typewriterRef.current.timer = setInterval(() => {
      if (typewriterRef.current.buffer.length > 0) {
        // Find the next markdown-friendly boundary
        let chunk = "";
        let nextNewline = typewriterRef.current.buffer.indexOf('\n');
        let nextSpace = typewriterRef.current.buffer.indexOf(' ');
        
        // Prioritize newlines to preserve markdown structure
        if (nextNewline !== -1) {
          chunk = typewriterRef.current.buffer.slice(0, nextNewline + 1);
          typewriterRef.current.buffer = typewriterRef.current.buffer.slice(nextNewline + 1);
        } else if (nextSpace !== -1) {
          chunk = typewriterRef.current.buffer.slice(0, nextSpace + 1);
          typewriterRef.current.buffer = typewriterRef.current.buffer.slice(nextSpace + 1);
        } else {
          // No more boundaries, take the rest
          chunk = typewriterRef.current.buffer;
          typewriterRef.current.buffer = "";
        }
        
        setMessages(prev => prev.map((msg, idx) => 
          idx === prev.length - 1 ? { ...msg, content: (msg.content || "") + chunk } : msg
        ));
      } else if (!streamingRef.current) {
        // Stream finished and buffer drained - now mark as formatted
        setMessages(prev => prev.map((msg, idx) => 
          idx === prev.length - 1 ? { ...msg, formatted: true } : msg
        ));
        stopTypewriter();
      }
    }, 15); // Much faster typewriter effect
  };
  
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
  
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
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
  const [prefetchedSessions, setPrefetchedSessions] = useState<any[]>([]);
  const [isClient, setIsClient] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);


  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [refreshSidebar, setRefreshSidebar] = useState(0);


  // Function to update session title based on first message
  const updateSessionTitle = async (sessionId: string, firstMessage: string) => {
    try {
      // Generate a smart title from the first message
      let title = firstMessage.trim();
      
      // Clean up the message for better titles
      title = title.replace(/^[?!.,;:]+/, '').trim(); // Remove leading punctuation
      title = title.replace(/\s+/g, ' '); // Normalize whitespace
      
      // Truncate if too long
      if (title.length > 50) {
        title = title.substring(0, 47) + "...";
      }
      
      // If it's very short or empty, use a fallback
      if (title.length < 3) {
        title = `Chat about ${firstMessage.length > 0 ? firstMessage : 'something'}`;
      }
      
      // Capitalize first letter
      title = title.charAt(0).toUpperCase() + title.slice(1);
      
      const response = await fetch(`${getBackendUrl()}/api/sessions/${sessionId}/title`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        },
        body: JSON.stringify({
          user_id: "soumya",
          title: title
        })
      });
      
      if (response.ok) {
        console.log("Session title updated to:", title);
        
        // Update localStorage cache immediately (only on client)
        if (isClient) {
          try {
            const cached = localStorage.getItem("eclipse_chat_sessions_cache");
            if (cached) {
              const { sessions: cachedSessions, timestamp } = JSON.parse(cached);
              const updatedSessions = cachedSessions.map((session: any) => 
                session.id === sessionId ? { ...session, title } : session
              );
              localStorage.setItem("eclipse_chat_sessions_cache", JSON.stringify({
                sessions: updatedSessions,
                timestamp: Date.now()
              }));
            }
          } catch (cacheError) {
            console.error("Error updating session cache:", cacheError);
          }
        }
        
        // Trigger a refresh of the sidebar
        setRefreshSidebar(prev => prev + 1);
      }
    } catch (error) {
      console.error("Error updating session title:", error);
    }
  };

  // Auto-refresh sessions every 30 seconds for multi-device sync
  useEffect(() => {
    const interval = setInterval(() => {
      if (chatSidebarOpen) {
        // Refresh sessions list to get updates from other devices
        // This will be handled in ChatSidebar component
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [chatSidebarOpen]);

  const createNewChatSession = async () => {
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
  };

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
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Set client flag on mount to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Load persisted conversation on mount & prefetch sessions (only on client)
  useEffect(() => {
    if (!isClient) return;
    
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {}
    
    (async () => {
      try {
        const data = await apiSessionsList("soumya");
        const sessions = data.sessions || [];
        setPrefetchedSessions(sessions);
        
        // Cache the sessions immediately
        try {
          localStorage.setItem("eclipse_chat_sessions_cache", JSON.stringify({
            sessions,
            timestamp: Date.now()
          }));
        } catch (cacheError) {
          console.error("Error caching sessions:", cacheError);
        }
      } catch {}
    })();
  }, [isClient]);

  // Persist on every change (only on client)
  useEffect(() => {
    if (!isClient) return;
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages, isClient]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);
  
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

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;
    
    // Add user message to chat
    const userMessageObj: ChatMessage = {
      role: "user",
      content: userMessage,
      sources: [],
      formatted: true
    };
    
    setMessages(prev => [...prev, userMessageObj]);
    setInput("");
    
    // Update session title if this is the first message
    if (messages.length === 0) {
      console.log("Updating session title for session:", activeSession, "with message:", userMessage);
      try { 
        await apiSessionUpdateTitle(activeSession, userMessage, "soumya");
        console.log("Session title updated successfully");
        // Trigger sidebar refresh to show updated title
        setRefreshSidebar(prev => prev + 1);
      } catch (error) {
        console.error("Error updating session title:", error);
      }
    }
    
    // Upload files first if any
    if (pendingFiles.length > 0) {
      try {
        const formData = new FormData();
        pendingFiles.forEach(file => formData.append('files', file));
        formData.append('session_id', activeSession);
        
        const uploadResponse = await fetch(`${getBackendUrl()}/api/upload`, {
          method: 'POST',
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
          },
          body: formData
        });
        
        if (uploadResponse.ok) {
          // Show files as a separate message
          const filesMessage: ChatMessage = {
            role: "user",
            content: `📎 Attached ${pendingFiles.length} file(s): ${pendingFiles.map(f => f.name).join(', ')}`,
            sources: [],
            formatted: true
          };
          setMessages(prev => [...prev, filesMessage]);
        }
        
        setPendingFiles([]);
      } catch (error) {
        console.error("Error uploading files:", error);
      }
    }
    
    // Start loading state
    setLoading(true);
    streamingRef.current = true;
    stopTypewriter();
    typewriterRef.current.buffer = "";
    
    try {
      const response = await apiChatStream({ user_id: "soumya", message: userMessage, session_id: activeSession });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }
      
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: "",
        sources: [],
        formatted: false
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = ""; // used for fallback error and debugging
      let inFinal = false;
      let finalBuffer = ""; // accumulate full final for safety
      // SSE event assembly: accumulate data lines per event until blank separator
      let currentEvent: string | null = null;
      let eventDataLines: string[] = [];
      let streamFinished = false;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            // Blank line indicates end of the current SSE event
            if (line.trim() === '') {
              if (currentEvent && eventDataLines.length > 0) {
                const payload = eventDataLines.join('\n');
                if (currentEvent === 'final') {
                  inFinal = true;
                  finalBuffer = payload;
                  accumulatedContent = payload;
                  setMessages(prev => prev.map((msg, idx) => 
                    idx === prev.length - 1 ? { ...msg, content: payload, formatted: true } : msg
                  ));
                }
                // Ignore start/ping/delta for now
              }
              // Reset accumulator for next event
              currentEvent = null;
              eventDataLines = [];
              continue;
            }

            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              eventDataLines = [];
              continue;
            }
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                // Stream complete
                setMessages(prev => prev.map((msg, idx) => 
                  idx === prev.length - 1 ? { ...msg, formatted: true } : msg
                ));
                streamFinished = true;
                break;
              }
              // Collect data lines for the current event
              eventDataLines.push(data);
              continue;
            }
          }

          if (streamFinished) break;
        }
        
        reader.releaseLock();
      } catch (error) {
        console.error("Error in streaming:", error);
        
        // Check if we have any accumulated content to show
        if (accumulatedContent.trim()) {
          // Show what we got before the error
          setMessages(prev => prev.map((msg, idx) => 
            idx === prev.length - 1 ? { ...msg, content: accumulatedContent + "\n\n[Response was cut off due to an error]", formatted: true } : msg
          ));
        } else {
          // Show error message
          const errorMessage: ChatMessage = {
            role: "assistant",
            content: "Sorry, I encountered an error. Please try again.",
            sources: [],
            formatted: true
          };
          setMessages(prev => [...prev, errorMessage]);
        }
      } finally {
        setLoading(false);
        streamingRef.current = false;
        // If buffer is empty, stop now; otherwise let typewriter finish draining
        if (!typewriterRef.current.buffer.length) {
          stopTypewriter();
        }
      }
    } catch (error) {
      console.error("Error in chat stream:", error);
      setLoading(false);
      streamingRef.current = false;
      
      // Show error message
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        sources: [],
        formatted: true
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

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
  }, []);

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
                {/* Move Memories/Reindex to sidebar on mobile; keep in header on desktop */}
                <div className="hidden sm:flex items-center gap-2">
                  <button
                    onClick={() => setShowTasks(!showTasks)}
                    className="text-xs text-white/60 hover:text-white transition-colors hover:bg-white/10 px-2 sm:px-3 py-1 rounded-lg border border-white/20"
                  >
                    <span>Tasks</span>
                  </button>
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
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} sources={m.sources} attachments={m.attachments} />
            ))}
            {/* Removed in-message typing loader for minimal design */}
          </div>
        </main>

        {/* Floating input bar */}
        <div className="fixed bottom-2 sm:bottom-4 inset-x-0 px-2 sm:px-3 pointer-events-none">
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="max-w-5xl mx-auto pointer-events-auto">
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
            
            {/* Main input bar */}
            <div className="relative rounded-2xl border border-white/20 bg-black/80 backdrop-blur-xl shadow-2xl flex items-center gap-3 px-3 py-2 sm:py-3">
              {loading && <div className="loading-underline" />}
              
              {/* Upload button - larger on mobile */}
              <button
                type="button"
                aria-label="Upload files"
                title="Upload files"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center w-8 h-8 sm:w-8 sm:h-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors border border-white/20 flex-shrink-0"
              >
                <Plus size={18} className="sm:w-[18px] sm:h-[18px]" />
              </button>
              
              {/* Text input area */}
              <div className="flex-1 min-w-0 relative">
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
                      sendMessage(input);
                    }
                  }}
                  placeholder={loading ? "Waiting for reply..." : creatingSession ? "Creating new chat..." : "Hey soumya"}
                  ref={inputRef}
                  rows={1}
                  className="w-full bg-transparent text-white px-2 py-1 sm:py-2 pr-2 outline-none placeholder:text-white/40 resize-none overflow-y-auto text-sm sm:text-base"
                />
                {transcribing && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/60">
                    Transcribing{transcribingDots}
                  </span>
                )}
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
              
              {/* Action buttons - larger on mobile */}
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
                className={"inline-flex items-center justify-center w-8 h-8 sm:w-8 sm:h-8 rounded-full transition-all duration-200 flex-shrink-0 " + (recording ? "bg-white/20 text-white border border-white/30 animate-pulse" : "text-white/60 hover:text-white hover:bg-white/10 border border-white/20")}
              >
                <Mic size={18} className="sm:w-[18px] sm:h-[18px]" />
              </button>
              
              <button
                type="submit"
                disabled={loading}
                aria-label="Send"
                title="Send"
                className="inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/20 text-white disabled:opacity-50 hover:bg-white/30 border border-white/30 shadow-lg flex-shrink-0"
              >
                <SendHorizonal size={18} className="sm:w-[18px] sm:h-[18px]" />
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
         refreshTrigger={refreshSidebar}
         initialSessions={prefetchedSessions}
       />

    </div>
  );
}
