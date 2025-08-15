import os

EXCLUDE_DIRS = {".git", ".obsidian", "node_modules", ".venv", ".idea", ".vscode", "__pycache__"}
VALID_EXTS = {".md", ".MD", ".markdown", ".mdown", ".mdx"}  # include more variants

def iter_markdown_files(root: str):
    root = os.path.abspath(root)
    for dirpath, dirnames, filenames in os.walk(root):
        # prune excluded dirs in-place so os.walk doesn't descend into them
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith(".git")]
        for fname in filenames:
            _, ext = os.path.splitext(fname)
            if ext in VALID_EXTS:
                yield os.path.join(dirpath, fname)

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