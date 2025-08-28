import { getBackendUrl } from "@/utils/config";

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.BACKEND_API_KEY;
  
  try {
    const response = await fetch(`${backendUrl}/summarize-url`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...(token ? { "x-api-key": token } : {})
      },
      body: JSON.stringify(await req.json())
    });
    const data = await response.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}


