import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const token = process.env.BACKEND_API_KEY;
  const { searchParams } = new URL(req.url);
  const user_id = searchParams.get("user_id") || "soumya";
  // Aggregate: open tasks + pending memories + recent memories
  const headers = { ...(token ? { "x-api-key": token } : {}) } as any;
  const [tasksR, pendingR, memsR] = await Promise.all([
    fetch(`${backendUrl}/tasks?user_id=${encodeURIComponent(user_id)}&status=open&limit=20`, { headers, cache: "no-store" }),
    fetch(`${backendUrl}/memories/pending?user_id=${encodeURIComponent(user_id)}&limit=20`, { headers, cache: "no-store" }),
    fetch(`${backendUrl}/memories?user_id=${encodeURIComponent(user_id)}&limit=20`, { headers, cache: "no-store" }),
  ]);
  const [tasks, pending, mems] = await Promise.all([tasksR.json(), pendingR.json(), memsR.json()]);
  return NextResponse.json({ ok: true, tasks: tasks.tasks || [], pending: pending.items || [], memories: mems.items || [] });
}


