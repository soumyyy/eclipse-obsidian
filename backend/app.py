# --- Load .env before anything else ---
import os, hmac, hashlib, shutil
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
# --------------------------------------

from typing import List, Dict, Optional

from fastapi import FastAPI, Header, HTTPException, Request, Depends, BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from rag import RAG, make_faiss_retriever                      # our retriever class
from ingest import ingest_from_dir   # ingest pipeline that builds FAISS/docs from a dir
from github_fetch import fetch_repo_snapshot
from memory import ensure_db, recall_memories, add_memory, add_task, list_tasks, complete_task, add_fact, add_summary, list_pending_memories, approve_pending_memory, reject_pending_memory, list_memories, update_memory, delete_memory, delete_all_memories
from llm_cerebras import cerebras_chat   # Cerebras chat wrapper
from memory_extractor import extract_and_store_memories
from bs4 import BeautifulSoup
import requests

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

# Compression
app.add_middleware(GZipMiddleware, minimum_size=512)

# ----------------- Models -----------------
class ChatIn(BaseModel):
    user_id: str = "local"
    message: str
    make_note: Optional[str] = None
    use_web: bool = False  # reserved, not used here
    save_fact: Optional[str] = None   # explicit fact content
    save_task: Optional[str] = None   # explicit task content

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
Format answers in clear Markdown:
- Use headings for sections
- Use bullet lists with one item per line
- Insert line breaks between sections and lists
- Use code fences for code blocks
- Avoid emojis unless asked
- Talk like Jarvis from Iron man, and keep your responses short and concise.
"""

def build_messages(user_id: str, user_msg: str, context: str, memories_text: str):
    history = _get_history(user_id)
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"MEMORIES:\n{memories_text or '(none)'}"},
        {"role": "system", "content": f"CONTEXT:\n{context or '(no retrieval hits)'}"},
        *history,
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

# ----------------- In-memory session history -----------------
# NOTE: For production, replace with Redis or a DB-backed store.
SESSION_HISTORY: Dict[str, List[Dict[str, str]]] = {}

def _get_history(user_id: str) -> List[Dict[str, str]]:
    return SESSION_HISTORY.setdefault(user_id, [])

def _append_history(user_id: str, role: str, content: str, max_turns: int = 10) -> None:
    hist = _get_history(user_id)
    hist.append({"role": role, "content": content})
    # keep only last N turns
    if len(hist) > max_turns:
        del hist[:-max_turns]

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

        ref = os.getenv("GITHUB_REF") or os.getenv("GITHUB_BRANCH")
        use_github = all(os.getenv(k) for k in ("GITHUB_OWNER","GITHUB_REPO","GITHUB_TOKEN")) and bool(ref)
        index_exists = os.path.exists(INDEX_FAISS) and os.path.exists(DOCS_PKL)

        if not index_exists:
            if use_github:
                tmp = fetch_repo_snapshot()
                try:
                    ingest_from_dir(tmp)
                finally:
                    shutil.rmtree(tmp, ignore_errors=True)
            else:
                # Fallback: build from local vault directory if provided
                ingest_from_dir("./vault")

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
        ingest_from_dir(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # refresh retriever
    global _rag
    _rag = None
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
    branch = os.getenv("GITHUB_REF") or os.getenv("GITHUB_BRANCH") or "main"
    if event.get("ref", "").split("/")[-1] != branch:
        return {"status": "ignored", "reason": event.get("ref")}

    tmp = fetch_repo_snapshot()
    try:
        ingest_from_dir(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    global _rag
    _rag = None
    _ = get_retriever()

    return {"status": "ok", "mode": "zip_rebuild"}

# ----------------- Chat -----------------
@app.post("/chat", response_model=ChatOut)
def chat(payload: ChatIn, background_tasks: BackgroundTasks, _=Depends(require_api_key)):
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
    _append_history(payload.user_id, "user", payload.message)
    _append_history(payload.user_id, "assistant", reply)

    # Optional: store a quick memory
    if payload.make_note:
        # Ensure correct parameter order: content first, then type
        add_memory(payload.user_id, content=payload.make_note, mtype="note")

    if payload.save_fact:
        add_fact(payload.user_id, payload.save_fact)
    if payload.save_task:
        add_task(payload.user_id, payload.save_task)

    # Background memory extraction (feature-flagged)
    if os.getenv("AUTO_MEMORY", "true").lower() in ("1","true","yes"):
        background_tasks.add_task(extract_and_store_memories, payload.user_id, payload.message, reply, hits)

    return ChatOut(
        reply=reply,
        sources=[{"path": h["path"], "score": h["score"]} for h in hits],
        tools_used=[],
    )

# ----------------- Chat (streaming SSE) -----------------
@app.post("/chat/stream")
def chat_stream(payload: ChatIn, background_tasks: BackgroundTasks, _=Depends(require_api_key)):
    if not payload.message.strip():
        raise HTTPException(400, "message required")

    try:
        retriever = get_retriever()
        context, hits = retriever.build_context(payload.message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Retriever not ready: {e}. Run `python ingest.py`.") from e

    mems = recall_memories(payload.user_id, limit=6)
    memories_text = "\n".join(str(m) for m in (mems or []))
    messages = build_messages(payload.user_id, payload.message, context, memories_text)

    from llm_cerebras import cerebras_chat_stream

    def event_gen():
        buffer = []
        try:
            for chunk in cerebras_chat_stream(messages, temperature=0.3, max_tokens=800):
                if chunk:
                    buffer.append(chunk)
                    yield f"data: {chunk}\n\n"
        finally:
            full = "".join(buffer)
            _append_history(payload.user_id, "user", payload.message)
            _append_history(payload.user_id, "assistant", full)
            if os.getenv("AUTO_MEMORY", "true").lower() in ("1","true","yes"):
                try:
                    background_tasks.add_task(extract_and_store_memories, payload.user_id, payload.message, full, hits)
                except Exception:
                    pass
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream", background=background_tasks)

# ----------------- Tasks endpoints -----------------

class TaskIn(BaseModel):
    user_id: str
    content: str
    due_ts: Optional[int] = None

@app.post("/tasks", dependencies=[Depends(require_api_key)])
def create_task(payload: TaskIn):
    tid = add_task(payload.user_id, payload.content, payload.due_ts)
    return {"ok": True, "id": tid}

@app.get("/tasks", dependencies=[Depends(require_api_key)])
def get_tasks(user_id: str, status: Optional[str] = "open", limit: int = 100):
    return {"ok": True, "tasks": list_tasks(user_id, status=status, limit=limit)}

@app.post("/tasks/{task_id}/complete", dependencies=[Depends(require_api_key)])
def finish_task(task_id: int, user_id: str):
    ok = complete_task(user_id, task_id)
    return {"ok": ok}

# ----------------- Review queue endpoints -----------------

@app.get("/memories/pending", dependencies=[Depends(require_api_key)])
def get_pending(user_id: str, limit: int = 50):
    return {"ok": True, "items": list_pending_memories(user_id, limit=limit)}

class ReviewIn(BaseModel):
    user_id: str

@app.post("/memories/pending/{pid}/approve", dependencies=[Depends(require_api_key)])
def approve(pid: int, payload: ReviewIn):
    ok = approve_pending_memory(payload.user_id, pid)
    return {"ok": ok}

@app.post("/memories/pending/{pid}/reject", dependencies=[Depends(require_api_key)])
def reject(pid: int, payload: ReviewIn):
    ok = reject_pending_memory(payload.user_id, pid)
    return {"ok": ok}

# ----------------- Memories CRUD -----------------

@app.get("/memories", dependencies=[Depends(require_api_key)])
def memories_list(user_id: str, limit: int = 200, type: Optional[str] = None, contains: Optional[str] = None):
    return {"ok": True, "items": list_memories(user_id, limit=limit, mtype=type, contains=contains)}

class MemoryUpdateIn(BaseModel):
    user_id: str
    content: Optional[str] = None
    type: Optional[str] = None

@app.post("/memories/{mem_id}", dependencies=[Depends(require_api_key)])
def memories_update(mem_id: int, payload: MemoryUpdateIn):
    ok = update_memory(payload.user_id, mem_id, content=payload.content, mtype=payload.type)
    return {"ok": ok}

class MemoryDeleteIn(BaseModel):
    user_id: str

@app.post("/memories/{mem_id}/delete", dependencies=[Depends(require_api_key)])
def memories_delete(mem_id: int, payload: MemoryDeleteIn):
    ok = delete_memory(payload.user_id, mem_id)
    return {"ok": ok}

@app.post("/memories/delete_all", dependencies=[Depends(require_api_key)])
def memories_delete_all(payload: MemoryDeleteIn):
    n = delete_all_memories(payload.user_id)
    return {"ok": True, "deleted": n}

# Create memory (note/fact/etc.)
class MemoryCreateIn(BaseModel):
    user_id: str
    content: str
    type: Optional[str] = "note"

@app.post("/memories/create", dependencies=[Depends(require_api_key)])
def memories_create(payload: MemoryCreateIn):
    if not payload.content.strip():
        raise HTTPException(400, "content required")
    mid = add_memory(payload.user_id, payload.content, mtype=payload.type or "note")
    return {"ok": True, "id": mid}

# ----------------- URL summarizer -----------------

class SummarizeIn(BaseModel):
    url: str
    user_id: Optional[str] = None

@app.post("/summarize_url", dependencies=[Depends(require_api_key)])
def summarize_url(payload: SummarizeIn):
    try:
        r = requests.get(payload.url, timeout=20)
        r.raise_for_status()
    except Exception as e:
        raise HTTPException(400, f"Failed to fetch URL: {e}")

    html = r.text
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.string if soup.title else "").strip()
    # Remove scripts/styles
    for t in soup(["script","style","noscript"]):
        t.decompose()
    text = soup.get_text(" ")
    text = " ".join(text.split())
    text = text[:12000]  # cap

    prompt = [
        {"role": "system", "content": "Summarize the following webpage content in clear Markdown with headings and bullet points. Include key takeaways and any notable facts. Keep it concise. If content is too long, focus on the most relevant sections."},
        {"role": "user", "content": f"URL: {payload.url}\nTitle: {title}\n\nCONTENT:\n{text}"},
    ]
    summary = cerebras_chat(prompt)
    return {"ok": True, "title": title, "url": payload.url, "summary": summary}

# ----------------- Memories CRUD -----------------

@app.get("/memories", dependencies=[Depends(require_api_key)])
def memories_list(user_id: str, limit: int = 200, type: Optional[str] = None, contains: Optional[str] = None):
    return {"ok": True, "items": list_memories(user_id, limit=limit, mtype=type, contains=contains)}

class MemoryUpdateIn(BaseModel):
    user_id: str
    content: Optional[str] = None
    type: Optional[str] = None

@app.post("/memories/{mem_id}", dependencies=[Depends(require_api_key)])
def memories_update(mem_id: int, payload: MemoryUpdateIn):
    ok = update_memory(payload.user_id, mem_id, content=payload.content, mtype=payload.type)
    return {"ok": ok}

class MemoryDeleteIn(BaseModel):
    user_id: str

@app.post("/memories/{mem_id}/delete", dependencies=[Depends(require_api_key)])
def memories_delete(mem_id: int, payload: MemoryDeleteIn):
    ok = delete_memory(payload.user_id, mem_id)
    return {"ok": ok}

@app.post("/memories/delete_all", dependencies=[Depends(require_api_key)])
def memories_delete_all(payload: MemoryDeleteIn):
    n = delete_all_memories(payload.user_id)
    return {"ok": True, "deleted": n}