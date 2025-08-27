import { getBackendUrl } from "@/utils/config";

export async function GET() {
  const backendUrl = getBackendUrl();
  
  try {
    const response = await fetch(`${backendUrl}/health`);
    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}


