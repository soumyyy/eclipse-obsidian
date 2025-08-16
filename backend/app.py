# --- load .env before anything else ---
import os, shutil, hmac, hashlib
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
# --------------------------------------

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional   # <-- ensure Optional is imported

from rag import RAG
from llm_cerebras import cerebras_chat
from memory import recall_memories, add_memory
from tools import web_search_ddg, create_note
from git_sync import pull_and_changes, ensure_clone
from ingest import rebuild_all, incremental_update
from github_fetch import fetch_repo_snapshot
from ingest import main as ingest_main

load_dotenv()
ASSISTANT = os.getenv("ASSISTANT_NAME", "Atlas")
VERCEL_SITE = os.getenv("VERCEL_SITE", "http://localhost:3000")
BACKEND_TOKEN = os.getenv("BACKEND_TOKEN", "")

app = FastAPI(title="Obsidian RAG + Cerebras Assistant")

@app.on_event("startup")
def bootstrap_index():
    try:
        # build index once if missing
        if not (os.path.exists("./data/index.faiss") and os.path.exists("./data/docs.pkl")):
            tmp = fetch_repo_snapshot()
            try:
                ingest_main(vault_dir=tmp)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        _ = get_retriever()  # warm
        print("Bootstrap complete.")
    except Exception as e:
        print(f"[startup] Non-fatal: {e}")

# CORS (lock to your UI origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[VERCEL_SITE],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Models ----------
class ChatIn(BaseModel):
    user_id: str
    message: str
    use_web: bool = False
    make_note: Optional[str] = None  # if set, save a note with this title

class ChatOut(BaseModel):
    reply: str
    sources: List[Dict] = []
    tools_used: List[str] = []

# ---------- Helpers ----------
SYSTEM_PROMPT = f"""You are {ASSISTANT}, a helpful personal assistant.
Use the provided CONTEXT and MEMORIES to answer accurately and concisely.
Cite snippets using [1], [2], etc. If unsure, say so and suggest next steps.
"""

def build_messages(user_id: str, user_msg: str, context: str, memories_text: str):
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"MEMORIES:\n{memories_text or '(none)'}"},
        {"role": "system", "content": f"CONTEXT:\n{context or '(no retrieval hits)'}"},
        {"role": "user", "content": user_msg},
    ]

_retriever: RAG | None = None
def get_retriever():
    global _retriever
    if _retriever is None:
        _retriever = RAG(top_k=5)
    return _retriever

@app.on_event("startup")
def bootstrap_index():
    # if user provided a repo, try to clone on boot
    try:
        if os.getenv("GIT_URL"):
            ensure_clone()
        # if no FAISS yet, build it (works for local vault or cloned repo)
        if not (os.path.exists("./data/index.faiss") and os.path.exists("./data/docs.pkl")):
            rebuild_all()
        # warm retriever
        _ = get_retriever()
        print("Bootstrap complete.")
    except Exception as e:
        print(f"[startup] Non-fatal: {e}")

def verify_auth(x_api_key: str | None):
    if BACKEND_TOKEN and x_api_key != BACKEND_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

# ---------- Routes ----------
@app.get("/healthz")
def healthz():
    return {"ok": True, "assistant": ASSISTANT}

def _verify_github_sig(secret: str, payload: bytes, signature: str | None):
    if not (secret and signature and signature.startswith("sha256=")):
        return False
    mac = hmac.new(secret.encode(), msg=payload, digestmod=hashlib.sha256)
    return hmac.compare_digest(mac.hexdigest(), signature.split("=")[1])

def _verify_github_sig(secret: str, payload: bytes, signature: str | None):
    if not (secret and signature and signature.startswith("sha256=")):
        return False
    mac = hmac.new(secret.encode(), msg=payload, digestmod=hashlib.sha256)
    return hmac.compare_digest(mac.hexdigest(), signature.split("=")[1])

@app.post("/webhook/github")
async def github_webhook(request: Request):
    secret = os.getenv("GIT_WEBHOOK_SECRET", "")
    body = await request.body()
    sig = request.headers.get("x-hub-signature-256")
    if secret and not _verify_github_sig(secret, body, sig):
        raise HTTPException(401, "Invalid signature")

    event = await request.json()
    branch = os.getenv("GITHUB_BRANCH", "main")
    if event.get("ref", "").split("/")[-1] != branch:
        return {"status": "ignored", "reason": event.get("ref")}

    # fresh snapshot → rebuild
    tmp = fetch_repo_snapshot()
    try:
        ingest_main(vault_dir=tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # refresh retriever
    global _retriever; _retriever = None
    return {"status": "ok", "mode": "zip_rebuild"}

@app.post("/chat", response_model=ChatOut)
def chat(payload: ChatIn, x_api_key: str | None = Header(default=None)):
    verify_auth(x_api_key)

    tools_used = []

    # Retrieval
    try:
        retriever = get_retriever()
        context, hits = retriever.build_context(payload.message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Retriever not ready: {e}. Run `python ingest.py`.") from e

    # Recall memories
    mems = recall_memories(payload.user_id, limit=6)
    memories_text = "\n".join([f"- ({k}) {c}" for k, c in mems]) if mems else ""

    # Optional tools
    tool_snippets = ""
    if payload.use_web:
        tools_used.append("web_search_ddg")
        results = web_search_ddg(payload.message, max_results=5)
        if results:
            tool_snippets = "WEB SEARCH:\n" + "\n".join(f"- {r['title']} ({r['url']})" for r in results)

    if payload.make_note:
        tools_used.append("create_note")
        note_path = create_note(payload.make_note, f"Auto-created from chat:\n\n{payload.message}")
        tool_snippets += f"\nNOTE:\n- Created {note_path}"

    if tool_snippets:
        context = context + "\n\n" + tool_snippets

    # LLM call
    messages = build_messages(payload.user_id, payload.message, context, memories_text)
    reply = cerebras_chat(messages)

    # Lightweight memory capture
    low = payload.message.lower()
    if "i prefer" in low or "my preference" in low:
        add_memory(payload.user_id, "preference", payload.message, weight=1.2)

    return ChatOut(
        reply=reply,
        sources=[{"path": h["path"], "score": h["score"]} for h in hits],
        tools_used=tools_used
    )