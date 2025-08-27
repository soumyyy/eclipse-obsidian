import { getBackendUrl } from "@/utils/config";

export async function POST() {
  const backendUrl = getBackendUrl();
  const token = process.env.BACKEND_API_KEY;
  
  try {
    const response = await fetch(`${backendUrl}/admin/reindex`, {
      method: "POST",
      headers: { ...(token ? { "x-api-key": token } : {}) }
    });
    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: "Failed to connect to backend" }, { status: 500 });
  }
}


