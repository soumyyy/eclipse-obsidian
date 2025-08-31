#!/usr/bin/env python3
"""
Debug script to identify what's crashing the chat endpoints
Run this on your VPS to see which component fails
"""

import os
import sys
from pathlib import Path

# Load environment
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

def test_cerebras():
    print("Testing Cerebras API...")
    try:
        from llm_cerebras import cerebras_chat
        messages = [{"role": "user", "content": "hi"}]
        result = cerebras_chat(messages)
        print(f"✅ Cerebras API works: {result[:50]}...")
        return True
    except Exception as e:
        print(f"❌ Cerebras API failed: {e}")
        return False

def test_cerebras_stream():
    print("Testing Cerebras streaming...")
    try:
        from llm_cerebras import cerebras_chat_stream
        messages = [{"role": "user", "content": "hi"}]
        chunks = list(cerebras_chat_stream(messages))
        print(f"✅ Cerebras streaming works: {len(chunks)} chunks")
        return True
    except Exception as e:
        print(f"❌ Cerebras streaming failed: {e}")
        return False

def test_faiss():
    print("Testing FAISS retriever...")
    try:
        from rag import get_retriever
        retriever = get_retriever()
        print("✅ FAISS retriever loaded successfully")
        return True
    except Exception as e:
        print(f"❌ FAISS retriever failed: {e}")
        return False

def test_embedder():
    print("Testing sentence transformers...")
    try:
        from rag import make_faiss_retriever
        retriever, embed_fn = make_faiss_retriever()
        test_vec = embed_fn("test query")
        print(f"✅ Embedder works: {test_vec.shape}")
        return True
    except Exception as e:
        print(f"❌ Embedder failed: {e}")
        return False

def test_redis():
    print("Testing Redis connection...")
    try:
        from redis_config import RedisOps
        redis_ops = RedisOps()
        # Simple test
        redis_ops.set("test", "value", ttl=10)
        result = redis_ops.get("test")
        print(f"✅ Redis works: {result}")
        return True
    except Exception as e:
        print(f"❌ Redis failed: {e}")
        return False

def test_context_builder():
    print("Testing context builder...")
    try:
        from app import _build_context_bundle
        context, all_hits, hits, file_context, uploads = _build_context_bundle(
            "soumya", "test message", None
        )
        print(f"✅ Context builder works: {len(context)} chars")
        return True
    except Exception as e:
        print(f"❌ Context builder failed: {e}")
        return False

if __name__ == "__main__":
    print("=== Backend Component Debug ===")
    print(f"Python: {sys.version}")
    print(f"Working dir: {os.getcwd()}")
    print(f"CEREBRAS_API_KEY set: {'Yes' if os.getenv('CEREBRAS_API_KEY') else 'No'}")
    print()
    
    tests = [
        test_redis,
        test_faiss, 
        test_embedder,
        test_cerebras,
        test_cerebras_stream,
        test_context_builder,
    ]
    
    results = {}
    for test in tests:
        try:
            results[test.__name__] = test()
        except Exception as e:
            print(f"❌ {test.__name__} crashed: {e}")
            results[test.__name__] = False
        print()
    
    print("=== Summary ===")
    for name, success in results.items():
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {name}")
    
    failed = [name for name, success in results.items() if not success]
    if failed:
        print(f"\n🔥 Components causing crashes: {', '.join(failed)}")
        print("Fix these before running uvicorn!")
    else:
        print("\n🎉 All components work! The crash might be elsewhere.")
