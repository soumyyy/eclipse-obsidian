import { useState, useRef, useCallback } from "react";
import { apiChatStream, apiSessionUpdateTitle, apiTasksExtract } from "@/lib/api";
import { getBackendUrl } from "@/utils/config";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  formatted?: boolean;
  attachments?: { name: string; type: string }[];
}

interface TaskCandidate {
  title: string;
  due_ts?: number;
  confidence?: number;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [slidingMessage, setSlidingMessage] = useState<ChatMessage | null>(null);
  const [isSliding, setIsSliding] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showThinking, setShowThinking] = useState(false);
  
  const streamingRef = useRef(false);
  const typewriterRef = useRef<{ timer: ReturnType<typeof setInterval> | null; buffer: string }>({ timer: null, buffer: "" });
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingDotsRef = useRef<string>("");
  const receivedFirstDeltaRef = useRef<boolean>(false);

  const stopTypewriter = useCallback(() => {
    try { if (typewriterRef.current.timer) { clearInterval(typewriterRef.current.timer); } } catch {}
    typewriterRef.current.timer = null;
  }, []);

  const ensureTypewriter = useCallback(() => {
    if (typewriterRef.current.timer) return;
    // Markdown-aware typewriter effect for better formatting
    typewriterRef.current.timer = setInterval(() => {
      if (typewriterRef.current.buffer.length > 0) {
        // Find the next markdown-friendly boundary
        let chunk = "";
        const nextNewline = typewriterRef.current.buffer.indexOf('\n');
        const nextSpace = typewriterRef.current.buffer.indexOf(' ');
        
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
  }, [stopTypewriter]);

  const sendMessage = useCallback(async (userMessage: string, activeSession: string, extractTaskCandidates: (message: string, index: number) => void) => {
    if (!userMessage.trim()) return;
    // reset streaming state
    streamingRef.current = true;
    receivedFirstDeltaRef.current = false;
    setLoading(true);
    setShowThinking(true);
    
    // Clear any existing thinking animation
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current);
    }
    
    // Start thinking animation
    thinkingDotsRef.current = "";
    thinkingIntervalRef.current = setInterval(() => {
      thinkingDotsRef.current = thinkingDotsRef.current.length >= 3 ? "" : thinkingDotsRef.current + ".";
      setShowThinking(true);
    }, 500);

    const userMessageObj: ChatMessage = {
      role: "user",
      content: userMessage,
      sources: [],
      formatted: true
    };

    // Clear input immediately and start sliding animation
    setInput("");
    setSlidingMessage(userMessageObj);

    // Start sliding animation immediately
    setIsSliding(true);

    // After animation completes, add to messages and reset
    setTimeout(() => {
      setMessages((prev: ChatMessage[]) => [...prev, userMessageObj]);
      setSlidingMessage(null);
      setIsSliding(false);
      
      // Scroll to bottom after DOM updates
      requestAnimationFrame(() => {
        // This would need to be handled by the parent component
      });
    }, 500); // Match animation duration

    // Extract task candidates in parallel and attach to this user message
    (async () => {
      try {
        const data = await apiTasksExtract(userMessage);
        const cands = (data.candidates || []).map((c: { title: string; due_ts?: number; confidence?: number }) => ({
          title: c.title,
          due_ts: c.due_ts,
          confidence: c.confidence
        }));
        if (cands.length) {
          extractTaskCandidates(userMessage, messages.length);
        }
      } catch {}
    })();
    
    // Update session title if this is the first message
    if (messages.length === 0) {
      console.log("Updating session title for session:", activeSession, "with message:", userMessage);
      try {
        await apiSessionUpdateTitle(activeSession, userMessage.slice(0, 50));
        console.log("Session title updated successfully");
      } catch (error) {
        console.error("Failed to update session title:", error);
      }
    }

    // If user was near bottom, follow the placeholder
    const wasNearBottom = true; // This would need to be calculated by parent
    if (wasNearBottom) {
      // Use a small delay to ensure the thinking indicator is rendered
      setTimeout(() => {
        // This would need to be handled by the parent component
      }, 50);
    }
    // Show floating thinking indicator until first delta or final arrives
    setShowThinking(true);

    try {
      const formData = new FormData();
      formData.append('message', userMessage);
      formData.append('session_id', activeSession);
      formData.append('user_id', 'soumya');
      
      if (pendingFiles.length > 0) {
        pendingFiles.forEach(file => formData.append('files', file));
        setPendingFiles([]); // Clear after adding to form
      }

      const response = await fetch(`${getBackendUrl()}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';

      // Add assistant message placeholder
      setMessages(prev => [...prev, { role: 'assistant', content: '', sources: [], formatted: false }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              streamingRef.current = false;
              setLoading(false);
              setShowThinking(false);
              if (thinkingIntervalRef.current) {
                clearInterval(thinkingIntervalRef.current);
                thinkingIntervalRef.current = null;
              }
              // Mark final message as formatted
              setMessages(prev => prev.map((msg, idx) => 
                idx === prev.length - 1 ? { ...msg, formatted: true } : msg
              ));
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'delta' && parsed.content) {
                receivedFirstDeltaRef.current = true;
                setShowThinking(false);
                if (thinkingIntervalRef.current) {
                  clearInterval(thinkingIntervalRef.current);
                  thinkingIntervalRef.current = null;
                }
                
                accumulatedContent += parsed.content;
                typewriterRef.current.buffer += parsed.content;
                ensureTypewriter();
              } else if (parsed.type === 'final') {
                streamingRef.current = false;
                setLoading(false);
                setShowThinking(false);
                if (thinkingIntervalRef.current) {
                  clearInterval(thinkingIntervalRef.current);
                  thinkingIntervalRef.current = null;
                }
                
                const finalContent = parsed.content || accumulatedContent;
                setMessages(prev => prev.map((msg, idx) => 
                  idx === prev.length - 1 ? { 
                    ...msg, 
                    content: finalContent, 
                    sources: parsed.sources || [], 
                    formatted: true 
                  } : msg
                ));
                return;
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', data);
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      streamingRef.current = false;
      setLoading(false);
      setShowThinking(false);
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
      
      const errText = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      setMessages(prev => prev.map((msg, idx) => 
        idx === prev.length - 1 ? { ...msg, content: errText, formatted: true } : msg
      ));
    }
  }, [messages.length, pendingFiles, ensureTypewriter, stopTypewriter]);

  return {
    messages,
    setMessages,
    input,
    setInput,
    loading,
    setLoading,
    slidingMessage,
    setSlidingMessage,
    isSliding,
    setIsSliding,
    pendingFiles,
    setPendingFiles,
    showThinking,
    setShowThinking,
    sendMessage
  };
}
