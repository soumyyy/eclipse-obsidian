import { getBackendUrl } from "@/utils/config";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const backendUrl = getBackendUrl();
  const { sessionId } = await params;

  try {
    const json = await request.json();
    const response = await fetch(`${backendUrl}/api/sessions/${sessionId}/title`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || ""
      },
      body: JSON.stringify(json)
    });

    if (!response.ok) {
      throw new Error(`Backend responded with ${response.status}`);
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    console.error("Error updating session title:", error);
    return Response.json({ error: "Failed to update session title" }, { status: 500 });
  }
}
