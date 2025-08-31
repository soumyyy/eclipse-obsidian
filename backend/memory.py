# memory.py
import os, sqlite3, time, uuid
from pathlib import Path
from typing import List, Tuple, Optional

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = str(BASE_DIR / "data")
DB_PATH = str(BASE_DIR / "data" / "memory.sqlite")

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_user_ts ON memories(user_id, ts DESC);

-- Tasks table for reminders / todos
CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  due_ts     INTEGER,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_ts);

-- Entities & links (compounding memory)
CREATE TABLE IF NOT EXISTS entities (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  kind      TEXT NOT NULL, -- person|project|preference|organization|location
  name      TEXT NOT NULL,
  canonical TEXT,
  extra     TEXT
);
CREATE INDEX IF NOT EXISTS idx_entities_user_kind ON entities(user_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_user_canonical ON entities(user_id, canonical);

CREATE TABLE IF NOT EXISTS memory_entity (
  mem_id   INTEGER NOT NULL,
  ent_id   INTEGER NOT NULL,
  PRIMARY KEY(mem_id, ent_id)
);

-- Pending memories (review queue)
CREATE TABLE IF NOT EXISTS pending_memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  type       TEXT NOT NULL,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  confidence REAL,
  priority   INTEGER,
  due_ts     INTEGER,
  extra      TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_user_ts ON pending_memories(user_id, ts DESC);

-- Structured memory (Phase 1)
CREATE TABLE IF NOT EXISTS mem_item (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,            -- semantic | episode | task | note | other
  title      TEXT,
  body       TEXT,
  source     TEXT,
  tags       TEXT,                     -- comma-separated tags
  pinned     INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_item_user_kind ON mem_item(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_mem_item_user_updated ON mem_item(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS mem_signal (
  mem_id     TEXT PRIMARY KEY REFERENCES mem_item(id) ON DELETE CASCADE,
  last_seen  INTEGER,
  good_votes INTEGER DEFAULT 0,
  bad_votes  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_summary (
  session_id TEXT NOT NULL,
  turn_no    INTEGER NOT NULL,
  tokens     INTEGER NOT NULL,
  summary    TEXT NOT NULL,
  salient_facts_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, turn_no)
);
"""

def ensure_db(path: str = DB_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    try:
        cur = con.cursor()
        # executescript is idempotent for our schema
        cur.executescript(SCHEMA)
        con.commit()
    finally:
        con.close()

# ------------- Phase 1 helpers (structured memory) -------------

def _now_ts() -> int:
    return int(time.time())

def generate_mem_id() -> str:
    """Generate a new UUID v4 string for mem_item ids."""
    return str(uuid.uuid4())

def upsert_mem_item(user_id: str, item_id: str, kind: str, title: str | None, body: str | None, source: str | None, tags: str | None, pinned: int = 0) -> str:
    if not (user_id and item_id and kind):
        raise ValueError("user_id, item_id, kind are required")
    ts = _now_ts()
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("SELECT 1 FROM mem_item WHERE id=? AND user_id=?", (item_id, user_id))
        exists = cur.fetchone() is not None
        if exists:
            cur.execute(
                "UPDATE mem_item SET kind=?, title=?, body=?, source=?, tags=?, pinned=?, updated_at=? WHERE id=? AND user_id=?",
                (kind, title, body, source, tags, int(bool(pinned)), ts, item_id, user_id),
            )
        else:
            cur.execute(
                "INSERT INTO mem_item(id, user_id, kind, title, body, source, tags, pinned, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (item_id, user_id, kind, title, body, source, tags, int(bool(pinned)), ts, ts),
            )
        con.commit()
        return item_id
    finally:
        con.close()

def create_mem_item(user_id: str, kind: str, title: str | None = None, body: str | None = None, source: str | None = None, tags: str | None = None, pinned: int = 0, item_id: str | None = None) -> str:
    """Convenience helper: generate a UUID v4 id (unless provided) and upsert the mem_item.
    Returns the id used.
    """
    mid = item_id or generate_mem_id()
    return upsert_mem_item(user_id=user_id, item_id=mid, kind=kind, title=title, body=body, source=source, tags=tags, pinned=pinned)

def list_mem_items(user_id: str, kind: str | None = None, tags_like: str | None = None, updated_after: int | None = None, limit: int = 100):
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        sql = "SELECT id, kind, title, body, source, tags, pinned, created_at, updated_at FROM mem_item WHERE user_id=?"
        params = [user_id]
        if kind:
            sql += " AND kind=?"; params.append(kind)
        if tags_like:
            sql += " AND tags LIKE ?"; params.append(f"%{tags_like}%")
        if updated_after:
            sql += " AND updated_at>=?"; params.append(updated_after)
        sql += " ORDER BY updated_at DESC LIMIT ?"; params.append(limit)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        return [
            {
                "id": r[0], "kind": r[1], "title": r[2], "body": r[3], "source": r[4],
                "tags": r[5], "pinned": int(r[6]) == 1, "created_at": r[7], "updated_at": r[8]
            }
            for r in rows
        ]
    finally:
        con.close()

def upsert_signal(mem_id: str, last_seen: int | None = None, good_delta: int = 0, bad_delta: int = 0) -> None:
    last_seen = last_seen or _now_ts()
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("SELECT good_votes, bad_votes FROM mem_signal WHERE mem_id=?", (mem_id,))
        row = cur.fetchone()
        if row:
            new_good = int(row[0]) + int(good_delta)
            new_bad = int(row[1]) + int(bad_delta)
            cur.execute("UPDATE mem_signal SET last_seen=?, good_votes=?, bad_votes=? WHERE mem_id=?", (last_seen, new_good, new_bad, mem_id))
        else:
            cur.execute("INSERT INTO mem_signal(mem_id, last_seen, good_votes, bad_votes) VALUES(?,?,?,?)", (mem_id, last_seen, max(0, good_delta), max(0, bad_delta)))
        con.commit()
    finally:
        con.close()

def upsert_session_summary(session_id: str, turn_no: int, tokens: int, summary: str, salient_facts_hash: str | None = None) -> None:
    if not (session_id and isinstance(turn_no, int)):
        raise ValueError("session_id and turn_no required")
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT OR REPLACE INTO session_summary(session_id, turn_no, tokens, summary, salient_facts_hash, created_at) VALUES(?,?,?,?,?,?)",
            (session_id, turn_no, tokens, summary, salient_facts_hash, _now_ts()),
        )
        con.commit()
    finally:
        con.close()

def get_session_summaries(session_id: str, limit: int = 20):
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("SELECT turn_no, tokens, summary, salient_facts_hash, created_at FROM session_summary WHERE session_id=? ORDER BY turn_no DESC LIMIT ?", (session_id, limit))
        rows = cur.fetchall()
        return [
            {"turn_no": r[0], "tokens": r[1], "summary": r[2], "salient_facts_hash": r[3], "created_at": r[4]}
            for r in rows
        ]
    finally:
        con.close()

def add_memory(user_id: str, content: str, mtype: str = "note", ts: Optional[int] = None) -> int:
    """
    Insert a memory row and return its rowid.
    """
    if not user_id or not content:
        raise ValueError("user_id and content are required")
    ts = ts or int(time.time())
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO memories(user_id, ts, type, content) VALUES(?,?,?,?)",
            (user_id, ts, mtype, content),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()

def recall_memories(user_id: str, limit: int = 20, contains: Optional[str] = None) -> List[Tuple[int,int,str,str]]:
    """
    Return recent memories for a user.
    Each item: (id, ts, type, content)
    """
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        if contains:
            cur.execute(
                "SELECT id, ts, type, content FROM memories "
                "WHERE user_id=? AND content LIKE ? "
                "ORDER BY ts DESC LIMIT ?",
                (user_id, f"%{contains}%", limit),
            )
        else:
            cur.execute(
                "SELECT id, ts, type, content FROM memories "
                "WHERE user_id=? ORDER BY ts DESC LIMIT ?",
                (user_id, limit),
            )
        return cur.fetchall()
    finally:
        con.close()

def list_memories(user_id: str, limit: int = 100, mtype: Optional[str] = None, contains: Optional[str] = None):
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        base = "SELECT id, ts, type, content FROM memories WHERE user_id=?"
        params = [user_id]
        if mtype:
            base += " AND type=?"; params.append(mtype)
        if contains:
            base += " AND content LIKE ?"; params.append(f"%{contains}%")
        base += " ORDER BY ts DESC LIMIT ?"; params.append(limit)
        cur.execute(base, tuple(params))
        rows = cur.fetchall()
        return [{"id": r[0], "ts": r[1], "type": r[2], "content": r[3]} for r in rows]
    finally:
        con.close()

def update_memory(user_id: str, mem_id: int, content: Optional[str] = None, mtype: Optional[str] = None) -> bool:
    if not content and not mtype:
        return False
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("SELECT 1 FROM memories WHERE id=? AND user_id=?", (mem_id, user_id))
        if not cur.fetchone():
            return False
        if content and mtype:
            cur.execute("UPDATE memories SET content=?, type=? WHERE id=? AND user_id=?", (content, mtype, mem_id, user_id))
        elif content:
            cur.execute("UPDATE memories SET content=? WHERE id=? AND user_id=?", (content, mem_id, user_id))
        else:
            cur.execute("UPDATE memories SET type=? WHERE id=? AND user_id=?", (mtype, mem_id, user_id))
        con.commit()
        # Consider success even if values didn't change (rowcount may be 0)
        return True
    finally:
        con.close()

def delete_memory(user_id: str, mem_id: int) -> bool:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM memories WHERE id=? AND user_id=?", (mem_id, user_id))
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()

def delete_all_memories(user_id: str) -> int:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM memories WHERE user_id=?", (user_id,))
        con.commit()
        return cur.rowcount
    finally:
        con.close()

# ---- convenience helpers for specific memory types ----

def add_fact(user_id: str, content: str) -> int:
    return add_memory(user_id, content, mtype="fact")

def add_summary(user_id: str, content: str) -> int:
    return add_memory(user_id, content, mtype="summary")

# ---- simple memory search (LIKE) ----

def search_memories(user_id: str, query: str, limit: int = 20):
    """Return memory rows matching the query in content or type.
    Each item: {id, ts, type, content}
    """
    q = (query or "").strip()
    if not q:
        return []
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT id, ts, type, content FROM memories WHERE user_id=? AND (content LIKE ? OR type LIKE ?) ORDER BY ts DESC LIMIT ?",
            (user_id, f"%{q}%", f"%{q}%", limit),
        )
        rows = cur.fetchall()
        return [{"id": r[0], "ts": r[1], "type": r[2], "content": r[3]} for r in rows]
    finally:
        con.close()

# ---- tasks API ----

def add_task(user_id: str, content: str, due_ts: Optional[int] = None) -> int:
    if not user_id or not content:
        raise ValueError("user_id and content are required")
    created_ts = int(time.time())
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO tasks(user_id, created_ts, due_ts, content, status) VALUES(?,?,?,?,?)",
            (user_id, created_ts, due_ts, content, "open"),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()

def list_tasks(user_id: str, status: Optional[str] = "open", limit: int = 100):
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        if status:
            cur.execute(
                "SELECT id, content, due_ts, status, created_ts FROM tasks WHERE user_id=? AND status=? ORDER BY COALESCE(due_ts, 1e18), id DESC LIMIT ?",
                (user_id, status, limit),
            )
        else:
            cur.execute(
                "SELECT id, content, due_ts, status, created_ts FROM tasks WHERE user_id=? ORDER BY COALESCE(due_ts, 1e18), id DESC LIMIT ?",
                (user_id, limit),
            )
        rows = cur.fetchall()
        return [
            {"id": r[0], "content": r[1], "due_ts": r[2], "status": r[3], "created_ts": r[4]}
            for r in rows
        ]
    finally:
        con.close()

def complete_task(user_id: str, task_id: int) -> bool:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("UPDATE tasks SET status='done' WHERE user_id=? AND id=?", (user_id, task_id))
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()

def delete_task(user_id: str, task_id: int) -> bool:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM tasks WHERE user_id=? AND id=?", (user_id, task_id))
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()

# ---- entities API ----

def upsert_entity(user_id: str, kind: str, name: str, canonical: Optional[str] = None, extra: Optional[str] = None) -> int:
    canonical = (canonical or name or "").strip().lower()
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT id FROM entities WHERE user_id=? AND canonical=?",
            (user_id, canonical),
        )
        row = cur.fetchone()
        if row:
            return int(row[0])
        cur.execute(
            "INSERT INTO entities(user_id, kind, name, canonical, extra) VALUES(?,?,?,?,?)",
            (user_id, kind, name, canonical, extra),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()

def link_memory_to_entity(mem_id: int, ent_id: int) -> None:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT OR IGNORE INTO memory_entity(mem_id, ent_id) VALUES(?,?)",
            (mem_id, ent_id),
        )
        con.commit()
    finally:
        con.close()

# ---- pending memories (review queue) ----

def add_pending_memory(user_id: str, mtype: str, content: str, confidence: float | None = None, priority: int | None = None, due_ts: int | None = None, extra_json: str | None = None) -> int:
    ts = int(time.time())
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO pending_memories(user_id, ts, type, content, status, confidence, priority, due_ts, extra) VALUES(?,?,?,?,?,?,?,?,?)",
            (user_id, ts, mtype, content, "pending", confidence, priority, due_ts, extra_json),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()

def list_pending_memories(user_id: str, limit: int = 100):
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT id, ts, type, content, status, confidence, priority, due_ts, extra FROM pending_memories WHERE user_id=? AND status='pending' ORDER BY ts DESC LIMIT ?",
            (user_id, limit),
        )
        rows = cur.fetchall()
        return [
            {"id": r[0], "ts": r[1], "type": r[2], "content": r[3], "status": r[4], "confidence": r[5], "priority": r[6], "due_ts": r[7], "extra": r[8]}
            for r in rows
        ]
    finally:
        con.close()

def approve_pending_memory(user_id: str, pending_id: int) -> bool:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("SELECT type, content, confidence, priority, due_ts, extra FROM pending_memories WHERE id=? AND user_id=? AND status='pending'", (pending_id, user_id))
        row = cur.fetchone()
        if not row:
            return False
        mtype, content, confidence, priority, due_ts, extra = row
        # Insert into final stores
        if mtype == "task":
            add_task(user_id, content, due_ts=due_ts)
        else:
            mem_id = add_memory(user_id, content, mtype=mtype)
            # Link entities if provided in extra JSON
            if extra:
                try:
                    import json
                    data = json.loads(extra)
                    ents = data.get("entities") or []
                    for ent in ents:
                        kind = (ent.get("kind") or "").strip() or "entity"
                        name = ent.get("name") or ""
                        if not name:
                            continue
                        ent_id = upsert_entity(user_id, kind=kind, name=name)
                        link_memory_to_entity(mem_id, ent_id)
                except Exception:
                    pass
        cur.execute("UPDATE pending_memories SET status='approved' WHERE id=?", (pending_id,))
        con.commit()
        return True
    finally:
        con.close()

def reject_pending_memory(user_id: str, pending_id: int) -> bool:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("UPDATE pending_memories SET status='rejected' WHERE id=? AND user_id=? AND status='pending'", (pending_id, user_id))
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()