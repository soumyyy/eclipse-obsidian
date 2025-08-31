import { getBackendUrl } from "@/utils/config";

export async function GET(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  const { searchParams } = new URL(req.url);
  
  try {
    const response = await fetch(`${backendUrl}/memories?${searchParams.toString()}`, {
      headers: { ...(token ? { "X-API-Key": token } : {}) }
    });
    const data = await response.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  
  try {
    const response = await fetch(`${backendUrl}/memories`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...(token ? { "X-API-Key": token } : {})
      },
      body: JSON.stringify(await req.json())
    });
    const data = await response.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}


