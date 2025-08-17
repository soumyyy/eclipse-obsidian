import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    const token = process.env.BACKEND_API_KEY;
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get("user_id");
    const limit = searchParams.get("limit") || "50";
    const url = `${backendUrl}/memories/pending?user_id=${encodeURIComponent(user_id || "")}&limit=${encodeURIComponent(limit)}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        ...(token ? { "x-api-key": token } : {}),
      },
      cache: "no-store",
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Unexpected error" }, { status: 500 });
  }
}


