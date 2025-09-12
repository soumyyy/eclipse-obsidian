/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBackendUrl } from "@/utils/config";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const backendUrl = getBackendUrl();
  const token = process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  
  try {
    const response = await fetch(`${backendUrl}/tasks/${id}/complete?${searchParams.toString()}`, {
      method: "POST",
      headers: { ...(token ? { "X-API-Key": token } : {}) }
    });
    const data = await response.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}
