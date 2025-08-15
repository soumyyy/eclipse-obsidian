import os, pickle, faiss, numpy as np
from embedder import Embeddings

DATA_DIR = "./data"
INDEX_PATH = os.path.join(DATA_DIR, "index.faiss")
DOCS_PATH = os.path.join(DATA_DIR, "docs.pkl")

class RAG:
    def __init__(self, top_k: int = 5):
        self.top_k = top_k
        self.emb = Embeddings()
        if not (os.path.exists(INDEX_PATH) and os.path.exists(DOCS_PATH)):
            raise RuntimeError("Index not found. Run `python ingest.py` first.")
        self.index = faiss.read_index(INDEX_PATH)
        with open(DOCS_PATH, "rb") as f:
            self.docs = pickle.load(f)

    def retrieve(self, query: str):
        q = self.emb.encode(query)
        D, I = self.index.search(np.array(q, dtype=np.float32), self.top_k)
        hits = []
        for idx, score in zip(I[0], D[0]):
            if idx == -1:
                continue
            meta = self.docs[idx]
            hits.append({"score": float(score), **meta})
        return hits

    def build_context(self, query: str):
        hits = self.retrieve(query)
        context = "\n\n".join(
            [
                f"[{i+1}] {h['chunk']}\n(Source: {os.path.relpath(h['path'])}, score={h['score']:.3f})"
                for i, h in enumerate(hits)
            ]
        )
        return context, hits