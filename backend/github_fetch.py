import os, tempfile, zipfile, io, shutil, requests

OWNER = os.getenv("GITHUB_OWNER")
REPO = os.getenv("GITHUB_REPO")
REF = os.getenv("GITHUB_REF", "main")
TOKEN = os.getenv("GITHUB_TOKEN")  # fine-grained PAT (read-only)

def fetch_repo_snapshot() -> str:
    """
    Download <owner>/<repo>@<ref> as a ZIP to a temp dir and return the extracted path.
    Caller is responsible for deleting the returned directory when done.
    """
    if not (OWNER and REPO and REF and TOKEN):
        raise RuntimeError("Set GITHUB_OWNER, GITHUB_REPO, GITHUB_REF, GITHUB_TOKEN in .env")

    url = f"https://api.github.com/repos/{OWNER}/{REPO}/zipball/{REF}"
    headers = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"}
    r = requests.get(url, headers=headers, timeout=60)
    r.raise_for_status()

    tmp_root = tempfile.mkdtemp(prefix="vaultzip_")
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        z.extractall(tmp_root)

    # GitHub zips create a single top-level folder with unknown hash in name
    # find it and return full path
    entries = [os.path.join(tmp_root, d) for d in os.listdir(tmp_root)]
    subdirs = [p for p in entries if os.path.isdir(p)]
    if not subdirs:
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise RuntimeError("ZIP extraction produced no directory")
    return subdirs[0]  # path to extracted repo at REF