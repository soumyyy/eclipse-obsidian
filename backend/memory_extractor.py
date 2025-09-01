import json
import os
import hashlib
from typing import List, Dict, Any, Optional
from rag import get_retriever
from memory import list_memories, delete_memory, update_memory
from clients.llm_cerebras import cerebras_chat_with_model
from memory import add_memory, recall_memories, add_task, upsert_entity, link_memory_to_entity, add_pending_memory

from date_utils import parse_due_text_to_ts
import re


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
        '"due_text": null, "due_ts": null, "canonical_key": "", "source": "user" } ] }'
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
        f"USER message: {user_msg}",
        "IMPORTANT: Only extract from the USER message above, not from any other source.",
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


# ---- trigger detection for explicit task capture ----

_TASK_TRIGGER_PATTERNS = [
    r"\bremind me\b",
    r"\bset (?:a )?reminder\b",
    r"\bcreate (?:a )?task\b",
    r"\badd (?:this )?to(?: my)? (?:to[- ]?do|todo|tasks?)\b",
    r"\bto[- ]?do\b",
    r"\bfollow up\b",
    r"\bschedule\b",
    r"\bdue (?:on|by)\b",
    r"\b(?:note that|note down|jot down)\b",
    r"\b(?:record|save|remember)\b",
    r"\b(?:don't forget|don't forget to)\b",
    r"\b(?:mark my calendar|calendar)\b",
    r"\b(?:track|monitor)\b",
    r"\b(?:deadline|timeline|milestone)\b",
    r"\b(?:priority|urgent|important)\b",
    r"\b(?:check|verify|confirm)\b",
    r"\b(?:update|modify|change)\b",
    r"\b(?:research|investigate|look into)\b",
    r"\b(?:prepare|organize|arrange)\b",
    r"\b(?:contact|reach out|get in touch)\b",
    r"\b(?:review|analyze|examine)\b"
]

_MEMORY_TRIGGER_PATTERNS = [
    r"\b(?:my|i am|i'm|i have|i like|i prefer|i want|i need)\b",
    r"\b(?:favorite|preferred|best|worst|always|never)\b",
    r"\b(?:experience|worked|studied|learned|discovered)\b",
    r"\b(?:project|company|role|position|job)\b",
    r"\b(?:skill|technology|tool|framework|language)\b",
    r"\b(?:hobby|interest|passion|goal|dream)\b",
    r"\b(?:family|friend|colleague|mentor|teacher)\b",
    r"\b(?:place|location|city|country|travel)\b",
    r"\b(?:book|article|video|podcast|course)\b",
    r"\b(?:achievement|accomplishment|milestone|success)\b",
    r"\b(?:challenge|problem|difficulty|obstacle)\b",
    r"\b(?:lesson|insight|realization|understanding)\b"
]

def _detect_task_trigger(user_msg: str) -> bool:
    text = (user_msg or "").lower()
    for pat in _TASK_TRIGGER_PATTERNS:
        if re.search(pat, text):
            return True
    return False

def _detect_memory_trigger(user_msg: str) -> bool:
    """Detect if user message contains personal information worth remembering."""
    text = (user_msg or "").lower()
    for pat in _MEMORY_TRIGGER_PATTERNS:
        if re.search(pat, text):
            return True
    return False

def _should_extract_memory(user_msg: str, assistant_reply: str) -> bool:
    """
    Determine if we should extract memories from this conversation turn.
    Only extract when user explicitly requests or provides personal information.
    """
    # Always extract if user explicitly requests
    if _detect_task_trigger(user_msg):
        return True
    
    # Extract if user provides personal information
    if _detect_memory_trigger(user_msg):
        return True
    
    # Don't extract from random LLM responses
    return False


