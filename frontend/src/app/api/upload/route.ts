import { getBackendUrl } from "@/utils/config";

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();
  const token = process.env.NEXT_PUBLIC_BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  const form = await req.formData();
  
  // forward as-is to backend
  const upstream = await fetch(`${backendUrl}/upload`, {
    method: "POST",
    headers: { ...(token ? { "x-api-key": token } : {}) },
    body: form,
  });
  
  const data = await upstream.json().catch(() => ({}));
  return new Response(JSON.stringify(data), { status: upstream.status });
}


