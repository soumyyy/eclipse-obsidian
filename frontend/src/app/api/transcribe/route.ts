import { NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio") as File | null;
    if (!audio) {
      return NextResponse.json({ error: "audio file required" }, { status: 400 });
    }

    const key = process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY/WHISPER_API_KEY" }, { status: 500 });
    }

    // OpenAI Whisper v1 transcription endpoint
    const body = new FormData();
    body.append("file", audio, audio.name || "audio.webm");
    body.append("model", "whisper-1");
    body.append("language", "en"); // force English transcription
    body.append("temperature", "0");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
    });
    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message || "Transcription failed" }, { status: resp.status });
    }
    return NextResponse.json({ ok: true, text: data.text || "" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}


