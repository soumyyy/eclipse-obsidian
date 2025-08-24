export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const token = process.env.BACKEND_API_KEY;
  const body = await req.json();
  const { id } = await params;
  const upstream = await fetch(`${backendUrl}/memories/pending/${id}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-api-key": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  return new Response(JSON.stringify(data), { status: upstream.status });
}


