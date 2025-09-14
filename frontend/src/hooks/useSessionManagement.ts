import { useState, useCallback } from "react";
import { apiSessionsList } from "@/lib/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  formatted?: boolean;
  attachments?: { name: string; type: string }[];
}

interface ChatSession {
  id: string;
  title: string;
  last_message: string;
  created_at: string;
  message_count: number;
  is_active: boolean;
}

interface RawSession {
  id: string | number;
  title?: string;
  last_message?: string;
  created_at?: string;
  message_count?: number | string;
  is_active?: boolean | number | string;
}

export function useSessionManagement() {
  const [activeSession, setActiveSession] = useState<string>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('eclipse_session_id');
        if (stored) return stored;
      }
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

  const [creatingSession, setCreatingSession] = useState(false);
  const [refreshSidebar, setRefreshSidebar] = useState(0);

  const createNewChatSession = useCallback(async () => {
    if (creatingSession) return;
    
    setCreatingSession(true);
    try {
      const newSessionId = `session_${Math.floor(Date.now() / 1000)}`;
      setActiveSession(newSessionId);
      
      // Store new session ID in localStorage for persistence (only on client)
      if (typeof window !== 'undefined') {
        localStorage.setItem('eclipse_session_id', newSessionId);
      }
    } catch (error) {
      console.error("Error creating new session:", error);
    } finally {
      setCreatingSession(false);
    }
  }, [creatingSession]);

  const handleSessionSelect = useCallback(async (sessionId: string, setMessages: (messages: ChatMessage[]) => void, prefetchedMessages?: ChatMessage[]) => {
    // Clear current session context to prevent bleeding
    setMessages([]);
    setActiveSession(sessionId);

    // Use prefetched messages if available (instant loading)
    if (prefetchedMessages && prefetchedMessages.length > 0) {
      setMessages(prefetchedMessages);
      return;
    }

    // Load session history from Redis via frontend proxy (fallback)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/history?user_id=soumya`);

      if (response.ok) {
        const data = await response.json();
        const historyMessages: ChatMessage[] = (data.messages || []).map((msg: { role: string; content: string; sources?: { path: string; score: number }[] }) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
          sources: msg.sources || [],
          formatted: true
        }));
        setMessages(historyMessages);
      }
    } catch (error) {
      console.error("Error loading session history:", error);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const data = await apiSessionsList("soumya");
      const rawSessions: RawSession[] = data.sessions || [];
      
      // Normalize sessions to ensure consistent types
      const sessions: ChatSession[] = rawSessions.map(s => ({
        id: String(s.id),
        title: s.title || "Untitled Chat",
        last_message: s.last_message || "",
        created_at: s.created_at || new Date().toISOString(),
        message_count: typeof s.message_count === 'string' ? parseInt(s.message_count) || 0 : s.message_count || 0,
        is_active: Boolean(s.is_active)
      }));

      // Cache sessions in localStorage for offline access
      try {
        localStorage.setItem('eclipse_sessions_cache', JSON.stringify({
          sessions,
          timestamp: Date.now()
        }));
      } catch (cacheError) {
        console.error("Error caching sessions:", cacheError);
      }
      
      return sessions;
    } catch (error) {
      console.error("Error loading sessions:", error);
      return [];
    }
  }, []);

  return {
    activeSession,
    setActiveSession,
    creatingSession,
    setCreatingSession,
    refreshSidebar,
    setRefreshSidebar,
    createNewChatSession,
    handleSessionSelect,
    loadSessions
  };
}
