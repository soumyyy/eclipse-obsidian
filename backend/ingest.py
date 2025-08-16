# ingest.py
# Always fetches the Obsidian vault from GitHub (ZIP snapshot) and (re)builds FAISS.
# Requires env: GITHUB_OWNER, GITHUB_REPO, GITHUB_REF, GITHUB_TOKEN
import os
import re
import gc
import sys
import sqlite3
import shutil
import pickle
import argparse
from typing import List, Dict, Iterable, Tuple

# Keep RAM + threads low on small boxes
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("FAISS_NUM_THREADS", "1")

from tqdm import tqdm
from bs4 import BeautifulSoup
from sentence_transformers import SentenceTransformer
import numpy as np
import faiss

from github_fetch import fetch_repo_snapshot  # <- we rely on this

DATA_DIR = "./data"
INDEX_PATH = os.path.join(DATA_DIR, "index.faiss")
DOCS_PATH = os.path.join(DATA_DIR, "docs.pkl")
SQLITE_PATH = os.path.join(DATA_DIR, "docs.sqlite")

# ---------- text utils ----------

FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)
WIKI_LINK_RE   = re.compile(r"\[\[([^\]|]+)(\|[^\]]+)?\]\]")
MD_LINK_RE     = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
CODEBLOCK_RE   = re.compile(r"```.*?```", re.DOTALL)

