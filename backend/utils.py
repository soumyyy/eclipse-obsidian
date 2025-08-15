import os, glob

def iter_markdown_files(root: str):
    for path in glob.glob(os.path.join(root, "**", "*.md"), recursive=True):
        yield path

def chunk_text(text: str, chunk_size=900, chunk_overlap=150):
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