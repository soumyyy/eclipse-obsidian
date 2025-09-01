from __future__ import annotations

import os
import re
from typing import Optional


def smart_detect_task(message: str) -> Optional[str]:
    """
    AI-powered task detection that understands natural language and context.
    Returns task content if detected, None otherwise.
    """
    if os.getenv("SMART_TASK_DETECTION", "true").lower() in ("0", "false", "no"):
        return None
    if not message or len(message.strip()) < 10:
        return None

    # Quick regex check for explicit task indicators
    explicit_patterns = [
        r"\s*(task:|todo:)\s*(.+)$",
        r"\b(?:remind me to|remember to)\s+(.+?)(?:\.|$)",
        r"\b(?:i need to|i should|i must)\s+(.+?)(?:\.|$)",
        r"\b(?:add|create|make)\s+(?:a\s+)?task\s+(?:to\s+)?(.+?)(?:\.|$)",
        r"\b(?:don't forget|don't forget to)\s+(.+?)(?:\.|$)",
    ]
    for pattern in explicit_patterns:
        m = re.search(pattern, message, flags=re.I)
        if m and m.group(1).strip():
            return m.group(1).strip()

    # AI-powered detection for implicit tasks
    try:
        from clients.llm_cerebras import cerebras_chat_with_model

        system_prompt = (
            "You are a task detection expert. Analyze the user's message and determine "
            "if they're expressing a need to do something. If it is a task, respond with "
            "ONLY the task description in clear, actionable language. Otherwise respond with NO_TASK."
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze this message: {message}"},
        ]
        response = cerebras_chat_with_model(messages, temperature=0.1, max_tokens=100)
        if response and response.strip() != "NO_TASK":
            task = response.strip()
            if task.startswith("Task: "):
                task = task[6:]
            if task.startswith("Response: "):
                task = task[10:]
            if 5 < len(task) < 200:
                if os.getenv("TASK_DETECTION_DEBUG", "false").lower() in ("1", "true", "yes"):
                    print(f"[task_management] AI detected task: {task}")
                return task
    except Exception as e:
        if os.getenv("TASK_DETECTION_DEBUG", "false").lower() in ("1", "true", "yes"):
            print(f"[task_management] AI detection failed: {e}")

    # Fallbacks
    fallback_patterns = [
        r"\b(?:fix|solve|resolve|address)\s+(?:the\s+)?(.+?)(?:\.|$)",
        r"\b(?:review|check|examine|analyze)\s+(?:the\s+)?(.+?)(?:\.|$)",
        r"\b(?:update|modify|change|improve)\s+(?:the\s+)?(.+?)(?:\.|$)",
        r"\b(?:prepare|organize|arrange|plan)\s+(?:the\s+)?(.+?)(?:\.|$)",
    ]
    for pattern in fallback_patterns:
        m = re.search(pattern, message, flags=re.I)
        if m and m.group(1).strip():
            return m.group(1).strip()

    return None


def auto_capture_intents(user_id: str, text: str) -> None:
    """Create tasks/notes based on natural phrasing like 'remind me to', 'take a note', etc."""
    try:
        from memory import add_task as _add_task, add_memory as _add_memory
    except Exception:
        return

    line = (text or "").strip()
    if not line:
        return

    created_any = False

    # Task patterns (ordered)
    task_patterns = [
        re.compile(r"^\s*(?:remind(?:\s+me)?\s+to)\s+(.+)$", re.I),
        re.compile(r"^\s*(?:create|add|make)\s+(?:a\s+)?(?:task|todo)[:,-]?\s+(.+)$", re.I),
        re.compile(r"^\s*(?:todo|task)[:,-]?\s+(.+)$", re.I),
        re.compile(r"\bfollow[- ]?up\s+on\s+(.+)$", re.I),
    ]
    for rx in task_patterns:
        m = rx.search(line)
        if m and m.group(1).strip():
            try:
                _add_task(user_id, m.group(1).strip())
                created_any = True
                break
            except Exception:
                pass

    # Note patterns (only if not already created a task)
    if not created_any:
        note_patterns = [
            re.compile(r"^\s*(?:please\s+)?(?:take\s+a\s+)?note(?:\s+(?:this|that))?[:,-]?\s*(.+)$", re.I),
            re.compile(r"^\s*note\s*[:,-]?\s*(.+)$", re.I),
            re.compile(r"^\s*remember\s+(?:that\s+)?(.+)$", re.I),
        ]
        for rx in note_patterns:
            m = rx.search(line)
            if m and m.group(1).strip():
                try:
                    _add_memory(user_id, m.group(1).strip(), mtype="note")
                    created_any = True
                    break
                except Exception:
                    pass

    # Last-resort light heuristic: verbs 'remind', 'todo', 'task', 'note'
    if not created_any:
        if re.match(r"^\s*(remind|todo|task|note)\b", line, re.I):
            head = re.match(r"^\s*(remind\s+me\s+to|remind|todo|task|note)\b[:,-]?\s*(.*)$", line, re.I)
            if head and head.group(2).strip():
                payload = head.group(2).strip()
                try:
                    if head.group(1).lower().startswith("note"):
                        _add_memory(user_id, payload, mtype="note")
                    else:
                        _add_task(user_id, payload)
                except Exception:
                    pass


