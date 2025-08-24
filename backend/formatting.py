import json
import re
from typing import List, Dict, Optional, Tuple

from pydantic import BaseModel


class Section(BaseModel):
    heading: str
    bullets: List[str] = []
    table: Optional[Dict[str, List]] = None  # { headers: string[], rows: string[][] }


class JsonAnswer(BaseModel):
    title: Optional[str] = ""
    sections: List[Section] = []


def _sanitize_inline(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"[\u00A0\u202F\u2007]", " ", text)
    text = re.sub(r"[\u200B-\u200D\u2060\u00AD]", "", text)
    text = re.sub(r"([A-Za-z0-9])\s*\n\s*([A-Za-z0-9])", r"\1\2", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def render_markdown(ans: JsonAnswer, prefer_table: bool = False, prefer_compact: bool = False) -> str:
    lines: List[str] = []
    title = _sanitize_inline(ans.title or "")
    if not prefer_compact and title:
        lines.append(f"# {title}")
        lines.append("")

    sections = ans.sections or []
    # Count bullets and detect any tables
    total_bullets = 0
    has_any_table = False
    for s in sections:
        total_bullets += len(getattr(s, "bullets", []) or [])
        if getattr(s, "table", None):
            has_any_table = True
    if prefer_table and not has_any_table and sections:
        headers = ["Category", "Details"]
        rows: List[List[str]] = []
        for s in sections:
            h = _sanitize_inline(s.heading or "")
            bullets = [
                _sanitize_inline(b)
                for b in (s.bullets or [])
                if _sanitize_inline(b) and not re.fullmatch(r"[•\-—|.]+", _sanitize_inline(b))
            ]
            details = "; ".join(bullets)
            if h or details:
                rows.append([h, details])
        if rows:
            lines.append("| " + " | ".join(headers) + " |")
            lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
            for r in rows:
                lines.append("| " + " | ".join(r) + " |")
            return "\n".join(lines).strip()

    # Polish step: for trivial content, return plain text
    if (prefer_compact or (not has_any_table and total_bullets <= 2)) and sections:
        sec0 = sections[0]
        bullets = [
            _sanitize_inline(b)
            for b in (sec0.bullets or [])
            if _sanitize_inline(b) and not re.fullmatch(r"[•\-—|.]+", _sanitize_inline(b))
        ]
        if bullets:
            # If two bullets, join with space for a single concise sentence
            if len(bullets) == 2:
                return (bullets[0] + " " + bullets[1]).strip()
            return bullets[0]

    for sec in sections:
        h = _sanitize_inline(sec.heading or "")
        if h:
            lines.append(f"## {h}")
        raw_bullets = (sec.bullets or [])
        # Convert bullets, preserving code blocks when present
        cooked_bullets = []
        for b in raw_bullets:
            if not b:
                continue
            # If bullet already contains fenced code, keep as-is
            if "```" in b:
                cooked_bullets.append({"type": "code", "lang": None, "code": b})
                continue
            # Single-backtick language prefix like `python...`
            m = re.match(r"^`(python|py|js|ts|javascript|typescript|bash|sh|shell|json|yaml|yml)\s+([\s\S]*?)`$", b.strip(), flags=re.I)
            if m:
                lang = m.group(1).lower()
                code = m.group(2)
                cooked_bullets.append({"type": "code", "lang": lang, "code": code})
                continue
            # Heuristic: long multi-symbol text that looks like code
            if ("def " in b or "class " in b or "return" in b or ";" in b) and (len(b) > 80):
                cooked_bullets.append({"type": "code", "lang": None, "code": b})
                continue
            # Default: normal text bullet (sanitize)
            sb = _sanitize_inline(b)
            if sb and not re.fullmatch(r"[•\-—|.]+", sb):
                cooked_bullets.append({"type": "text", "text": sb})

        if cooked_bullets:
            # Detect numeric-ordered bullets among text bullets
            text_values = [x.get("text", "") for x in cooked_bullets if x["type"] == "text"]
            is_ordered = (len(text_values) == len(cooked_bullets)) and all(re.match(r"^\s*\d+[\.)]\s+", t) for t in text_values)
            if is_ordered:
                for i, t in enumerate(text_values, start=1):
                    clean = re.sub(r"^\s*\d+[\.)]\s+", "", t).strip()
                    lines.append(f"{i}. {clean}")
            else:
                for entry in cooked_bullets:
                    if entry["type"] == "text":
                        lines.append(f"- {entry['text']}")
                    else:
                        lang = entry.get("lang") or ""
                        code = entry.get("code", "")
                        lines.append(f"```{lang}".rstrip())
                        lines.append(code.rstrip("\n"))
                        lines.append("```")
        table = getattr(sec, "table", None) or {}
        headers = table.get("headers") if isinstance(table, dict) else None
        rows = table.get("rows") if isinstance(table, dict) else None
        if headers or rows:
            hdrs = [str(h).strip() for h in (headers or [])]
            if hdrs:
                lines.append("| " + " | ".join(hdrs) + " |")
                lines.append("| " + " | ".join(["---"] * len(hdrs)) + " |")
            for row in (rows or []):
                cells = [str(c).strip() for c in row]
                lines.append("| " + " | ".join(cells) + " |")
        lines.append("")
    return "\n".join(lines).strip()


def fallback_sanitize(raw: str) -> str:
    try:
        txt = str(raw or "")
        txt = re.sub(r"[\u00A0\u202F\u2007]", " ", txt)
        txt = re.sub(r"[\u200B-\u200D\u2060\u00AD]", "", txt)
        txt = re.sub(r"([A-Za-z0-9])\s*\n\s*([A-Za-z0-9])", r"\1\2", txt)
        txt = re.sub(r"\n{3,}", "\n\n", txt)
        txt = re.sub(r"^\s*[A-Za-z]\s*$", "", txt, flags=re.M)
        txt = re.sub(r"[ \t]+\n", "\n", txt)
        return txt.strip()
    except Exception:
        return str(raw or "")


def ensure_json_and_markdown(raw: str, *, prefer_table: bool = False, prefer_compact: bool = False) -> Tuple[Optional[JsonAnswer], str]:
    try:
        obj = json.loads(raw)
        ans = JsonAnswer(**obj)
        return ans, render_markdown(ans, prefer_table=prefer_table, prefer_compact=prefer_compact)
    except Exception:
        # Attempt a one-shot repair call should be done by caller due to circular import risk
        return None, fallback_sanitize(raw)


