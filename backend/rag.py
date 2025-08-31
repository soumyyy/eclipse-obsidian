# rag.py
import os
import time
from pathlib import Path
import pickle
import sqlite3
import numpy as np
import faiss
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder

from sentence_transformers import SentenceTransformer  # embedding model

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = str(BASE_DIR / "data")
INDEX_PATH = str(BASE_DIR / "data" / "index.faiss")
DOCS_PATH  = str(BASE_DIR / "data" / "docs.pkl")

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
        self._sqlite_path = os.path.join(DATA_DIR, "docs.sqlite")
        self._mem_db_path = os.path.join(DATA_DIR, "memory.sqlite")
        # Default structured filter
        self._default_kinds = ("semantic", "note")
        self._recency_days = 180
        self._include_pinned = True
        # Load docs for BM25 (tokens) lazily
        self._bm25 = None
        self._bm25_ids = None
        self._doc_text_map = None
        self._reranker = None

    def _ensure_bm25(self):
        if self._bm25 is not None:
            return
        # Build BM25 from docs.pkl
        try:
            with open(DOCS_PATH, "rb") as f:
                docs = pickle.load(f)
            corpus = [ (d.get("id"), (d.get("text") or "")) for d in docs ]
            tokenized = [ (doc_id, (text.split())) for doc_id, text in corpus ]
            self._bm25_ids = [doc_id for doc_id, _ in tokenized]
            self._bm25 = BM25Okapi([tokens for _, tokens in tokenized])
            # build id -> text map for quick lookup
            self._doc_text_map = {doc_id: text for doc_id, text in corpus}
        except Exception:
            self._bm25 = None
            self._bm25_ids = None
            self._doc_text_map = None

    def _ensure_reranker(self):
        if self._reranker is not None:
            return
        try:
            model_name = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-base")
            self._reranker = CrossEncoder(model_name)
        except Exception:
            self._reranker = None

    def retrieve(self, query: str, user_id: str | None = None):
        # returns only hits (list of {text, path, score, ...})
        # Hybrid: light BM25 via SQLite FTS + dense search; then re-rank by combined score
        dense_context, dense_hits = self.retriever.build_context(query, k=self.top_k * 6)
        allowed_ids: set[str] | None = None
        if user_id:
            try:
                cutoff = int(time.time()) - self._recency_days * 86400
                con = sqlite3.connect(self._mem_db_path)
                cur = con.cursor()
                q = (
                    "SELECT id FROM mem_item WHERE user_id=? AND ("
                    " kind IN (?,?) OR pinned=1) AND (pinned=1 OR updated_at>=?)"
                )
                cur.execute(q, (user_id, self._default_kinds[0], self._default_kinds[1], cutoff))
                rows = cur.fetchall()
                allowed_ids = {r[0] for r in rows}
                con.close()
            except Exception:
                allowed_ids = None
        keyword_hits = []
        try:
            if os.path.exists(self._sqlite_path):
                con = sqlite3.connect(self._sqlite_path)
                cur = con.cursor()
                cur.execute("SELECT id, relpath, text FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?", (query, self.top_k * 12))
                raw_rows = cur.fetchall()
                keyword_hits = []
                for (rid, rel, txt) in raw_rows:
                    if allowed_ids is not None and rid not in allowed_ids:
                        continue
                    keyword_hits.append({"id": rid, "path": rel, "text": txt, "score": 0.0})
                con.close()
        except Exception:
            keyword_hits = []

        # BM25 (Okapi) over in-memory tokens as a robust lexical fallback
        try:
            self._ensure_bm25()
            if self._bm25 is not None:
                scores = self._bm25.get_scores(query.split())
                # Take top N by score
                topN = min(len(scores), self.top_k * 12)
                idxs = np.argsort(-scores)[:topN]
                for rank, i in enumerate(idxs.tolist(), start=1):
                    rid = self._bm25_ids[i]
                    if allowed_ids is not None and rid not in allowed_ids:
                        continue
                    # Find text for this id from docs.pkl quickly (approx; fallback to empty)
                    txt = (self._doc_text_map.get(rid) if self._doc_text_map else "")
                    keyword_hits.append({"id": rid, "path": None, "text": txt, "score": float(scores[i])})
        except Exception:
            pass

        # Reciprocal Rank Fusion (RRF) for robust hybrid ranking
        # rrf_score = sum(1 / (k + rank)) across lists; k ~ 60 common
        k_rrf = 60.0
        rrf: dict[str, dict] = {}

        for rank, h in enumerate(dense_hits, start=1):
            if allowed_ids is not None and h.get("id") not in allowed_ids:
                continue
            key = h.get("id") or h.get("path")
            if not key:
                key = f"dense::{rank}"
            prev = rrf.get(key) or {**h, "score": 0.0}
            prev["score"] = float(prev.get("score", 0.0)) + 1.0 / (k_rrf + rank)
            rrf[key] = prev

        for rank, h in enumerate(keyword_hits, start=1):
            key = h.get("id") or h.get("path")
            if not key:
                key = f"kw::{rank}"
            prev = rrf.get(key) or {**h, "score": 0.0}
            prev["score"] = float(prev.get("score", 0.0)) + 1.0 / (k_rrf + rank)
            # keep the longest text if merging
            if "text" in h and len(h.get("text") or "") > len(prev.get("text") or ""):
                prev["text"] = h.get("text")
            if "path" in h and h.get("path"):
                prev["path"] = h.get("path")
            rrf[key] = prev

        merged = list(rrf.values())
        merged.sort(key=lambda x: x.get("score", 0.0), reverse=True)
        # Filter out very low relevance results
        filtered = [h for h in merged if h.get("score", 0.0) > 0.01]

        # Cross-encoder rerank on top candidates for better precision
        try:
            self._ensure_reranker()
            # Skip reranker for very short queries to reduce latency
            short = len((query or "").split()) <= 3
            if self._reranker is not None and filtered and not short:
                topN = min(len(filtered), self.top_k * 12)
                cand = filtered[:topN]
                pairs = [(query, h.get("text") or "") for h in cand]
                ce_scores = self._reranker.predict(pairs).tolist()
                for h, s in zip(cand, ce_scores):
                    h["ce_score"] = float(s)
                # stable sort: ce_score desc, then path/id tie-breakers
                cand.sort(key=lambda x: (-x.get("ce_score", 0.0), (x.get("path") or ""), (x.get("id") or "")))
                return cand[: self.top_k]
        except Exception:
            pass

        return filtered[: self.top_k]

    def build_context(self, query: str, user_id: str | None = None):
        # returns (context_str, hits) using hybrid retrieval
        hits = self.retrieve(query, user_id=user_id)
        context = "\n\n".join(f"[{i+1}] {h['text']}" for i, h in enumerate(hits))
        return context, hits