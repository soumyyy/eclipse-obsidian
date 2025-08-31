import { getBackendUrl } from "@/utils/config";

const backendUrl = getBackendUrl();
const authHeaders = (): Record<string, string> => {
  const token = process.env.NEXT_PUBLIC_BACKEND_API_KEY || process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY;
  const headers: Record<string, string> = {};
  if (token) headers["X-API-Key"] = token;
  return headers;
};

export type ChatPayload = { user_id: string; message: string; session_id?: string; make_note?: string; save_task?: string; save_fact?: string };

export async function apiChat(body: ChatPayload) {
  const res = await fetch(`/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("chat failed");
  return res.json();
}

export function apiChatStream(payload: ChatPayload) {
  return fetch(`/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

export async function apiMemoriesList(params: URLSearchParams) {
  const res = await fetch(`/api/memories?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("memories failed");
  return res.json();
}

export async function apiTasksList(userId = "soumya") {
  const res = await fetch(`/api/tasks?user_id=${encodeURIComponent(userId)}&status=open&limit=200`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("tasks failed");
  return res.json();
}

export async function apiTaskCreate(content: string, userId = "soumya") {
  const res = await fetch(`/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, content }),
  });
  if (!res.ok) throw new Error("task create failed");
  return res.json();
}

export async function apiTaskComplete(taskId: number, userId = "soumya") {
  const res = await fetch(`/api/tasks/${taskId}/complete?user_id=${encodeURIComponent(userId)}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("task complete failed");
  return res.json();
}

export async function apiSessionsList(userId = "soumya") {
  const res = await fetch(`${backendUrl}/api/sessions?user_id=${encodeURIComponent(userId)}`, {
    headers: { ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("sessions failed");
  return res.json();
}

export async function apiSessionCreate(title = "New Chat", userId = "soumya") {
  const res = await fetch(`${backendUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ user_id: userId, title })
  });
  if (!res.ok) throw new Error("session create failed");
  return res.json();
}

export async function apiSessionDelete(sessionId: string, userId = "soumya") {
  const res = await fetch(`${backendUrl}/api/sessions/${sessionId}`, { method: "DELETE", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error("session delete failed");
  return res.json();
}


