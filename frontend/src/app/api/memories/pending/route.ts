import { getBackendUrl } from "@/utils/config";

export async function GET(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.BACKEND_API_KEY;
  const { searchParams } = new URL(req.url);
  
  try {
    const response = await fetch(`${backendUrl}/memories/pending?${searchParams.toString()}`, {
      headers: { ...(token ? { "x-api-key": token } : {}) }
    });
    const data = await response.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}