def extract_memories(user_id: str, user_msg: str, assistant_reply: str, recent_turns: Optional[List[Dict]] = None, top_snippets: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """
    Extract memories ONLY from user messages, then enhance them with better language.
    """
    # Only process user message, ignore assistant reply for memory extraction
    if not user_msg.strip():
        return []
    
    # Create a focused prompt that only looks at the user message
    system_prompt = """You are a memory extraction expert. Extract personal information ONLY from the USER message.

Guidelines:
- Extract facts, preferences, tasks, and personal information
- Use clear, concise language
- Focus on what the user said about themselves
- Do NOT include information from assistant responses
- Keep memories short and actionable

Return ONLY valid JSON matching this schema:
{"memories": [{"type": "fact|preference|task", "content": "enhanced content", "confidence": 0.9, "priority": 1, "source": "user"}]}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Extract memories from this user message: {user_msg}"}
    ]
    
    try:
        raw = cerebras_chat_with_model(messages, model=None, temperature=0.1, max_tokens=600)
        data = _safe_json_parse(raw) or {"memories": []}
        
        out: List[Dict[str, Any]] = []
        for m in data.get("memories", []) or []:
            mtype = _normalize_type(m.get("type", "").strip())
            content = (m.get("content") or "").strip()
            
            if not mtype or not content:
                continue
                
            # Only accept memories that are clearly from user content
            if not _is_user_content(user_msg, content):
                continue
                
            confidence = float(m.get("confidence", 0.0) or 0.0)
            priority = int(m.get("priority", 3) or 3)
            due_text = m.get("due_text")
            due_ts = m.get("due_ts")
            
            if mtype == "task" and not due_ts and due_text:
                due_ts = parse_due_text_to_ts(due_text)
                
            ck = _canonical_key(m)
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
                "source": "user",
                "entities": entities,
            })
            
        return out
        
    except Exception as e:
        print(f"Error in memory extraction: {e}")
        return []
    # If nothing extracted, try a focused single-turn fallback pass (no regex)
    if not out:
        try:
            schema = (
                '{ "memories": [ { "type": "fact|preference|task|summary|contact|link", '
                '"content": "", "confidence": 0.0, "priority": 2, "due_text": null, "due_ts": null, "source": "user" } ] }'
            )
            sys2 = "\n".join([
                "Extract exactly one memory-worthy item from the USER message if present, else return {\"memories\":[]}.",
                "User statements about themselves (facts/preferences/tasks) should be captured.",
                "Return STRICT JSON only, matching the schema. No prose.",
                f"Schema: {schema}",
            ])
            messages2 = [
                {"role": "system", "content": sys2},
                {"role": "user", "content": f"USER: {user_msg}"},
            ]
            raw2 = cerebras_chat_with_model(messages2, model=os.getenv("EXTRACTOR_FALLBACK_MODEL") or None, temperature=0.0, max_tokens=600)
            data2 = _safe_json_parse(raw2) or {"memories": []}
            for m in data2.get("memories", []) or []:
                mtype = _normalize_type(m.get("type", "").strip())
                content = (m.get("content") or "").strip()
                if not mtype or not content:
                    continue
                confidence = float(m.get("confidence", 0.0) or 0.0)
                priority = int(m.get("priority", 2) or 2)
                due_text = m.get("due_text")
                due_ts = m.get("due_ts")
                if mtype == "task" and not due_ts and due_text:
                    due_ts = parse_due_text_to_ts(due_text)
                out.append({
                    "type": mtype,
                    "content": content,
                    "confidence": confidence,
                    "priority": priority,
                    "ttl_days": None,
                    "due_text": due_text,
                    "due_ts": due_ts,
                    "canonical_key": None,
                    "key_hash": None,
                    "source": "user",
                    "entities": [],
                })
        except Exception as e:
            try:
                if os.getenv("AUTO_MEMORY_DEBUG", "false").strip().lower() in ("1","true","yes"):
                    print(f"[memory_extractor] fallback LLM extract failed: {e}")
            except Exception:
                pass
    return out


def store_extracted_memories(user_id: str, items: List[Dict[str, Any]], task_triggered: bool = False) -> int:
    # Mode: 'review' (default), 'auto' (save everything), 'hybrid' (auto-save facts/tasks/preferences)
    mode = (os.getenv("AUTO_MEMORY_MODE") or "review").strip().lower()
    min_conf = float(os.getenv("AUTO_MEMORY_MIN_CONF", "0.7"))  # Increased from 0.4
    recent = recall_memories(user_id, limit=200)
    existing_contents = {r[3] if isinstance(r, (list, tuple)) else (r.get("content") if isinstance(r, dict) else str(r)) for r in (recent or [])}
    stored = 0
    for it in items:
        mtype = it["type"]
        content = it["content"]
        confidence = float(it.get("confidence") or 0.0)
        priority = int(it.get("priority") or 3)
        source = (it.get("source") or "user").strip().lower()

        should_auto = False
        if mode == "auto":
            should_auto = True
        elif mode == "hybrid":
            # Only auto-save very high confidence personal data from the user
            if mtype == "task" and confidence >= 0.8:
                should_auto = True
            elif mtype in ("fact", "preference") and source == "user" and confidence >= 0.9:
                should_auto = True

        # If not explicitly allowed above, fall back to strict thresholds
        if should_auto or (confidence >= min_conf and priority <= 2 and source == "user"):
            if mtype == "task":
                add_task(user_id, content, due_ts=it.get("due_ts"))
            else:
                if content not in existing_contents:
                    mem_id = add_memory(user_id, content, mtype=mtype)
                    # Link entities if present
                    for ent in (it.get("entities") or []):
                        try:
                            kind = (ent.get("kind") or "").strip() or "entity"
                            name = ent.get("name") or ""
                            if name:
                                eid = upsert_entity(user_id, kind, name)
                                link_memory_to_entity(mem_id, eid)
                        except Exception:
                            pass
            stored += 1
            continue

        # Otherwise, queue for review (most items will go here now)
        extra = None
        try:
            extra = json.dumps({"entities": it.get("entities") or []})
        except Exception:
            pass
        add_pending_memory(
            user_id,
            mtype,
            content,
            confidence=confidence,
            priority=priority,
            due_ts=it.get("due_ts"),
            extra_json=extra,
        )
        stored += 1
    return stored


def extract_and_store_memories(user_id: str, user_msg: str, assistant_reply: str, hits: Optional[List[Dict[str, Any]]] = None):
    # Only extract memories if user explicitly requests or provides personal info
    if not _should_extract_memory(user_msg, assistant_reply):
        return 0
    
    # Build snippets from hits
    snippets: List[str] = []
    if hits:
        for h in hits[:5]:
            txt = h.get("text") or ""
            if txt:
                snippets.append(txt[:400])
    
    items = extract_memories(user_id, user_msg, assistant_reply, recent_turns=None, top_snippets=snippets)
    
    # Determine if the user explicitly asked to capture a task/note
    task_triggered = _detect_task_trigger(user_msg)
    memory_triggered = _detect_memory_trigger(user_msg)
    
    # Optional debug log
    if os.getenv("AUTO_MEMORY_DEBUG", "false").strip().lower() in ("1", "true", "yes"):
        try:
            print(f"[memory_extractor] extracted {len(items)} items for user={user_id}, task_triggered={task_triggered}, memory_triggered={memory_triggered}")
        except Exception:
            pass
    
    return store_extracted_memories(user_id, items, task_triggered=task_triggered)


# ---- memory consolidation and enhancement ----

def consolidate_memories(user_id: str, similarity_threshold: float = 0.85) -> int:
    """
    Automatically consolidate similar memories into deeper, more comprehensive ones.
    Returns the number of consolidations performed.
    """
    try:
        rag = get_retriever()
        embed_fn = rag.embed_fn
        
        # Get all memories for the user
        all_memories = list_memories(user_id, limit=1000)
        if len(all_memories) < 2:
            return 0
        
        # Group memories by type for better consolidation
        memories_by_type = {}
        for mem in all_memories:
            mtype = mem.get("type", "note")
            if mtype not in memories_by_type:
                memories_by_type[mtype] = []
            memories_by_type[mtype].append(mem)
        
        consolidations = 0
        
        for mtype, memories in memories_by_type.items():
            if len(memories) < 2:
                continue
                
            # Get embeddings for all memories of this type
            texts = [m.get("content", "") for m in memories]
            if not texts:
                continue
                
            try:
                vecs = embed_fn(texts)
                
                # Find similar memories
                consolidated_groups = []
                processed = set()
                
                for i, mem1 in enumerate(memories):
                    if i in processed:
                        continue
                        
                    similar_group = [mem1]
                    processed.add(i)
                    
                    for j, mem2 in enumerate(memories[i+1:], i+1):
                        if j in processed:
                            continue
                            
                        # Calculate cosine similarity
                        similarity = float(vecs[i] @ vecs[j])
                        if similarity >= similarity_threshold:
                            similar_group.append(mem2)
                            processed.add(j)
                    
                    if len(similar_group) > 1:
                        consolidated_groups.append(similar_group)
                
                # Consolidate each group
                for group in consolidated_groups:
                    if consolidate_memory_group(user_id, group, mtype):
                        consolidations += 1
                        
            except Exception as e:
                print(f"Error consolidating {mtype} memories: {e}")
                continue
        
        return consolidations
        
    except Exception as e:
        print(f"Memory consolidation error: {e}")
        return 0

def consolidate_memory_group(user_id: str, memory_group: List[Dict], mtype: str) -> bool:
    """
    Consolidate a group of similar memories into one comprehensive memory.
    """
    try:
        if len(memory_group) < 2:
            return False
            
        # Extract key information from all memories
        all_content = [m.get("content", "") for m in memory_group]
        all_ids = [m.get("id") for m in memory_group]
        
        # Create consolidation prompt
        consolidation_prompt = [
            {"role": "system", "content": f"""You are a memory consolidation expert. Combine multiple related memories into one comprehensive, deeper memory.

Guidelines:
- Merge related information into a single, coherent memory
- Remove redundancy while preserving all important details
- Make the consolidated memory more insightful and useful
- Keep the same memory type: {mtype}
- Ensure the result is natural and readable

Return ONLY valid JSON matching this schema:
{{"consolidated_content": "the merged memory content", "confidence": 0.95, "priority": 1}}"""},
            {"role": "user", "content": f"Consolidate these {mtype} memories:\n\n" + "\n\n".join(f"- {content}" for content in all_content)}
        ]
        
        # Get consolidated content from LLM
        consolidated_response = cerebras_chat_with_model(consolidation_prompt, temperature=0.1, max_tokens=600)
        
        try:
            data = json.loads(consolidated_response)
            consolidated_content = data.get("consolidated_content", "")
            if not consolidated_content:
                return False
                
            # Create the new consolidated memory
            new_mem_id = add_memory(user_id, consolidated_content, mtype=mtype)
            
            # Delete the old memories
            for mem_id in all_ids:
                if mem_id:
                    delete_memory(user_id, mem_id)
            
            return True
            
        except Exception:
            return False
            
    except Exception as e:
        print(f"Error consolidating memory group: {e}")
        return False

def enhance_memory_depth(user_id: str, memory_id: int) -> bool:
    """
    Enhance a single memory by adding deeper insights and connections.
    """
    try:
        # Get the memory
        memories = list_memories(user_id, limit=1000)
        target_memory = None
        for mem in memories:
            if mem.get("id") == memory_id:
                target_memory = mem
                break
        
        if not target_memory:
            return False
            
        content = target_memory.get("content", "")
        mtype = target_memory.get("type", "note")
        
        # Create enhancement prompt
        enhancement_prompt = [
            {"role": "system", "content": f"""You are a memory enhancement expert. Take a memory and add deeper insights, connections, and context to make it more valuable.

Guidelines:
- Add relevant context and connections
- Include related insights or implications
- Make the memory more actionable or insightful
- Keep the same memory type: {mtype}
- Ensure the result is natural and readable

Return ONLY valid JSON matching this schema:
{{"enhanced_content": "the enhanced memory content", "confidence": 0.9, "priority": 1}}"""},
            {"role": "user", "content": f"Enhance this {mtype} memory with deeper insights:\n\n{content}"}
        ]
        
        # Get enhanced content from LLM
        enhanced_response = cerebras_chat_with_model(enhancement_prompt, temperature=0.2, max_tokens=800)
        
        try:
            data = json.loads(enhanced_response)
            enhanced_content = data.get("enhanced_content", "")
            if not enhanced_content:
                return False
                
            # Update the memory
            return update_memory(user_id, memory_id, content=enhanced_content)
            
        except Exception:
            return False
            
    except Exception as e:
        print(f"Error enhancing memory: {e}")
        return False

# ---- scheduled memory maintenance ----

def run_memory_maintenance(user_id: str) -> Dict[str, int]:
    """
    Run comprehensive memory maintenance including consolidation and enhancement.
    Returns statistics about what was processed.
    """
    stats = {
        "consolidations": 0,
        "enhancements": 0,
        "total_memories": 0
    }
    
    try:
        # Get total memory count
        all_memories = list_memories(user_id, limit=10000)
        stats["total_memories"] = len(all_memories)
        
        if stats["total_memories"] < 5:
            return stats  # Not enough memories to consolidate
        
        # Run advanced consolidation
        stats["consolidations"] = consolidate_memories_advanced(user_id)
        
        # Enhance a few random memories (but not too many)
        if stats["total_memories"] > 10:
            import random
            sample_size = min(3, stats["total_memories"] // 10)
            sample_ids = random.sample([m.get("id") for m in all_memories if m.get("id")], sample_size)
            
            for mem_id in sample_ids:
                if enhance_memory_depth(user_id, mem_id):
                    stats["enhancements"] += 1
        
        return stats
        
    except Exception as e:
        print(f"Memory maintenance error: {e}")
        return stats

# ---- Enhanced memory consolidation functions ----

def calculate_memory_similarity(mem1: Dict, mem2: Dict) -> float:
    """
    Calculate semantic similarity between two memories using multiple methods.
    Returns a score between 0 and 1.
    """
    try:
        content1 = mem1.get("content", "").lower()
        content2 = mem2.get("content", "").lower()
        
        if not content1 or not content2:
            return 0.0
        
        # Method 1: Jaccard similarity on words
        words1 = set(content1.split())
        words2 = set(content2.split())
        if len(words1) > 0 and len(words2) > 0:
            jaccard = len(words1.intersection(words2)) / len(words1.union(words2))
        else:
            jaccard = 0.0
        
        # Method 2: Content length similarity
        len1, len2 = len(content1), len(content2)
        length_sim = 1 - abs(len1 - len2) / max(len1, len2) if max(len1, len2) > 0 else 0
        
        # Method 3: Keyword overlap
        keywords1 = set([w for w in words1 if len(w) > 3 and w not in ['the', 'and', 'or', 'but', 'for', 'with']])
        keywords2 = set([w for w in words2 if len(w) > 3 and w not in ['the', 'and', 'or', 'but', 'for', 'with']])
        if len(keywords1) > 0 and len(keywords2) > 0:
            keyword_sim = len(keywords1.intersection(keywords2)) / len(keywords1.union(keywords2))
        else:
            keyword_sim = 0.0
        
        # Weighted combination
        final_score = (jaccard * 0.5) + (length_sim * 0.2) + (keyword_sim * 0.3)
        return min(1.0, final_score)
        
    except Exception as e:
        print(f"Error calculating similarity: {e}")
        return 0.0

def consolidate_memories_advanced(user_id: str) -> int:
    """
    Advanced consolidation using semantic similarity and LLM-based intelligent merging.
    """
    try:
        memories = list_memories(user_id, limit=1000)
        if len(memories) < 3:
            return 0
            
        consolidated_count = 0
        
        # Group memories by type for better organization
        memories_by_type = {}
        for mem in memories:
            mtype = mem.get("type", "note")
            if mtype not in memories_by_type:
                memories_by_type[mtype] = []
            memories_by_type[mtype].append(mem)
        
        for mtype, type_memories in memories_by_type.items():
            if len(type_memories) < 2:
                continue
                
            # Use semantic similarity for better grouping
            processed = set()
            for i, mem1 in enumerate(type_memories):
                if mem1.get("id") in processed:
                    continue
                    
                similar_group = [mem1]
                processed.add(mem1.get("id"))
                
                # Find semantically similar memories
                for j, mem2 in enumerate(type_memories[i+1:], i+1):
                    if mem2.get("id") in processed:
                        continue
                        
                    # Enhanced similarity check using multiple methods
                    similarity_score = calculate_memory_similarity(mem1, mem2)
                    
                    if similarity_score > 0.4:  # 40% similarity threshold
                        similar_group.append(mem2)
                        processed.add(mem2.get("id"))
                
                # Consolidate if we found similar memories
                if len(similar_group) > 1:
                    if consolidate_memory_group_advanced(user_id, similar_group):
                        consolidated_count += 1
                        
        return consolidated_count
        
    except Exception as e:
        print(f"Error in advanced consolidation: {e}")
        return 0

def consolidate_memory_group_advanced(user_id: str, memory_group: List[Dict]) -> bool:
    """
    Advanced consolidation using LLM to intelligently merge similar memories.
    """
    try:
        if len(memory_group) < 2:
            return False
            
        # Prepare content for LLM consolidation
        memory_contents = [mem.get("content", "") for mem in memory_group if mem.get("content")]
        memory_types = [mem.get("type", "note") for mem in memory_group]
        
        # Determine the most common type
        from collections import Counter
        most_common_type = Counter(memory_types).most_common(1)[0][0]
        
        # Create consolidation prompt
        consolidation_prompt = [
            {"role": "system", "content": f"""You are a memory consolidation expert. Your task is to merge multiple related memories into one comprehensive, well-organized memory.

Guidelines:
- Combine related information without losing details
- Organize the content logically
- Remove redundancy while preserving unique information
- Maintain clarity and readability
- Keep the memory type as: {most_common_type}
- Ensure the result is actionable and insightful
- Add relevant tags or categories if helpful

Return ONLY valid JSON matching this schema:
{{"consolidated_content": "the merged memory content", "confidence": 0.95, "priority": 1, "tags": ["tag1", "tag2"]}}"""},
            {"role": "user", "content": f"Consolidate these related {most_common_type} memories into one comprehensive memory:\n\n" + "\n\n".join(f"Memory {i+1}: {content}" for i, content in enumerate(memory_contents))}
        ]
        
        # Get consolidated content from LLM
        consolidated_response = cerebras_chat_with_model(consolidation_prompt, temperature=0.1, max_tokens=1000)
        
        try:
            data = json.loads(consolidated_response)
            consolidated_content = data.get("consolidated_content", "")
            if not consolidated_content:
                return False
                
            # Create the consolidated memory
            new_memory_id = add_memory(user_id, consolidated_content, mtype=most_common_type)
            
            if new_memory_id:
                # Delete the original memories
                for mem in memory_group:
                    delete_memory(user_id, mem.get("id"))
                
                print(f"Successfully consolidated {len(memory_group)} memories into new memory {new_memory_id}")
                return True
                
        except Exception as e:
            print(f"Error parsing consolidation response: {e}")
            return False
            
    except Exception as e:
        print(f"Error in advanced consolidation: {e}")
        return False


def _is_user_content(user_msg: str, extracted_content: str) -> bool:
    """
    Verify that extracted content is actually based on user message.
    """
    user_words = set(user_msg.lower().split())
    extracted_words = set(extracted_content.lower().split())
    
    # Check if key words from user message are present in extracted content
    key_words = [w for w in user_words if len(w) > 3 and w not in ['the', 'and', 'or', 'but', 'for', 'with', 'this', 'that']]
    
    if not key_words:
        return True  # Allow if no key words to check
        
    # At least 30% of key words should be present
    matches = sum(1 for word in key_words if word in extracted_words)
    return matches / len(key_words) >= 0.3


