import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const token = process.env.BACKEND_API_KEY;
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const upstream = await fetch(`${backendUrl}/memories?${qs}`, { headers: { ...(token ? { "x-api-key": token } : {}) }, cache: "no-store" });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function POST(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const token = process.env.BACKEND_API_KEY;
  const body = await req.json();
  const { mem_id, action } = body || {};
  let path = "/memories";
  if (mem_id && action === "delete") path = `/memories/${mem_id}/delete`;
  else if (mem_id) path = `/memories/${mem_id}`;
  else if (action === 'create') path = `/memories/create`;
  const upstream = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-api-key": token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}


