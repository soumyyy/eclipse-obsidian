import re
from typing import List, Dict


def should_apply_cot(user_msg: str) -> bool:
    q = (user_msg or "").lower()
    cot_triggers = [
        r"\b(plan|design|architect|strategy|steps|algorithm|derive|prove|analyze|compare|trade[- ]offs?)\b",
        r"\bhow (?:do|would|to)\b",
        r"\bwhy\b",
        r"\broot cause\b",
        r"\bdebug|investigate|optimi[sz]e\b",
        r"\bconstraints?\b",
    ]
    return any(re.search(p, q, flags=re.I) for p in cot_triggers) or len(q.split()) >= 14


def build_cot_hint() -> str:
    return (
        "You may use hidden, internal chain-of-thought to reason (do NOT reveal it)."
        " Think step by step privately and only output the final JSON per schema."
    )


def inject_cot_hint(messages: List[Dict], hint: str) -> List[Dict]:
    if not messages or not hint:
        return messages
    # Insert just before the final user message if present
    idx = len(messages) - 1 if messages and messages[-1].get("role") == "user" else len(messages)
    return [*messages[:idx], {"role": "system", "content": hint}, *messages[idx:]]


