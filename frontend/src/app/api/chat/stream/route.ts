export async function POST(req: Request) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const token = process.env.BACKEND_API_KEY;
  const payload = await req.json();
  const upstream = await fetch(`${backendUrl}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-api-key": token } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "Upstream error");
    return new Response(errText, { status: upstream.status || 500 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}


