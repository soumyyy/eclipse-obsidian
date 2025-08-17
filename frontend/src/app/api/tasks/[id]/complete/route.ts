import { NextRequest } from "next/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const token = process.env.BACKEND_TOKEN || process.env.BACKEND_API_KEY || process.env.BACKEND_TOKEN;
  const { searchParams } = new URL(req.url);
  const user_id = searchParams.get("user_id") || "";
  const upstream = await fetch(`${backendUrl}/tasks/${params.id}/complete?user_id=${encodeURIComponent(user_id)}`, {
    method: "POST",
    headers: { ...(token ? { "x-api-key": token } : {}) },
  });
  const data = await upstream.json();
  return new Response(JSON.stringify(data), { status: upstream.status });
}
