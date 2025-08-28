import { getBackendUrl } from "@/utils/config";

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.BACKEND_API_KEY;
  
  try {
    const upstream = await fetch(`${backendUrl}/chat/stream`, {
      method: "POST",
      headers: { ...(token ? { "x-api-key": token } : {}) },
      body: req.body,
    });
    
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to connect to backend" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}


