# backend/clients/github_fetch.py
import os, tempfile, zipfile, io, shutil, requests

OWNER = os.getenv("GITHUB_OWNER")
REPO  = os.getenv("GITHUB_REPO")
REF   = os.getenv("GITHUB_REF") or os.getenv("GITHUB_BRANCH") or "main"
TOKEN = os.getenv("GITHUB_TOKEN")

def fetch_repo_snapshot() -> str:
    """
    Download <owner>/<repo>@<ref> as a ZIP into a temp dir and return the extracted folder path.
    Caller must remove it when done.
    """
    if not (OWNER and REPO and REF and TOKEN):
        raise RuntimeError("Set GITHUB_OWNER, GITHUB_REPO, GITHUB_REF (or GITHUB_BRANCH), and GITHUB_TOKEN in .env")
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/zipball/{REF}"
    headers = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"}
    r = requests.get(url, headers=headers, timeout=120)
    r.raise_for_status()

    tmp_root = tempfile.mkdtemp(prefix="vaultzip_")
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        z.extractall(tmp_root)

    # GitHub zips contain one top-level dir with a hash in the name
    subdirs = [os.path.join(tmp_root, d) for d in os.listdir(tmp_root)
               if os.path.isdir(os.path.join(tmp_root, d))]
    if not subdirs:
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise RuntimeError("ZIP extraction produced no directory")
    return subdirs[0]


