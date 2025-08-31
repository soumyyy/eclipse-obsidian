import { getBackendUrl } from "@/utils/config";

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  
  try {
    const response = await fetch(`${backendUrl}/chat`, {
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


