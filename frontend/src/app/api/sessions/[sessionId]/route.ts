import { getBackendUrl } from "@/utils/config";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const backendUrl = getBackendUrl();
  const { sessionId } = await params;

  try {
    const response = await fetch(`${backendUrl}/api/sessions/${sessionId}`, {
      method: "DELETE",
      headers: {
        "X-API-Key": process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || ""
      }
    });

    if (!response.ok) {
      throw new Error(`Backend responded with ${response.status}`);
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    console.error("Error deleting session:", error);
    return Response.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
