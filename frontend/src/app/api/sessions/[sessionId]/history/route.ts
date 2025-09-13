import { getBackendUrl } from "@/utils/config";

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  const backendUrl = getBackendUrl();
  const { sessionId } = params;
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');

  try {
    const response = await fetch(`${backendUrl}/api/sessions/${sessionId}/history?user_id=${userId}`, {
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
    console.error("Error fetching session history:", error);
    return Response.json({ error: "Failed to fetch session history" }, { status: 500 });
  }
}
