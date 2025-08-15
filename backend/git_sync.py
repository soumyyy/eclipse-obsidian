# backend/git_sync.py
import os, subprocess, json, time, pathlib

REPO_DIR = "./vault_repo"   # actual git checkout
VAULT_DIR = "./vault"       # app reads from here (symlink to REPO_DIR)
STATE_PATH = "./data/git_state.json"

def _run(cmd, env=None):
    return subprocess.check_output(
        cmd, shell=True, env=env or os.environ, stderr=subprocess.STDOUT
    ).decode()

def _load_state():
    if not os.path.exists(STATE_PATH): return {}
    return json.load(open(STATE_PATH, "r"))

def _save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    json.dump(state, open(STATE_PATH, "w"), indent=2)

def ensure_clone():
    os.makedirs("./data", exist_ok=True)
    url = os.getenv("GIT_URL")
    if not url:
        return False
    if not os.path.exists(REPO_DIR):
        if url.startswith("git@"):
            key = os.getenv("GIT_SSH_KEY", "~/.ssh/id_ed25519")
            key = os.path.expanduser(key)
            env = os.environ.copy()
            env["GIT_SSH_COMMAND"] = f"ssh -i {key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
            _run(f"git clone {url} {REPO_DIR}", env=env)
        else:
            pat = os.getenv("GIT_PAT")
            if pat and "https://" in url:
                url = url.replace("https://", f"https://{pat}@")
            _run(f"git clone {url} {REPO_DIR}")
    # (re)create symlink vault -> repo
    if os.path.islink(VAULT_DIR) or os.path.exists(VAULT_DIR):
        try:
            if os.path.islink(VAULT_DIR): os.unlink(VAULT_DIR)
        except Exception:
            pass
    pathlib.Path(VAULT_DIR).symlink_to(pathlib.Path(REPO_DIR).resolve(), target_is_directory=True)
    return True

def pull_and_changes():
    ok = ensure_clone()
    if not ok and not os.path.exists(REPO_DIR):
        return {"added_or_modified": [], "deleted": []}, None
    branch = os.getenv("GIT_BRANCH", "main")
    state = _load_state()
    last = state.get("last_commit")

    # env for SSH if needed
    if os.getenv("GIT_URL", "").startswith("git@"):
        key = os.getenv("GIT_SSH_KEY", "~/.ssh/id_ed25519")
        key = os.path.expanduser(key)
        env = os.environ.copy()
        env["GIT_SSH_COMMAND"] = f"ssh -i {key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
    else:
        env = None

    _run(f"git -C {REPO_DIR} fetch --all", env=env)
    _run(f"git -C {REPO_DIR} checkout {branch}", env=env)
    _run(f"git -C {REPO_DIR} reset --hard origin/{branch}", env=env)

    head = _run(f"git -C {REPO_DIR} rev-parse HEAD").strip()
    changed = {"added_or_modified": [], "deleted": []}

    if last:
        diff = _run(f"git -C {REPO_DIR} diff --name-status {last} {head}").splitlines()
        for line in diff:
            parts = line.split("\t")
            status = parts[0]
            if status.startswith("R"):   # rename: R100\told\tnew
                path = parts[-1]
            else:
                path = parts[1] if len(parts) > 1 else ""
            if not path.lower().endswith(".md"):
                continue
            abspath = os.path.join(REPO_DIR, path)
            if status in ("A","M") or status.startswith("R"):
                changed["added_or_modified"].append(abspath)
            elif status == "D":
                changed["deleted"].append(abspath)
    else:
        for root, _, files in os.walk(REPO_DIR):
            for f in files:
                if f.lower().endswith(".md"):
                    changed["added_or_modified"].append(os.path.join(root, f))

    state["last_commit"] = head
    state["last_sync_ts"] = int(time.time())
    _save_state(state)
    return changed, head