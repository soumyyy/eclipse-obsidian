# memory.py
import os, sqlite3, time
from typing import List, Tuple, Optional

DATA_DIR = "./data"
DB_PATH = os.path.join(DATA_DIR, "memory.sqlite")

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

# ---- convenience helpers for specific memory types ----

def add_fact(user_id: str, content: str) -> int:
    return add_memory(user_id, content, mtype="fact")

def add_summary(user_id: str, content: str) -> int:
    return add_memory(user_id, content, mtype="summary")

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