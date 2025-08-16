# rag.py
import os
import pickle
import numpy as np
import faiss

from sentence_transformers import SentenceTransformer  # embedding model

DATA_DIR = "./data"
INDEX_PATH = os.path.join(DATA_DIR, "index.faiss")
DOCS_PATH  = os.path.join(DATA_DIR, "docs.pkl")

# ---------- minimal FAISS-backed retriever ----------

class Retriever:
    def __init__(self, index, docs):
        self.index = index              # faiss.Index
        self.docs  = docs               # list[dict] with "text", "relpath", etc.

    def search(self, query_vec: np.ndarray, top_k=5):
        """query_vec: (d,) or (1,d) float32 vector (will be L2-normalized here)."""
        if query_vec.ndim == 1:
            query_vec = query_vec[None, :]
        faiss.normalize_L2(query_vec)
        D, I = self.index.search(query_vec.astype(np.float32), top_k)
        hits = []
        for rank, idx in enumerate(I[0]):
            if idx < 0:
                continue
            meta = self.docs[idx]
            hits.append({
                "rank": rank + 1,
                "score": float(D[0][rank]),
                "text": meta.get("text", ""),
                "path": meta.get("relpath") or meta.get("path"),
                "id": meta.get("id"),
            })
        return hits

# ---------- loader utilities ----------

def _load_index_and_docs(index_path=INDEX_PATH, docs_path=DOCS_PATH):
    if not (os.path.exists(index_path) and os.path.exists(docs_path)):
        raise RuntimeError(
            "FAISS index/docs not found. Run ingest first to create "
            f"{index_path} and {docs_path}"
        )
    index = faiss.read_index(index_path)
    with open(docs_path, "rb") as f:
        docs = pickle.load(f)
    return index, docs

# legacy: returns only the raw Retriever (no embedder). Kept for compatibility.
_retriever_singleton = None
def get_retriever():
    """Lazily load a single Retriever instance and reuse it."""
    global _retriever_singleton
    if _retriever_singleton is None:
        index, docs = _load_index_and_docs()
        _retriever_singleton = Retriever(index, docs)
    return _retriever_singleton

# ---------- embedder + factory that returns (retriever, embed_fn) ----------

def load_embedder(name: str = "sentence-transformers/all-MiniLM-L6-v2"):
    """
    Shared sentence-transformers embedder.
    """
    return SentenceTransformer(name)

def make_faiss_retriever(
    index_path: str = INDEX_PATH,
    docs_path: str  = DOCS_PATH,
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
):
    """
    Returns (retriever, embed_fn) suitable for constructing RAG(retriever, embed_fn).
    - retriever.build_context(q, k) will be used by RAG below.
    """
    model = load_embedder(model_name)
    index, docs = _load_index_and_docs(index_path, docs_path)
    store = Retriever(index, docs)

    # embed_fn that accepts str or list[str] and returns np.ndarray
    def embed_fn(x):
        if isinstance(x, str):
            texts = [x]
        else:
            texts = list(x)
        vecs = model.encode(texts, convert_to_numpy=True, normalize_embeddings=False)
        faiss.normalize_L2(vecs)
        return vecs.astype(np.float32)

    # tiny wrapper offering build_context the app expects
    class _CtxRetriever:
        def build_context(self, query: str, k: int = 5):
            qv = embed_fn(query)
            hits = store.search(qv[0], top_k=k)
            context = "\n\n".join(f"[{i+1}] {h['text']}" for i, h in enumerate(hits))
            return context, hits

    return _CtxRetriever(), embed_fn

# ---------- simple RAG wrapper ----------

class RAG:
    def __init__(self, retriever, embed_fn, top_k=5):
        """
        retriever: object with .build_context(query: str, k: int) -> (context, hits)
        embed_fn:  callable(str|list[str]) -> np.ndarray
        """
        self.retriever = retriever
        self.embed_fn = embed_fn
        self.top_k = top_k

    def retrieve(self, query: str):
        # returns only hits (list of {text, path, score, ...})
        context, hits = self.retriever.build_context(query, k=self.top_k)
        return hits

    def build_context(self, query: str):
        # returns (context_str, hits)
        return self.retriever.build_context(query, k=self.top_k)