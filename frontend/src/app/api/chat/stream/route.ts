import { getBackendUrl } from "@/utils/config";

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  
  try {
    const json = await req.json();
    const upstream = await fetch(`${backendUrl}/chat/stream`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...(token ? { "X-API-Key": token } : {}) 
      },
      body: JSON.stringify(json),
    });
    
    const headers = new Headers();
    headers.set("Content-Type", "text/event-stream");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to connect to backend" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}


