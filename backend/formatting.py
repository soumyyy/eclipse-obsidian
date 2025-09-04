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

    # Removed compact mode that could collapse rich content to 1–2 bullets.

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
        # Protect fenced code blocks from line-join transforms
        code_blocks: List[str] = []
        def _stash(m):
            code_blocks.append(m.group(0))
            return f"__CODEBLOCK_{len(code_blocks)-1}__"
        txt = re.sub(r"```[\s\S]*?```", _stash, txt)

        # Whitespace and soft-characters cleanup on non-code regions
        txt = re.sub(r"[\u00A0\u202F\u2007]", " ", txt)
        txt = re.sub(r"[\u200B-\u200D\u2060\u00AD]", "", txt)
        # Preserve markdown block boundaries (headings, lists, blockquotes, code fences, tables)
        # Only join soft-wrap newlines where the next line is not a block starter
        # and replace with a single space to avoid concatenating words.
        txt = re.sub(
            r"([^\n])\s*\n(?!\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|`{3}|\|))\s*",
            r"\1 ",
            txt,
        )
        txt = re.sub(r"\n{3,}", "\n\n", txt)
        txt = re.sub(r"^\s*[A-Za-z]\s*$", "", txt, flags=re.M)
        txt = re.sub(r"[ \t]+\n", "\n", txt)

        # Restore code blocks
        def _unstash(m):
            idx = int(m.group(1))
            return code_blocks[idx] if 0 <= idx < len(code_blocks) else m.group(0)
        txt = re.sub(r"__CODEBLOCK_(\d+)__", _unstash, txt)

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


def _close_unbalanced_code_fences(text: str) -> str:
    try:
        ticks = text.count("```")
        if ticks % 2 == 1:
            return text.rstrip() + "\n\n```\n"
        return text
    except Exception:
        return text


def _normalize_code_fence_newlines(text: str) -> str:
    """Ensure a newline after opening fences like ```python def ... -> ```python\n def ..."""
    try:
        # Insert newline after language tag if content continues on same line
        text = re.sub(r"```([A-Za-z0-9_+\-]+)[ \t]+(?=\S)", r"```\1\n", text)
        # Ensure closing fence starts on its own line
        text = re.sub(r"(?<!\n)```\s*$", "\n```", text, flags=re.M)
        return text
    except Exception:
        return text


def _enforce_blank_lines_around_fences(text: str) -> str:
    """Ensure blank lines before opening and after closing code fences for stable Markdown rendering."""
    try:
        # Ensure opening fences start on their own line (convert inline ```lang to a new block)
        text = re.sub(r"(?<!\n)```([A-Za-z0-9_+\-]*)", r"\n\n```\1", text)
        # Blank line before opening fence if previous line is non-empty
        text = re.sub(r"(?m)([^\n\s][^\n]*)\n```", r"\1\n\n```", text)
        # Blank line after closing fence if next line is non-empty (not already blank or end)
        text = re.sub(r"```\s*\n(?!\s*\n|\s*$)", "```\n\n", text)
        # If closing fence is followed by text on the same line, split to next line
        text = re.sub(r"```[ \t]*([^\n\s])", r"```\n\n\1", text)
        # Headings followed by an opening fence on same line: split
        text = re.sub(r"(?m)^(#{1,6}[^\n`]*)\s+```([A-Za-z0-9_+\-]*)\s*$", r"\1\n\n```\2", text)
        return text
    except Exception:
        return text


def format_markdown_unified(raw: str, *, prefer_table: bool = False, prefer_compact: bool = False) -> str:
    """
    Unified, robust formatter for assistant output.
    - If JSON schema is detected, render to Markdown deterministically.
    - Otherwise sanitize Markdown and close unbalanced code fences.
    - Never collapse content to a single bullet; preserve structure.
    """
    try:
        ans, md = ensure_json_and_markdown(raw, prefer_table=prefer_table, prefer_compact=False)
        if md and md.strip():
            md = _normalize_code_fence_newlines(md)
            md = _enforce_blank_lines_around_fences(md)
            return _close_unbalanced_code_fences(md)
    except Exception:
        pass
    # Fallback path: sanitize raw markdown
    cleaned = fallback_sanitize(raw)
    cleaned = _normalize_code_fence_newlines(cleaned)
    cleaned = _enforce_blank_lines_around_fences(cleaned)
    return _close_unbalanced_code_fences(cleaned)
