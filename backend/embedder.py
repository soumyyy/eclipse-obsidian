import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"  # avoid tokenizer fork issues

import torch
from sentence_transformers import SentenceTransformer

class Embeddings:
    def __init__(self, model_name: str = "thenlper/gte-small"):
        # reduce thread contention that can trigger segfaults on macOS
        try:
            torch.set_num_threads(1)
        except Exception:
            pass

        # prefer MPS if available, else CPU (both are fine for embeddings)
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model = SentenceTransformer(model_name, device=device)

    def encode(self, texts):
        if isinstance(texts, str):
            texts = [texts]
        return self.model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=32,          # slightly lower batch size is safer on M-series
        )