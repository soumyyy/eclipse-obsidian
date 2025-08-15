# backend/ingest.py
import os
import re
import pickle
from collections import Counter
from typing import List

import faiss
from tqdm import tqdm
from markdown import markdown
from bs4 import BeautifulSoup

from embedder import Embeddings

# -------------------- Config --------------------
VAULT = os.getenv("OBSIDIAN_VAULT", "./vault")
DATA_DIR = "./data"
INDEX_PATH = os.path.join(DATA_DIR, "index.faiss")
DOCS_PATH = os.path.join(DATA_DIR, "docs.pkl")

# Directories to skip during traversal
EXCLUDE_DIRS = {
    ".git", ".obsidian", "node_modules", ".venv", ".idea", ".vscode", "__pycache__",
}

# File extensions to include
VALID_EXTS = {".md", ".MD", ".markdown", ".mdown", ".mdx"}

# -------------------- Helpers --------------------
def iter_markdown_files(root: str):
    """Yield absolute file paths for all markdown-like files under root, excluding junk dirs."""
    root = os.path.abspath(root)
    for dirpath, dirnames, filenames in os.walk(root):
        # prune excluded dirs in-place so os.walk doesn't descend into them
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith(".git")]
        for fname in filenames:
            _, ext = os.path.splitext(fname)
            if ext in VALID_EXTS:
                yield os.path.join(dirpath, fname)

def chunk_text(text: str, chunk_size=900, chunk_overlap=150) -> List[str]:
    words = text.split()
    if not words:
        return []
    chunks, start = [], 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start = max(0, end - chunk_overlap)
    return chunks

def md_to_text(md: str) -> str:
    """Convert Markdown → plain text, stripping fenced code blocks to avoid noisy chunks."""
    # remove fenced code blocks ```...```
    md = re.sub(r"```.+?```", "", md, flags=re.S)
    # convert to HTML then strip tags
    html = markdown(md)
    return BeautifulSoup(html, "html.parser").get_text(separator="\n")

# -------------------- Build index --------------------
def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    paths = list(iter_markdown_files(VAULT))
    print(f"Found {len(paths)} markdown files under {os.path.abspath(VAULT)}")
    for p in sorted(paths)[:25]:
        print(" -", os.path.relpath(p))
    if len(paths) > 25:
        print(f" ... and {len(paths)-25} more")

    if not paths:
        print(f"No markdown files found. Add notes to {VAULT} and rerun.")
        return

    emb = Embeddings()
    docs = []
    texts = []
    per_file = Counter()
    doc_id = 0

    for path in tqdm(paths, desc="Scanning vault"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
        except Exception:
            continue
        text = md_to_text(raw)
        chunks = chunk_text(text, chunk_size=900, chunk_overlap=150)
        if not chunks:
            continue
        for ch in chunks:
            docs.append({"id": doc_id, "path": path, "chunk": ch})
            texts.append(ch)
            doc_id += 1
        per_file[os.path.relpath(path)] += len(chunks)

    if not texts:
        print("No text extracted after parsing markdown. Nothing to index.")
        return

    print("Per-file chunk counts (top 30):")
    for f, n in per_file.most_common(30):
        print(f"  {n:4d}  {f}")
    print(f"Created {len(docs)} chunks total")

    vecs = emb.encode(texts)
    dim = vecs.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(vecs)

    faiss.write_index(index, INDEX_PATH)
    with open(DOCS_PATH, "wb") as f:
        pickle.dump(docs, f)

    print(f"Ingested {len(docs)} chunks → {INDEX_PATH}, {DOCS_PATH}")

# -------------------- Webhook helpers --------------------
def rebuild_all():
    """Full rebuild used by webhook or first boot."""
    main()

def incremental_update(added_or_modified: List[str], deleted: List[str]):
    """
    Simple incremental policy:
      - If deletions exist OR large change set → full rebuild (IndexFlatIP doesn't delete).
      - Else append new chunks for changed files.
    Paths in added_or_modified/deleted should be absolute paths inside the repo checkout.
    """
    # Fallbacks / safety
    if deleted or len(added_or_modified) > 200:
        print("Large change set or deletions detected → full rebuild.")
        return rebuild_all()

    if not os.path.exists(INDEX_PATH) or not os.path.exists(DOCS_PATH):
        print("No existing index/docs — running full rebuild.")
        return rebuild_all()

    # Load current index & docs
    index = faiss.read_index(INDEX_PATH)
    with open(DOCS_PATH, "rb") as f:
        docs = pickle.load(f)

    emb = Embeddings()

    new_texts, new_docs = [], []
    doc_id = len(docs)

    for path in added_or_modified:
        if not os.path.isfile(path):
            continue
        _, ext = os.path.splitext(path)
        if ext not in VALID_EXTS:
            continue
        try:
            raw = open(path, "r", encoding="utf-8").read()
        except Exception:
            continue
        text = md_to_text(raw)
        chunks = chunk_text(text, chunk_size=900, chunk_overlap=150)
        for ch in chunks:
            new_docs.append({"id": doc_id, "path": path, "chunk": ch})
            new_texts.append(ch)
            doc_id += 1

    if not new_texts:
        print("No incremental chunks to add.")
        return

    vecs = emb.encode(new_texts)
    index.add(vecs)

    faiss.write_index(index, INDEX_PATH)
    with open(DOCS_PATH, "wb") as f:
        pickle.dump(docs + new_docs, f)

    print(f"Incremental: +{len(new_docs)} chunks appended.")

# -------------------- CLI --------------------
if __name__ == "__main__":
    main()