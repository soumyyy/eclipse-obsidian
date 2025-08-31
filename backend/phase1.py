import time
from rag import make_faiss_retriever, RAG

# Build retriever + embedder via the factory, then construct RAG
retr, embed_fn = make_faiss_retriever()
r = RAG(retriever=retr, embed_fn=embed_fn, top_k=5)

QUERIES = [
  "Tell me about my health"
]

def run():
  for q in QUERIES:
    t0 = time.time()
    hits = r.retrieve(q, user_id="soumya")
    dt = (time.time() - t0) * 1000
    print(f"\nQ: {q}  ({dt:.1f} ms)")
    for i, h in enumerate(hits, 1):
      txt = (h.get("text") or "")[:120].replace("\n"," ")
      print(f"  {i:>2}. score={h.get('score'):.4f} id={h.get('id')} path={h.get('path')}  {txt}...")
if __name__ == "__main__":
  run()