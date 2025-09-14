"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MessageSquare,
  SquarePlus,
  Trash2,
  X,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiSessionsList, apiSessionCreate, apiSessionDelete } from "@/lib/api";
import { ChatMessage } from "@/types/chat";

interface ChatSession {
  id: string;
  title: string;
  last_message: string;
  created_at: string;
  message_count: number;
  is_active: boolean;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect: (sessionId: string, prefetchedMessages?: ChatMessage[]) => void;
  currentSessionId?: string;
  refreshTrigger?: number;
  initialSessions?: ChatSession[];
}

const SESSIONS_CACHE_KEY = "eclipse_chat_sessions_cache";
const SESSIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default function ChatSidebar({ 
  isOpen, 
  onClose, 
  onSessionSelect, 
  currentSessionId,
  refreshTrigger,
  initialSessions
}: ChatSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  // Removed unused debugMode state
  const [isClient, setIsClient] = useState(false);
  const isMobile = isClient ? window.innerWidth < 640 : false;

  // Prefetched chat histories for instant loading
  const [prefetchedHistories, setPrefetchedHistories] = useState<Map<string, ChatMessage[]>>(new Map());
  const [prefetchingSessions, setPrefetchingSessions] = useState<Set<string>>(new Set());

  // Define fetchSessions before effects to avoid TDZ errors in dependencies
  const fetchSessions = useCallback(async (backgroundSync = false) => {
    try {
      const data = await apiSessionsList("soumya");
      const freshSessions = data.sessions || [];
      // Update state
      setSessions(freshSessions);
      // Cache the fresh data (only on client)
      if (isClient) {
        try {
          localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify({
            sessions: freshSessions,
            timestamp: Date.now()
          }));
        } catch (cacheError) {
          console.error("Error caching sessions:", cacheError);
        }
      }
      if (!backgroundSync) {
        console.log(`Loaded ${freshSessions.length} sessions from Redis`);
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
      if (backgroundSync && isClient) {
        try {
          const cached = localStorage.getItem(SESSIONS_CACHE_KEY);
          if (cached) {
            const { sessions: cachedSessions } = JSON.parse(cached);
            if (Array.isArray(cachedSessions)) {
              setSessions(cachedSessions);
            }
          }
        } catch (cacheError) {
          console.error("Error loading fallback cache:", cacheError);
        }
      }
    }
  }, [isClient]);

  // Prefetch recent session histories for instant loading
  const prefetchSessionHistory = useCallback(async (sessionId: string) => {
    // Skip if already prefetched or currently prefetching
    if (prefetchedHistories.has(sessionId) || prefetchingSessions.has(sessionId)) {
      return;
    }

    setPrefetchingSessions(prev => new Set(prev).add(sessionId));

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

        setPrefetchedHistories(prev => new Map(prev).set(sessionId, historyMessages));
      }
    } catch (error) {
      console.error(`Failed to prefetch session ${sessionId}:`, error);
    } finally {
      setPrefetchingSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(sessionId);
        return newSet;
      });
    }
  }, [prefetchedHistories, prefetchingSessions]);

  // Background prefetching for recent sessions
  const startBackgroundPrefetch = useCallback(() => {
    if (!isOpen || sessions.length === 0) return;

    // Prefetch the 3 most recent sessions (excluding current session)
    const sessionsToPrefetch = sessions
      .filter(session => session.id !== currentSessionId)
      .slice(0, 3);

    sessionsToPrefetch.forEach(session => {
      // Small delay between prefetches to avoid overwhelming the server
      setTimeout(() => prefetchSessionHistory(session.id), Math.random() * 1000);
    });
  }, [isOpen, sessions, currentSessionId, prefetchSessionHistory]);

  // Set client flag on mount to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
      // Auto-refresh sessions every 30 seconds for multi-device sync
      const interval = setInterval(fetchSessions, 30000);
      return () => clearInterval(interval);
    }
  }, [isOpen, fetchSessions]);

  // Start background prefetching when sidebar opens and sessions are loaded
  useEffect(() => {
    if (isOpen && sessions.length > 0) {
      // Small delay to ensure sessions are fully loaded
      const prefetchTimer = setTimeout(startBackgroundPrefetch, 1000);
      return () => clearTimeout(prefetchTimer);
    }
  }, [isOpen, sessions.length, startBackgroundPrefetch]);

  // Refresh sessions when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchSessions();
    }
  }, [refreshTrigger, fetchSessions]);

  // Background sync every 30 seconds when sidebar is open
  useEffect(() => {
    if (!isOpen) return;
    const syncInterval = setInterval(() => {
      fetchSessions(true); // backgroundSync = true
    }, 30000); // 30 seconds
    return () => clearInterval(syncInterval);
  }, [isOpen, fetchSessions]);

  // Load cached sessions immediately for instant paint (only on client)
  useEffect(() => {
    if (!isClient) return;
    
    const loadCachedSessions = () => {
      try {
        const cached = localStorage.getItem(SESSIONS_CACHE_KEY);
        if (cached) {
          const { sessions: cachedSessions, timestamp } = JSON.parse(cached);
          const now = Date.now();
          
          // Use cache if it's fresh (less than 5 minutes old)
          if (now - timestamp < SESSIONS_CACHE_TTL && Array.isArray(cachedSessions)) {
            setSessions(cachedSessions);
            return true; // Cache was used
          }
        }
      } catch (error) {
        console.error("Error loading cached sessions:", error);
      }
      return false; // Cache was not used
    };

    // Try cache first, then fallback to initialSessions
    const cacheUsed = loadCachedSessions();
    if (!cacheUsed && initialSessions && initialSessions.length > 0) {
      setSessions(initialSessions);
    }
  }, [isClient, initialSessions]);

  

  const createNewSession = async () => {
    try {
      setIsCreating(true);
      
      // Generate a default title that will be updated after first message
      const defaultTitle = `New Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      
      const data = await apiSessionCreate(defaultTitle, "soumya");
      const newSession = data.session;
      
      // Add to local state immediately for instant UI update
      setSessions(prev => [newSession, ...prev]);
      
      // Update cache immediately (only on client)
      if (isClient) {
        try {
          const updatedSessions = [newSession, ...sessions];
          localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify({
            sessions: updatedSessions,
            timestamp: Date.now()
          }));
        } catch (cacheError) {
          console.error("Error updating session cache:", cacheError);
        }
      }
      
      onSessionSelect(newSession.id);
      onClose();
    } catch (error) {
      console.error("Error creating session:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm("Are you sure you want to delete this chat?")) return;
    
    try {
      await apiSessionDelete(sessionId);
      const updatedSessions = sessions.filter(s => s.id !== sessionId);
      setSessions(updatedSessions);
      
      // Update cache immediately (only on client)
      if (isClient) {
        try {
          localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify({
            sessions: updatedSessions,
            timestamp: Date.now()
          }));
        } catch (cacheError) {
          console.error("Error updating session cache:", cacheError);
        }
      }
      
      if (currentSessionId === sessionId) {
        const newSession = await createDefaultSession();
        if (newSession) onSessionSelect(newSession.id);
      }
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  };

  const createDefaultSession = async (): Promise<ChatSession | null> => {
    try {
      const data = await apiSessionCreate("New Chat", "soumya");
      const newSession = data.session;
      setSessions(prev => [newSession, ...prev]);
      
      // Update cache immediately
      try {
        const updatedSessions = [newSession, ...sessions];
        localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify({
          sessions: updatedSessions,
          timestamp: Date.now()
        }));
      } catch (cacheError) {
        console.error("Error updating session cache:", cacheError);
      }
      
      return newSession as ChatSession;
    } catch (error) {
      console.error("Error creating default session:", error);
    }
    return null;
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      
      // Get the start of today (midnight) in local timezone for accurate day comparison
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      // Get the start of the session date (midnight) in local timezone
      const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      
      // Calculate the difference in days
      const diffTime = today.getTime() - sessionDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) {
        // Same day - show time
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (diffDays === 1) {
        return "Yesterday";
      } else if (diffDays === -1) {
        return "Tomorrow";
      } else if (diffDays > 1 && diffDays < 7) {
        return `${diffDays} days ago`;
      } else if (diffDays > 7 && diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
      } else if (diffDays > 30 && diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return `${months} month${months === 1 ? '' : 's'} ago`;
      } else if (diffDays >= 365) {
        const years = Math.floor(diffDays / 365);
        return `${years} year${years === 1 ? '' : 's'} ago`;
      } else if (diffDays < 0 && diffDays > -7) {
        return `In ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`;
      } else if (diffDays < 0) {
        return date.toLocaleDateString();
      }
      
      // Fallback for edge cases
      return date.toLocaleDateString();
    } catch (error) {
      console.error("Error formatting date:", error, dateString);
      return "Unknown";
    }
  };

  const truncateMessage = (message: string, maxLength: number = 50) => {
    return message.length > maxLength ? message.substring(0, maxLength) + "..." : message;
  };

  return (
    <>
      {/* Backdrop with subtle blur */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300"
          onClick={onClose}
        />
      )}
      
      {/* Floating Sidebar with Apple-like minimalism */}
      <div className={`fixed left-0 sm:left-4 top-0 sm:top-4 h-full sm:h-[calc(100vh-2rem)] w-full sm:w-80 bg-black/95 backdrop-blur-2xl border border-white/10 rounded-none sm:rounded-3xl shadow-2xl transform transition-all duration-500 ease-out z-50 flex flex-col ${
        isOpen
          ? 'translate-x-0 opacity-100 scale-100'
          : '-translate-x-full opacity-0 scale-95'
      }`}>
        {/* Header with minimal styling */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-2xl">
              <MessageSquare className="h-5 w-5 text-white/80" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-white">Chats</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-10 w-10 p-0 hover:bg-white/10 text-white/60 hover:text-white rounded-2xl transition-all duration-200"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* New Chat Button with Apple-like design */}
        <div className="p-4 sm:p-6">
          <Button
            onClick={createNewSession}
            disabled={isCreating}
            className="w-full bg-white/10 hover:bg-white/20 text-white font-medium py-3 sm:py-4 rounded-2xl transition-all duration-300 border border-white/20 shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating...
              </div>
            ) : (
              <>
                <SquarePlus className="h-5 w-5 mr-3" />
                New Chat
              </>
            )}
          </Button>
        </div>

        {/* Sessions List with clean spacing */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-3 pb-3 scrollbar" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {/* Mobile-only quick actions moved from header */}
          {isMobile && (
            <div className="px-1 py-2 flex items-center gap-2">
              <Button
                onClick={() => (window.location.href = '/memories')}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl py-2"
              >
                Memories
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/reindex`, { method: 'POST' });
                    const d = await r.json();
                    if (!r.ok || !d?.ok) throw new Error(d?.error || 'Reindex failed');
                    alert('Reindex started / completed.');
                  } catch (e: unknown) {
                    const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
                    alert(`Reindex error: ${errorMessage}`);
                  }
                }}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl py-2"
              >
                Reindex
              </Button>
            </div>
          )}
          {sessions.length === 0 ? (
            <div className="p-6 sm:p-8 text-center text-white/50">
              <div className="p-4 bg-white/5 rounded-2xl mb-4 inline-block">
                <MessageSquare className="h-8 w-8 text-white/30" />
              </div>
              <p className="text-sm font-medium mb-1">No chats yet</p>
              <p className="text-xs text-white/40">Start a new conversation to begin</p>
              {/* Test content for scrollbar visibility */}
              <div className="mt-8 space-y-2">
                {Array.from({ length: 20 }, (_, i) => (
                  <div key={i} className="p-3 bg-white/5 rounded-lg text-left">
                    <p className="text-xs text-white/40">Test Session {i + 1}</p>
                    <p className="text-xs text-white/30 truncate">This is test content to check scrollbar visibility</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group relative flex items-center gap-3 p-3 sm:p-4 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
                    currentSessionId === session.id
                      ? 'bg-white/10 text-white border border-white/20 shadow-lg'
                      : 'hover:bg-white/5 text-white/80 hover:text-white border border-transparent hover:border-white/10'
                  }`}
                  onClick={() => {
                    // Use prefetched data if available for instant loading
                    if (prefetchedHistories.has(session.id)) {
                      const prefetchedMessages = prefetchedHistories.get(session.id);
                      onSessionSelect(session.id, prefetchedMessages);
                    } else {
                      onSessionSelect(session.id);
                    }
                    onClose();
                  }}
                >
                  <div className={`p-2 rounded-xl transition-colors relative ${
                    currentSessionId === session.id
                      ? 'bg-white/20'
                      : 'bg-white/10 group-hover:bg-white/15'
                  }`}>
                    <MessageSquare className="h-4 w-4 text-white/60" />
                    {/* Prefetch indicator */}
                    {prefetchedHistories.has(session.id) && (
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-pulse"
                           title="Instant loading enabled" />
                    )}
                    {prefetchingSessions.has(session.id) && (
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-400 rounded-full animate-spin"
                           title="Loading in background..." />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium text-sm truncate">
                        {session.title && session.title.trim() !== '' 
                          ? session.title 
                          : truncateMessage(session.last_message || 'New Chat', 40)}
                      </h3>
                      <div className="flex flex-col items-end">
                        <span 
                          className="text-xs text-white/50 cursor-help"
                          title={`Created: ${new Date(session.created_at).toLocaleString()}`}
                        >
                          {formatDate(session.created_at)}
                        </span>
                        {/* Show exact date for older chats */}
                        {(() => {
                          const date = new Date(session.created_at);
                          const now = new Date();
                          const diffTime = now.getTime() - date.getTime();
                          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                          if (diffDays > 7) {
                            return (
                              <span className="text-xs text-white/30">
                                {date.toLocaleDateString()}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                    
                    {session.last_message && (
                      <p className="text-xs text-white/50 truncate">
                        {truncateMessage(session.last_message)}
                      </p>
                    )}
                  </div>

                  {/* Enhanced Delete Button with better visibility */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                    className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-white/60 hover:text-red-400 transition-all duration-200 rounded-xl"
                    aria-label="Delete chat"
                    title="Delete chat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>

                  {/* Active Indicator */}
                  {/* {currentSessionId === session.id && (
                    <div className="flex items-center gap-1 text-white/80">
                      <div className="w-2 h-2 bg-white/80 rounded-full animate-pulse" />
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  )} */}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with minimal branding */}
        <div className="flex-shrink-0 border-t border-white/10 p-4 sm:p-6 bg-white/5 rounded-b-none sm:rounded-b-3xl">
          <div className="flex items-center justify-center gap-2 text-sm text-white/50">
            <Sparkles className="h-4 w-4 text-white/40" />
            <span className="font-medium">Eclipse AI</span>
            <span className="text-xs text-white/40">Assistant</span>
          </div>
        </div>
      </div>
    </>
  );
}
