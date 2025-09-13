import { getBackendUrl } from "@/utils/config";

export async function GET(request: Request) {
  const backendUrl = getBackendUrl();
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');

  try {
    const response = await fetch(`${backendUrl}/api/sessions?user_id=${userId}`, {
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
    console.error("Error fetching sessions:", error);
    return Response.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const backendUrl = getBackendUrl();

  try {
    const json = await request.json();
    const response = await fetch(`${backendUrl}/api/sessions`, {
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
    console.error("Error creating session:", error);
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
