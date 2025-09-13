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

    # Clean the message for analysis
    msg_lower = message.lower().strip()

    # Skip obvious non-task messages
    skip_patterns = [
        r"^(hi|hello|hey|good morning|good afternoon|good evening|how are you|how's it going|what's up)",
        r"^(thanks?|thank you|awesome|great|cool|nice|wow)",
        r"^(yes|no|okay|ok|sure|alright|fine)",
        r"^(tell me|explain|what is|how do|can you)",
        r"^(this is|that's|its|it's)",
        r"^(analyze|provide|give me|show me)",
    ]
    for pattern in skip_patterns:
        if re.search(pattern, msg_lower):
            return None

    # Quick regex check for explicit task indicators
    explicit_patterns = [
        r"\s*(task:|todo:)\s*(.+)$",
        r"\b(?:remind me to|remember to)\s+(.+?)(?:\.|$|!|\?|$)",
        r"\b(?:i need to|i should|i must)\s+(.+?)(?:\.|$|!|\?|$)",
        r"\b(?:add|create|make)\s+(?:a\s+)?task\s+(?:to\s+)?(.+?)(?:\.|$|!|\?|$)",
        r"\b(?:don't forget|don't forget to)\s+(.+?)(?:\.|$|!|\?|$)",
    ]
    for pattern in explicit_patterns:
        m = re.search(pattern, message, flags=re.I)
        if m and m.group(1).strip():
            task = m.group(1).strip()
            if len(task) > 3 and not task.startswith("the message") and not task.startswith("Analyze"):
                return task

    # AI-powered detection for implicit tasks - only for longer messages with clear intent
    if len(message.split()) >= 8:
        try:
            from clients.llm_cerebras import cerebras_chat_with_model

            system_prompt = (
                "You are a task detection expert. Analyze the user's message and determine "
                "if they're expressing a clear intent to DO something specific and actionable. "
                "Only respond with a task if it's something they need to remember or do later. "
                "Examples of tasks: 'buy groceries', 'call mom', 'finish report', 'schedule meeting'. "
                "Examples of non-tasks: greetings, questions, statements, compliments, analysis requests. "
                "If it is a clear task, respond with ONLY the task description in 1-5 words. "
                "Otherwise respond with exactly 'NO_TASK'."
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Message: {message}"},
            ]
            response = cerebras_chat_with_model(messages, temperature=0.1, max_tokens=50)
            if response and response.strip() not in ["NO_TASK", "no_task", "No task", "no task"]:
                task = response.strip()
                # Clean up common AI artifacts
                task = re.sub(r'^["\']|["\']$', '', task)  # Remove quotes
                task = re.sub(r'^Task:\s*', '', task, flags=re.I)  # Remove "Task:" prefix
                task = re.sub(r'^Response:\s*', '', task, flags=re.I)  # Remove "Response:" prefix

                # Additional validation for AI responses
                if (3 < len(task) < 100 and
                    not any(skip_word in task.lower() for skip_word in ['analyze', 'the message', 'provide', 'explain', 'tell', 'show', 'give']) and
                    not task.lower().startswith(('analyze', 'provide', 'explain', 'tell', 'show', 'give')) and
                    not re.search(r'\b(message|content|text)\b', task.lower())):
                    if os.getenv("TASK_DETECTION_DEBUG", "false").lower() in ("1", "true", "yes"):
                        print(f"[task_management] AI detected task: {task}")
                    return task
        except Exception as e:
            if os.getenv("TASK_DETECTION_DEBUG", "false").lower() in ("1", "true", "yes"):
                print(f"[task_management] AI detection failed: {e}")

    # Fallbacks - only for very clear action verbs
    fallback_patterns = [
        r"\b(?:fix|solve|resolve|address)\s+(?:the\s+)?(.+?)(?:\.|$|!|\?|$)",
        r"\b(?:prepare|organize|arrange|plan)\s+(?:the\s+)?(.+?)(?:\.|$|!|\?|$)",
        r"\b(?:schedule|book|reserve)\s+(?:the\s+)?(.+?)(?:\.|$|!|\?|$)",
        r"\b(?:buy|purchase|get|order)\s+(.+?)(?:\.|$|!|\?|$)",
    ]
    for pattern in fallback_patterns:
        m = re.search(pattern, message, flags=re.I)
        if m and m.group(1).strip():
            task = m.group(1).strip()
            if len(task) > 3 and not any(skip_word in task.lower() for skip_word in ['the message', 'analyze', 'provide']):
                return task

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

    # Note patterns first (more specific)
    note_patterns = [
        re.compile(r"^\s*(?:please\s+)?(?:take\s+a\s+)?note(?:\s+(?:this|that))?[:,-]?\s*(.+)$", re.I),
        re.compile(r"^\s*note\s*[:,-]?\s*(.+)$", re.I),
        re.compile(r"^\s*remember\s+(?:that|this)[:,-]?\s+(.+)$", re.I),
        re.compile(r"^\s*jot\s+(?:this|that)?(?:down)?[:,-]?\s*(.+)$", re.I),
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

    # Task patterns (only if not already created a note)
    if not created_any:
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


