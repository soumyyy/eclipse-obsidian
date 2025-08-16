import { NextResponse } from "next/server";

export async function GET() {
  try {
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    const resp = await fetch(`${backendUrl}/health`, { cache: "no-store" });
    const data = await resp.json();
    if (!resp.ok) return NextResponse.json({ ok: false, error: data?.detail || "Upstream error" }, { status: resp.status });
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Unexpected error" }, { status: 500 });
  }
}


