import { getBackendUrl } from "@/utils/config";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const backendUrl = getBackendUrl();
  const token = process.env.BACKEND_API_KEY;
  const { searchParams } = new URL(req.url);
  
  try {
    const response = await fetch(`${backendUrl}/tasks/${params.id}/complete?${searchParams.toString()}`, {
      method: "POST",
      headers: { ...(token ? { "x-api-key": token } : {}) }
    });
    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}