def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def clean_markdown(md: str) -> str:
    # drop frontmatter & code blocks (often noisy for embeddings)
    md = FRONTMATTER_RE.sub("", md)
    md = CODEBLOCK_RE.sub("", md)
    # convert wiki links to just the display text or target
    md = WIKI_LINK_RE.sub(lambda m: m.group(1), md)
    # strip any inline HTML without requiring lxml
    try:
        md = BeautifulSoup(md, "html.parser").get_text()
    except Exception:
        md = re.sub(r"<[^>]+>", " ", md)
    # collapse links to their label
    md = MD_LINK_RE.sub(lambda m: m.group(1), md)
    # normalize whitespace
    md = re.sub(r"[ \t]+", " ", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()

def iter_markdown_files(root: str, include_ext=(".md",)) -> Iterable[str]:
    for dirpath, _, filenames in os.walk(root):
        # skip hidden dirs like .git, .obsidian
        parts = os.path.relpath(dirpath, root).split(os.sep)
        if any(p.startswith(".") for p in parts if p != "."):
            continue
        for fn in filenames:
            if fn.lower().endswith(include_ext):
                yield os.path.join(dirpath, fn)

# ---------- smarter chunking (sentence-aware) ----------
# You can tweak target_size/overlap via CLI if you like.

def smart_chunk(text: str, target_size=800, overlap=100, min_chunk=50) -> List[str]:
    """
    Smarter chunking that respects sentence boundaries and paragraphs.
    - target_size: approx characters per chunk
    - overlap: approx characters of overlap (derived from trailing sentences)
    """
    text = text.strip()
    if not text or len(text) <= target_size:
        return [text] if text and len(text) > min_chunk else []

    # Split into sentences using a robust regex
    sentence_pattern = r'(?<=[.!?])\s+'
    sentences = re.split(sentence_pattern, text)
    if not sentences:
        return []

    chunks: List[str] = []
    current = ""

    for sent in sentences:
        s = sent.strip()
        if not s:
            continue

        if current and len(current) + 1 + len(s) > target_size:
            if len(current) > min_chunk:
                chunks.append(current.strip())

            # build an overlap from trailing sentences of current
            overlap_text = ""
            tail_sents = re.split(r'(?<=[.!?])\s+', current)
            for t in reversed(tail_sents[-3:]):
                candidate = (t + " " + overlap_text).strip()
                if len(candidate) <= overlap:
                    overlap_text = candidate
                else:
                    break
            current = (overlap_text + " " + s).strip() if overlap_text else s
        else:
            current = (current + " " + s).strip() if current else s

    if current and len(current) > min_chunk:
        chunks.append(current.strip())

    return chunks

# ---------- embedding / index ----------

def load_embedder(model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> SentenceTransformer:
    return SentenceTransformer(model_name)

def embed_texts(texts: List[str], model: SentenceTransformer, batch_size=64) -> np.ndarray:
    embs = []
    for i in tqdm(range(0, len(texts), batch_size), desc="Embedding"):
        batch = texts[i:i+batch_size]
        vecs = model.encode(
            batch,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=False,  # we normalize below for cosine/IP
        )
        embs.append(vecs.astype(np.float32))
    return np.vstack(embs) if embs else np.zeros((0, 384), dtype=np.float32)

def build_faiss_index(embs: np.ndarray) -> faiss.Index:
    # cosine similarity via inner product on normalized vectors
    faiss.normalize_L2(embs)
    index = faiss.IndexFlatIP(embs.shape[1])
    index.add(embs)
    return index

# ---------- persistence ----------

def save_pickle(records: List[Dict]):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DOCS_PATH, "wb") as f:
        pickle.dump(records, f)

def save_sqlite(records: List[Dict]):
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                relpath TEXT,
                chunk_id INTEGER,
                text TEXT
            )
        """)
        cur.execute("DELETE FROM chunks")  # rebuild fully
        cur.executemany(
            "INSERT INTO chunks (id, relpath, chunk_id, text) VALUES (?, ?, ?, ?)",
            [(r["id"], r["relpath"], r["chunk_id"], r["text"]) for r in records]
        )
        conn.commit()
    finally:
        conn.close()

def save_artifacts(index: faiss.Index, records: List[Dict]):
    os.makedirs(DATA_DIR, exist_ok=True)
    faiss.write_index(index, INDEX_PATH)
    save_pickle(records)
    save_sqlite(records)
    print(f"Ingested {len(records)} chunks →")
    print(f"  - {INDEX_PATH}")
    print(f"  - {DOCS_PATH}")
    print(f"  - {SQLITE_PATH}")

# ---------- ingest pipeline (always GitHub) ----------

def scan_and_chunk(root: str, target_size=800, overlap=100) -> Tuple[List[Dict], List[str]]:
    """
    Returns (records, raw_chunks)
    record = {id, path, relpath, chunk_id, text}
    """
    records: List[Dict] = []
    texts: List[str] = []
    count = 0
    files = list(iter_markdown_files(root))
    if not files:
        print("No markdown files found in snapshot.")
        return [], []

    print(f"Found {len(files)} markdown files under {root}")
    for p in files[:25]:
        print(" -", os.path.relpath(p, root))

    for path in tqdm(files, desc="Scanning vault"):
        rel = os.path.relpath(path, root)
        try:
            raw = read_text(path)
            cleaned = clean_markdown(raw)
            chunks = smart_chunk(cleaned, target_size=target_size, overlap=overlap)
            for ci, ch in enumerate(chunks):
                rid = f"{rel}::chunk{ci}"
                records.append({
                    "id": rid,
                    "path": path,
                    "relpath": rel,
                    "chunk_id": ci,
                    "text": ch
                })
                texts.append(ch)
            count += len(chunks)
        except Exception as e:
            print(f"[warn] failed {rel}: {e}")
    print(f"Created {count} chunks total")
    return records, texts

def main():
    parser = argparse.ArgumentParser(
        description="Build FAISS index from GitHub repo snapshot (never from local vault)."
    )
    parser.add_argument("--model", default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--target", type=int, default=800, help="Target chunk size in characters")
    parser.add_argument("--overlap", type=int, default=100, help="Approx overlap in characters")
    parser.add_argument("--force", action="store_true", help="Ignore existing ./data artifacts and rebuild.")
    args = parser.parse_args()

    # Ensure GitHub env is present — we *require* repo-based ingest
    missing = [k for k in ("GITHUB_OWNER","GITHUB_REPO","GITHUB_REF","GITHUB_TOKEN") if not os.getenv(k)]
    if missing:
        sys.exit(f"Missing env vars: {', '.join(missing)}")

    if (os.path.exists(INDEX_PATH) and os.path.exists(DOCS_PATH) and os.path.exists(SQLITE_PATH)
        and not args.force):
        print(f"Artifacts already exist at {DATA_DIR}. Use --force to rebuild.")
        return

    snapshot = fetch_repo_snapshot()  # creates a temp dir with repo contents
    try:
        # Walk, clean, chunk
        records, texts = scan_and_chunk(snapshot, target_size=args.target, overlap=args.overlap)
        if not records:
            print("Nothing to index.")
            return

        # Embed
        model = load_embedder(args.model)
        embs = embed_texts(texts, model, batch_size=args.batch)

        # Build FAISS
        index = build_faiss_index(embs)

        # Save
        save_artifacts(index, records)
    finally:
        shutil.rmtree(snapshot, ignore_errors=True)
        del snapshot
        gc.collect()

if __name__ == "__main__":
    main()