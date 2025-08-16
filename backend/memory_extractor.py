import json
import hashlib
from typing import List, Dict, Any, Optional

from llm_cerebras import cerebras_chat_with_model
from memory import add_memory, recall_memories, add_task, upsert_entity, link_memory_to_entity, add_pending_memory
from date_utils import parse_due_text_to_ts


def _normalize_type(t: str) -> str:
    t = (t or "").strip().lower()
    mapping = {
        "facts": "fact",
        "preference": "preference",
        "preferences": "preference",
        "todo": "task",
        "todos": "task",
        "reminder": "task",
        "reminders": "task",
        "summary": "summary",
        "summaries": "summary",
        "contact": "contact",
        "contacts": "contact",
        "link": "link",
        "links": "link",
    }
    return mapping.get(t, t)


def _build_prompt(user_msg: str, assistant_reply: str, recent_turns: Optional[List[Dict]] = None, top_snippets: Optional[List[str]] = None) -> List[Dict[str, str]]:
    schema = (
        '{ "memories": [ { "type": "fact|preference|task|summary|contact|link", '
        '"content": "", "confidence": 0.0, "priority": 1, "ttl_days": null, '
        '"due_text": null, "due_ts": null, "canonical_key": "", "source": "user|assistant|doc" } ] }'
    )
    sys = "\n".join([
        "You extract memory-worthy items from conversations.",
        "Return STRICT JSON matching the provided schema. No prose.",
        "Guidelines:",
        "- Save durable, personally useful info (facts, preferences, tasks, summaries, contacts, links).",
        "- Avoid ephemeral chit-chat or speculative info.",
        "- Include confidence (0..1) and priority (1=high,2=medium,3=low).",
        "- For tasks, include due_text if present (e.g., 'next Friday 5pm').",
        "- ttl_days: 30 for summaries, null for facts/preferences, 14 for links if unsure.",
        "- canonical_key: short, normalized string for dedupe (e.g., 'birthday: 8 oct').",
        f"Schema: {schema}",
    ])
    usr_lines = [
        f"Latest user message: {user_msg}",
        f"Assistant reply: {assistant_reply}",
    ]
    if recent_turns:
        try:
            compact = [
                {"role": t.get("role"), "content": t.get("content", "")[:400]}
                for t in recent_turns[-6:]
            ]
            usr_lines.append("Recent turns: " + json.dumps(compact))
        except Exception:
            pass
    if top_snippets:
        joined = "\n".join(top_snippets[:5])[:1200]
        usr_lines.append("Top snippets:\n" + joined)
    return [
        {"role": "system", "content": sys},
        {"role": "user", "content": "\n".join(usr_lines)},
    ]


def _safe_json_parse(text: str) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(text)
    except Exception:
        # Try to find the first {...} block
        try:
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                return json.loads(text[start:end+1])
        except Exception:
            return None
    return None


def _canonical_key(item: Dict[str, Any]) -> str:
    key = (item.get("canonical_key") or item.get("content") or "").strip().lower()
    t = _normalize_type(item.get("type") or "")
    if key and not key.startswith(f"{t}:"):
        key = f"{t}: {key}"
    return key


def _hash_key(key: str) -> str:
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def extract_memories(user_id: str, user_msg: str, assistant_reply: str, recent_turns: Optional[List[Dict]] = None, top_snippets: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    messages = _build_prompt(user_msg, assistant_reply, recent_turns, top_snippets)
    raw = cerebras_chat_with_model(messages, model=None, temperature=0.0, max_tokens=400)
    data = _safe_json_parse(raw) or {"memories": []}
    out: List[Dict[str, Any]] = []
    for m in data.get("memories", []) or []:
        mtype = _normalize_type(m.get("type", "").strip())
        content = (m.get("content") or "").strip()
        if not mtype or not content:
            continue
        confidence = float(m.get("confidence", 0.0) or 0.0)
        priority = int(m.get("priority", 3) or 3)
        if confidence < 0.6 or priority > 2:
            continue
        due_text = m.get("due_text")
        due_ts = m.get("due_ts")
        if mtype == "task" and not due_ts and due_text:
            due_ts = parse_due_text_to_ts(due_text)
        ck = _canonical_key(m)
        # Optional entity extraction (names/projects) if present in JSON (extensible)
        entities = m.get("entities") if isinstance(m.get("entities"), list) else []
        out.append({
            "type": mtype,
            "content": content,
            "confidence": confidence,
            "priority": priority,
            "ttl_days": m.get("ttl_days"),
            "due_text": due_text,
            "due_ts": due_ts,
            "canonical_key": ck,
            "key_hash": _hash_key(ck) if ck else None,
            "source": m.get("source") or "user",
            "entities": entities,
        })
    return out


def store_extracted_memories(user_id: str, items: List[Dict[str, Any]]) -> int:
    # Dedupe by exact content within recent window
    recent = recall_memories(user_id, limit=200)
    existing_contents = {r[3] if isinstance(r, (list, tuple)) else (r.get("content") if isinstance(r, dict) else str(r)) for r in (recent or [])}
    stored = 0
    for it in items:
        mtype = it["type"]
        content = it["content"]
        # Send into review queue for explicit approval to avoid unwanted autosaves
        extra = None
        try:
            import json
            extra = json.dumps({"entities": it.get("entities") or []})
        except Exception:
            pass
        add_pending_memory(
            user_id,
            mtype,
            content,
            confidence=it.get("confidence"),
            priority=it.get("priority"),
            due_ts=it.get("due_ts"),
            extra_json=extra,
        )
        stored += 1
    return stored


def extract_and_store_memories(user_id: str, user_msg: str, assistant_reply: str, hits: Optional[List[Dict[str, Any]]] = None):
    # Build snippets from hits
    snippets: List[str] = []
    if hits:
        for h in hits[:5]:
            txt = h.get("text") or ""
            if txt:
                snippets.append(txt[:400])
    items = extract_memories(user_id, user_msg, assistant_reply, recent_turns=None, top_snippets=snippets)
    store_extracted_memories(user_id, items)


