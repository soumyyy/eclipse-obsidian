"use client";

import { useState, useEffect } from "react";
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Settings,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

interface ChatSession {
  id: string;
  title: string;
  last_message: string;
  created_at: string;
  message_count: number;
  is_active: boolean;
}

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  activeSession: string;
  onSessionChange: (sessionId: string) => void;
}

export default function Sidebar({ isOpen, onToggle, activeSession, onSessionChange }: SidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const createNewSession = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" })
      });
      if (response.ok) {
        fetchSessions();
      }
    } catch (error) {
      console.error("Error creating session:", error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/sessions/${sessionId}`, { method: "DELETE" });
      if (response.ok) {
        fetchSessions();
        if (activeSession === sessionId) {
          onSessionChange("");
        }
      }
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className={`fixed top-4 left-4 z-50 p-2 rounded-lg bg-black/80 backdrop-blur-sm border border-red-500/30 text-red-400 transition-all duration-300 hover:bg-red-500/20 hover:border-red-500/50 ${
          isOpen ? 'left-4' : 'left-4'
        }`}
      >
        {isOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 h-full w-80 bg-black/90 backdrop-blur-xl border-r border-red-500/30 z-40 transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-red-500/20">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-red-400" />
                Chat Sessions
              </h2>
              <button
                onClick={createNewSession}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors border border-red-500"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {isLoading ? (
              <div className="text-center py-8 text-gray-400">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto mb-3"></div>
                <p>Loading sessions...</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50 text-red-400" />
                <p>No chat sessions yet</p>
                <p className="text-sm">Create your first session to get started</p>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group relative p-3 rounded-lg border transition-all duration-200 cursor-pointer hover:bg-red-500/10 ${
                    activeSession === session.id
                      ? 'bg-red-600/20 border-red-500/50'
                      : 'bg-gray-800/50 border-red-500/20 hover:border-red-500/40'
                  }`}
                  onClick={() => onSessionChange(session.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-white truncate">
                        {session.title}
                      </h4>
                      <p className="text-sm text-gray-400 truncate mt-1">
                        {session.last_message || "No messages yet"}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                        <span className="bg-red-500/20 px-2 py-1 rounded-full text-red-300 border border-red-500/30">
                          {session.message_count} msgs
                        </span>
                      </div>
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 hover:bg-red-500/20 p-1 rounded transition-all duration-200"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-red-500/20">
            <button className="w-full p-2 rounded-lg bg-gray-800/50 hover:bg-red-500/20 text-gray-300 hover:text-red-300 transition-colors flex items-center justify-center gap-2 border border-red-500/20 hover:border-red-500/40">
              <Settings className="w-4 h-4" />
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30"
          onClick={onToggle}
        />
      )}
    </>
  );
}
