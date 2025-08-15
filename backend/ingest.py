import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import os, pickle, faiss, re
from tqdm import tqdm
from markdown import markdown
from bs4 import BeautifulSoup
from embedder import Embeddings
from utils import iter_markdown_files, chunk_text

VAULT = os.getenv("OBSIDIAN_VAULT", "./vault")
DATA_DIR = "./data"
INDEX_PATH = os.path.join(DATA_DIR, "index.faiss")
DOCS_PATH = os.path.join(DATA_DIR, "docs.pkl")

def md_to_text(md: str) -> str:
    # remove fenced code blocks; keep the rest
    md = re.sub(r"```.+?```", "", md, flags=re.S)
    html = markdown(md)
    return BeautifulSoup(html, "html.parser").get_text(separator="\n")

def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    emb = Embeddings()
    docs, texts = [], []
    doc_id = 0

    paths = list(iter_markdown_files(VAULT))
    if not paths:
        print(f"No .md files found in {VAULT}. Add notes and rerun.")
        return

    for path in tqdm(paths, desc="Scanning vault"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
        except Exception:
            continue
        text = md_to_text(raw)
        for chunk in chunk_text(text, chunk_size=900, chunk_overlap=150):
            docs.append({"id": doc_id, "path": path, "chunk": chunk})
            texts.append(chunk)
            doc_id += 1

    if not texts:
        print("No text found after parsing markdown.")
        return

    vecs = emb.encode(texts)
    dim = vecs.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(vecs)

    faiss.write_index(index, INDEX_PATH)
    with open(DOCS_PATH, "wb") as f:
        pickle.dump(docs, f)

    print(f"Ingested {len(docs)} chunks → {INDEX_PATH}, {DOCS_PATH}")

if __name__ == "__main__":
    main()