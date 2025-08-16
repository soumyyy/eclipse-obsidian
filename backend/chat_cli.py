#!/usr/bin/env python3
import os, sys, json, readline, requests

BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000")
API_KEY = os.environ.get("BACKEND_TOKEN", "")
USER_ID = os.environ.get("USER_ID", "soumya")

if not API_KEY:
    print("Set BACKEND_TOKEN in your env (export BACKEND_TOKEN=...)")
    sys.exit(1)

headers = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
}

history = []

def ask(msg: str):
    payload = {
        "user_id": USER_ID,
        "message": msg,
        "use_web": False,       # toggle if you built web search
        "top_k": 6,
    }
    r = requests.post(f"{BACKEND_URL}/chat", headers=headers, data=json.dumps(payload), timeout=120)
    r.raise_for_status()
    data = r.json()
    return data.get("reply") or data

print(f"Connected to {BACKEND_URL} as {USER_ID}. Type /exit to quit, /clear to reset.\n")

while True:
    try:
        msg = input("you> ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        break
    if not msg: 
        continue
    if msg.lower() in ("/exit", "/quit"):
        break
    if msg.lower() == "/clear":
        history.clear()
        os.system("clear" if os.name != "nt" else "cls")
        continue
    try:
        reply = ask(msg)
    except Exception as e:
        print(f"[error] {e}")
        continue
    print(f"assistant> {reply}\n")