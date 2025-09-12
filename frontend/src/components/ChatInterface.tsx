"use client";
import { useCallback } from "react";
import Message from "@/components/Message";
import { Plus, Mic, SendHorizonal } from "lucide-react";

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

interface ChatInterfaceProps {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  creatingSession: boolean;
  transcribing: boolean;
  recording: boolean;
  healthy: boolean | null;
  taskCandByIndex: Record<number, TaskCandidate[]>;
  onSendMessage: (message: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCreateTask: (title: string, messageIndex: number, candidateIndex: number) => void;
  onDismissTask: (messageIndex: number, candidateIndex: number) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  pendingFiles: File[];
  setPendingFiles: (files: File[] | ((prev: File[]) => File[])) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export default function ChatInterface({
  messages,
  input,
  setInput,
  loading,
  creatingSession,
  transcribing,
  recording,
  healthy,
  taskCandByIndex,
  onSendMessage,
  onStartRecording,
  onStopRecording,
  onCreateTask,
  onDismissTask,
  listRef,
  inputRef,
  pendingFiles,
  setPendingFiles,
  fileInputRef,
}: ChatInterfaceProps) {
  // Stable input change handler
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, [setInput]);

  // Stable file input change handler
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
    // reset so selecting same file again re-triggers change
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [setPendingFiles, fileInputRef]);

  // Stable file removal handler
  const handleRemoveFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, idx) => idx !== index));
  }, [setPendingFiles]);

  // Stable send message handler
  const handleSendMessage = useCallback(() => {
    onSendMessage(input);
  }, [onSendMessage, input]);

  // Stable key down handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send; Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage(input);
    }
  }, [onSendMessage, input]);

  // Stable handlers for task management
  const handleTaskAddForIndex = useCallback((messageIndex: number) => {
    return (title: string) => onCreateTask(title, messageIndex, 0);
  }, [onCreateTask]);

  const handleTaskDismissForIndex = useCallback((messageIndex: number) => {
    return (candidateIndex: number) => onDismissTask(messageIndex, candidateIndex);
  }, [onDismissTask]);

  // Stable file input click handler
  const handleFileInputClick = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <div 
          ref={listRef} 
          className="scrollbar-thin max-w-5xl mx-auto px-2 sm:px-3 lg:px-6 py-3 sm:py-5 space-y-3 sm:space-y-3.5 overflow-y-auto" 
          style={{ maxHeight: "calc(100dvh - 140px)", scrollbarGutter: "stable both-edges" }}
        >
          {messages.map((msg, idx) => (
            <Message
              key={idx}
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              formatted={msg.formatted}
              attachments={msg.attachments}
              taskCandidates={taskCandByIndex[idx] || []}
              onTaskAdd={handleTaskAddForIndex(idx)}
              onTaskDismiss={handleTaskDismissForIndex(idx)}
            />
          ))}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-white/10 bg-black/40 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto p-2 sm:p-4">
          {/* File uploads display - above the input bar */}
          {pendingFiles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2 justify-center">
              {pendingFiles.map((f, i) => (
                <div key={i} className="inline-flex items-center gap-2 text-xs sm:text-sm bg-white/10 border border-white/20 rounded-lg px-3 py-2 backdrop-blur-sm max-w-full">
                  <span className="text-white/90 font-medium max-w-[120px] sm:max-w-[150px] lg:max-w-none truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => handleRemoveFile(i)}
                    className="opacity-60 hover:opacity-100 ml-2 text-gray-400 hover:text-white transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex items-end gap-2 sm:gap-3">
            <button
              onClick={handleFileInputClick}
              className="flex-shrink-0 p-1.5 sm:p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Attach files"
            >
              <Plus size={18} className="sm:w-[18px] sm:h-[18px]" />
            </button>
            
            {/* Hidden file input */}
            <input
              type="file"
              accept=".pdf,.md,.markdown,text/markdown,text/plain,application/pdf"
              multiple
              ref={fileInputRef}
              id="file-upload"
              name="file-upload"
              onChange={handleFileChange}
              className="hidden"
            />
            
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
                className="w-full bg-transparent text-white px-2 py-1 sm:py-2 pr-2 outline-none placeholder:text-white/40 resize-none overflow-y-auto text-sm sm:text-base"
              />
              {transcribing && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/60">
                  Transcribing...
                </span>
              )}
            </div>

            <button
              onClick={recording ? onStopRecording : onStartRecording}
              className={`flex-shrink-0 p-1.5 sm:p-2 rounded-lg transition-colors ${
                recording 
                  ? "bg-red-600 hover:bg-red-700 text-white" 
                  : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
              title={recording ? "Stop recording" : "Start recording"}
            >
              <Mic size={18} className="sm:w-[18px] sm:h-[18px]" />
            </button>

            <button
              onClick={handleSendMessage}
              disabled={loading || !input.trim() || creatingSession}
              className="flex-shrink-0 p-1.5 sm:p-2 bg-white text-black hover:bg-white/90 disabled:bg-white/20 disabled:text-white/40 rounded-lg transition-colors"
              title="Send message"
            >
              <SendHorizonal size={18} className="sm:w-[18px] sm:h-[18px]" />
            </button>
          </div>

          {/* Health indicator */}
          {healthy === false && (
            <div className="mt-2 text-xs text-red-400">
              Backend connection issues - some features may not work
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
