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