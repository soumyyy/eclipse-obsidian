export async function POST() {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  // Prefer ADMIN_API_KEY, fall back to BACKEND_API_KEY
  const adminKey = process.env.ADMIN_API_KEY || process.env.BACKEND_API_KEY;
  const upstream = await fetch(`${backendUrl}/admin/reindex`, {
    method: "POST",
    headers: { ...(adminKey ? { "x-api-key": adminKey } : {}) },
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return new Response(JSON.stringify({ ok: false, error: data?.detail || "Upstream error" }), { status: upstream.status });
  }
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
}


