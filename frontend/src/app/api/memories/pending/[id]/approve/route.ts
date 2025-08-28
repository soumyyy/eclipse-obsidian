import { getBackendUrl } from "@/utils/config";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const backendUrl = getBackendUrl();
  const token = process.env.BACKEND_API_KEY;
  const { id } = await params;
  
  try {
    const response = await fetch(`${backendUrl}/memories/pending/${id}/approve`, {
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