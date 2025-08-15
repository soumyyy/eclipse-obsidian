import sqlite3, os, time
from typing import List, Tuple

DB = "./data/memory.sqlite"
os.makedirs("./data", exist_ok=True)

def _init():
    with sqlite3.connect(DB) as con:
        con.execute("""CREATE TABLE IF NOT EXISTS memories(
            id INTEGER PRIMARY KEY,
            user_id TEXT,
            kind TEXT,          -- 'fact' | 'preference' | 'summary'
            content TEXT,
            weight REAL DEFAULT 1.0,
            created_at REAL
        )""")
_init()

def add_memory(user_id: str, kind: str, content: str, weight: float = 1.0):
    with sqlite3.connect(DB) as con:
        con.execute(
            "INSERT INTO memories(user_id, kind, content, weight, created_at) VALUES(?,?,?,?,?)",
            (user_id, kind, content, weight, time.time())
        )

def recall_memories(user_id: str, limit: int = 6) -> List[Tuple]:
    with sqlite3.connect(DB) as con:
        cur = con.execute(
            "SELECT kind, content FROM memories WHERE user_id=? ORDER BY weight DESC, created_at DESC LIMIT ?",
            (user_id, limit)
        )
        return cur.fetchall()