import os, requests, datetime as dt

VAULT = os.getenv("OBSIDIAN_VAULT", "./vault")

def web_search_ddg(q: str, max_results: int = 5):
    url = "https://duckduckgo.com/?q={}&format=json&no_html=1&no_redirect=1".format(
        requests.utils.quote(q)
    )
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    data = r.json()
    results = []
    if "RelatedTopics" in data:
        for t in data["RelatedTopics"][:max_results]:
            if isinstance(t, dict) and t.get("Text"):
                results.append({"title": t.get("Text"), "url": t.get("FirstURL")})
    return results

def create_note(title: str, body: str):
    os.makedirs(VAULT, exist_ok=True)
    safe = "".join(c for c in title if c.isalnum() or c in (" ","-","_")).rstrip()
    path = os.path.join(VAULT, f"{safe}.md")
    ts = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"# {title}\n\n{body}\n\n---\nCreated: {ts}\n")
    return path