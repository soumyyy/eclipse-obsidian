# --- Load .env before anything else ---
import os, hmac, hashlib, shutil
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
# --------------------------------------

from typing import List, Dict, Optional

from fastapi import FastAPI, Header, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag import RAG, make_faiss_retriever                      # our retriever class
from ingest import main as ingest_main   # ingest pipeline that builds FAISS/docs from a dir
from github_fetch import fetch_repo_snapshot
from memory import ensure_db, recall_memories, add_memory
from llm_cerebras import cerebras_chat   # Cerebras chat wrapper

# ----------------- Config -----------------
ASSISTANT      = os.getenv("ASSISTANT_NAME", "Atlas")
FRONTEND_ORIG  = os.getenv("VERCEL_SITE", "http://localhost:3000").strip()
BACKEND_TOKEN  = os.getenv("BACKEND_TOKEN", "").strip()
ADMIN_TOKEN    = os.getenv("ADMIN_TOKEN", BACKEND_TOKEN).strip()  # default to same as BACKEND_TOKEN

DATA_DIR       = "./data"
INDEX_FAISS    = os.path.join(DATA_DIR, "index.faiss")
DOCS_PKL       = os.path.join(DATA_DIR, "docs.pkl")

# ----------------- FastAPI -----------------
app = FastAPI(title="Obsidian RAG + Cerebras Assistant")

# CORS
cors_origins = {FRONTEND_ORIG, "http://localhost:3000", "http://127.0.0.1:3000"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in cors_origins if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- Models -----------------
class ChatIn(BaseModel):
    user_id: str = "local"
    message: str
    make_note: Optional[str] = None
    use_web: bool = False  # reserved, not used here

class ChatOut(BaseModel):
    reply: str
    sources: List[Dict] = []
    tools_used: List[str] = []

# ----------------- Auth helpers -----------------
def require_api_key(x_api_key: Optional[str] = Header(default=None)):
    """Enforce X-API-Key **only** if BACKEND_TOKEN is set."""
    if not BACKEND_TOKEN:
        return
    if not x_api_key or x_api_key != BACKEND_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

# ----------------- LLM Prompt -----------------
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

# ----------------- Retriever singleton -----------------
_retriever: Optional[RAG] = None

_rag = None
def get_retriever():
    global _rag
    if _rag is None:
        retr, embed_fn = make_faiss_retriever(
            index_path="./data/index.faiss",
            docs_path="./data/docs.pkl",
            model_name="sentence-transformers/all-MiniLM-L6-v2",
        )
        _rag = RAG(retriever=retr, embed_fn=embed_fn, top_k=5)
    return _rag

# ----------------- GitHub webhook signature -----------------
def _verify_github_sig(secret: str, payload: bytes, signature: Optional[str]) -> bool:
    if not (secret and signature and signature.startswith("sha256=")):
        return False
    mac = hmac.new(secret.encode(), msg=payload, digestmod=hashlib.sha256)
    return hmac.compare_digest(mac.hexdigest(), signature.split("=", 1)[1])

# ----------------- Startup -----------------
@app.on_event("startup")
def bootstrap():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        ensure_db()  # create ./data/memory.sqlite and tables if needed

        use_github = all(os.getenv(k) for k in ("GITHUB_OWNER","GITHUB_REPO","GITHUB_REF","GITHUB_TOKEN"))
        index_exists = os.path.exists(INDEX_FAISS) and os.path.exists(DOCS_PKL)

        if not index_exists:
            if use_github:
                tmp = fetch_repo_snapshot()
                try:
                    ingest_main(vault_dir=tmp)     # Build from GitHub snapshot
                finally:
                    shutil.rmtree(tmp, ignore_errors=True)
            else:
                # Fallback: build from local vault directory if provided
                ingest_main(vault_dir="./vault")

        # Warm retriever (loads FAISS + docs)
        _ = get_retriever()
        print("Startup bootstrap complete.")
    except Exception as e:
        print(f"[startup] Non-fatal: {e}")

# ----------------- Health -----------------
@app.get("/")
def root():
    return {"ok": True, "service": "obsidian-rag", "auth_required": bool(BACKEND_TOKEN)}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/healthz")
def healthz():
    return {"ok": True, "assistant": ASSISTANT}

# ----------------- Admin reindex -----------------
@app.post("/admin/reindex")
def admin_reindex(x_api_key: Optional[str] = Header(default=None)):
    if ADMIN_TOKEN and x_api_key != ADMIN_TOKEN:
        raise HTTPException(401, "invalid token")

    tmp = fetch_repo_snapshot()
    try:
        ingest_main(vault_dir=tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # refresh retriever
    global _retriever
    _retriever = None
    _ = get_retriever()

    return {"status": "ok", "source": "github_zip", "note": "index rebuilt from repo"}

# ----------------- GitHub webhook -----------------
@app.post("/webhook/github")
async def github_webhook(request: Request):
    secret = os.getenv("GIT_WEBHOOK_SECRET", "")
    body = await request.body()
    sig = request.headers.get("x-hub-signature-256")

    if secret and not _verify_github_sig(secret, body, sig):
        raise HTTPException(401, "Invalid signature")

    event = await request.json()
    branch = os.getenv("GITHUB_BRANCH") or os.getenv("GITHUB_REF", "main")
    if event.get("ref", "").split("/")[-1] != branch:
        return {"status": "ignored", "reason": event.get("ref")}

    tmp = fetch_repo_snapshot()
    try:
        ingest_main(vault_dir=tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    global _retriever
    _retriever = None
    _ = get_retriever()

    return {"status": "ok", "mode": "zip_rebuild"}

# ----------------- Chat -----------------
@app.post("/chat", response_model=ChatOut)
def chat(payload: ChatIn, _=Depends(require_api_key)):
    if not payload.message.strip():
        raise HTTPException(400, "message required")

    # Retrieve context from FAISS
    try:
        retriever = get_retriever()
        context, hits = retriever.build_context(payload.message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Retriever not ready: {e}. Run `python ingest.py`.") from e

    # Recall memories (defensive formatting)
    mems = recall_memories(payload.user_id, limit=6)

    def _fmt_mem_row(r):
        # If memory.py returns dicts
        if isinstance(r, dict):
            t = r.get("type", "note")
            c = r.get("content", "")
            return f"- ({t}) {c}".strip()

        # If it returns tuples/lists (most common: (id, user_id, type, content, weight, ts))
        if isinstance(r, (list, tuple)):
            if len(r) >= 4:
                t, c = r[2], r[3]
                return f"- ({t}) {c}".strip()
            if len(r) == 2:
                t, c = r
                return f"- ({t}) {c}".strip()
            return f"- {r!r}"

        # Fallback
        return f"- {str(r)}"

    memories_text = "\n".join(_fmt_mem_row(r) for r in (mems or []))

    # Build messages and call LLM
    messages = build_messages(payload.user_id, payload.message, context, memories_text)
    reply = cerebras_chat(messages)

    # Optional: store a quick memory
    if payload.make_note:
        add_memory(payload.user_id, payload.make_note, payload.message)

    return ChatOut(
        reply=reply,
        sources=[{"path": h["path"], "score": h["score"]} for h in hits],
        tools_used=[],
    )