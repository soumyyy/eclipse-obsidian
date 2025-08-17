export async function POST(req: Request) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const token = process.env.BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  const body = await req.json();
  const upstream = await fetch(`${backendUrl}/summarize_url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-api-key": token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  return new Response(JSON.stringify(data), { status: upstream.status });
}


