import { getBackendUrl } from "@/utils/config";

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();

  try {
    const formData = await req.formData();

    const response = await fetch(`${backendUrl}/api/transcribe`, {
      method: "POST",
      headers: {
        "X-API-Key": process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || ""
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return Response.json({ error: errorData.detail || "Transcription failed" }, { status: response.status });
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    console.error("Error in transcribe proxy:", error);
    return Response.json({ error: "Failed to transcribe audio" }, { status: 500 });
  }
}


