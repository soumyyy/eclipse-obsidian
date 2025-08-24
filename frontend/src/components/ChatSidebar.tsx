"use client";

import { useState, useEffect } from "react";
import { 
  Plus, 
  MessageSquare, 
  Trash2, 
  Settings,
  X,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
  onSessionSelect: (sessionId: string) => void;
  currentSessionId?: string;
}

export default function ChatSidebar({ 
  isOpen, 
  onClose, 
  onSessionSelect, 
  currentSessionId 
}: ChatSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  const fetchSessions = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions?user_id=soumya`, {
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  };

  const createNewSession = async () => {
    if (!newSessionTitle.trim()) return;
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
        },
        body: JSON.stringify({
          user_id: "soumya",
          title: newSessionTitle.trim()
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setSessions(prev => [data.session, ...prev]);
        setNewSessionTitle("");
        setIsCreating(false);
        onSessionSelect(data.session.id);
        onClose(); // Close sidebar after creating
      }
    } catch (error) {
      console.error("Error creating session:", error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm("Are you sure you want to delete this chat?")) return;
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions/${sessionId}`, {
        method: "DELETE",
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_API_KEY || 'qwertyuiop'
        }
      });
      
      if (response.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        if (currentSessionId === sessionId) {
          // If we deleted the current session, create a new one
          const newSession = await createDefaultSession();
          if (newSession) {
            onSessionSelect(newSession.id);
          }
        }
      }
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  };

  const createDefaultSession = async (): Promise<ChatSession | null> => {
    try {
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
        setSessions(prev => [data.session, ...prev]);
        return data.session;
      }
    } catch (error) {
      console.error("Error creating default session:", error);
    }
    return null;
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - date.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      return date.toLocaleDateString();
    } catch {
      return "Unknown";
    }
  };

  const truncateMessage = (message: string, maxLength: number = 50) => {
    return message.length > maxLength ? message.substring(0, maxLength) + "..." : message;
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <div className={`fixed left-0 top-0 h-full w-80 bg-black/90 backdrop-blur-xl border-r border-gray-600 transform transition-transform duration-300 ease-in-out z-50 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-600">
          <h2 className="text-lg font-semibold text-white">Chats</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 hover:bg-gray-800 text-gray-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* New Chat Button */}
        <div className="p-4">
          <Button
            onClick={() => setIsCreating(true)}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 rounded-lg transition-colors border border-gray-600"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Chat
          </Button>
        </div>

        {/* Create New Session Input */}
        {isCreating && (
          <div className="px-4 pb-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                placeholder="Enter chat title..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createNewSession();
                  if (e.key === 'Escape') {
                    setIsCreating(false);
                    setNewSessionTitle("");
                  }
                }}
                autoFocus
              />
              <Button
                onClick={createNewSession}
                size="sm"
                className="bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 rounded-lg"
              >
                Create
              </Button>
            </div>
          </div>
        )}

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm">No chats yet</p>
              <p className="text-xs">Start a new conversation</p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group relative flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    currentSessionId === session.id
                      ? 'bg-gray-700 text-white border border-gray-500'
                      : 'hover:bg-gray-800 text-gray-300 hover:text-white'
                  }`}
                  onClick={() => {
                    onSessionSelect(session.id);
                    onClose();
                  }}
                >
                  <MessageSquare className="h-4 w-4 text-gray-500 flex-shrink-0" />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-sm truncate">
                        {session.title}
                      </h3>
                      <span className="text-xs text-gray-400">
                        {formatDate(session.created_at)}
                      </span>
                    </div>
                    
                    {session.last_message && (
                      <p className="text-xs text-gray-500 truncate mt-1">
                        {truncateMessage(session.last_message)}
                      </p>
                    )}
                  </div>

                  {/* Delete Button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                    className="h-6 w-6 p-0 opacity-80 group-hover:opacity-100 hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-all"
                    aria-label="Delete chat"
                    title="Delete chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>

                  {/* Active Indicator */}
                  {currentSessionId === session.id && (
                    <ChevronRight className="h-4 w-4 text-white flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-600 p-4">
          <div className="text-xs text-gray-500 text-center">
            Eclipse AI Assistant
          </div>
        </div>
      </div>
    </>
  );
}
