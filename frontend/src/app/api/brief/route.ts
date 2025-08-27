import { getBackendUrl } from "@/utils/config";

export async function GET(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.BACKEND_API_KEY;
  const { searchParams } = new URL(req.url);
  const user_id = searchParams.get("user_id") || "soumya";
  
  try {
    // Aggregate: open tasks + pending memories + recent memories
    const headers: Record<string, string> = { ...(token ? { "x-api-key": token } : {}) };
    const [tasksR, pendingR, memsR] = await Promise.all([
      fetch(`${backendUrl}/tasks?user_id=${encodeURIComponent(user_id)}&status=open&limit=20`, { headers, cache: "no-store" }),
      fetch(`${backendUrl}/memories/pending?user_id=${encodeURIComponent(user_id)}&limit=20`, { headers, cache: "no-store" }),
      fetch(`${backendUrl}/memories?user_id=${encodeURIComponent(user_id)}&limit=20`, { headers, cache: "no-store" }),
    ]);
    
    const [tasks, pending, mems] = await Promise.all([tasksR.json(), pendingR.json(), memsR.json()]);
    return Response.json({ 
      ok: true, 
      tasks: tasks.tasks || [], 
      pending: pending.items || [], 
      memories: mems.items || [] 
    });
  } catch (error) {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}


