export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { path: string; score: number }[];
  formatted?: boolean;
  attachments?: { name: string; type: string }[];
}

export interface ChatSession {
  id: string;
  title: string;
  last_message: string;
  created_at: string;
  message_count: number;
  is_active: boolean;
}

export interface RawSession {
  id: string | number;
  title?: string;
  last_message?: string;
  created_at?: string;
  message_count?: number | string;
  is_active?: boolean | number | string;
}

export interface TaskCandidate {
  title: string;
  due_ts?: number;
  confidence?: number;
}
