# Eclipse - My Personal Assistant

You can also call it **Enhanced Cognitive Linguistic Intelligent Personal Support Engine**

**Personal Project Documentation & Technical Portfolio** - A sophisticated assistant built that transforms my personal knowledge base into intelligent, contextual conversations. This serves as my technical diary for this project.

## **What I Built & Why**

This is my personal AI companion that I developed to:
- **Understand my knowledge base** through advanced RAG (Retrieval-Augmented Generation)
- **Sync seamlessly across all my devices** with session management
- **Learn from our conversations** and build persistent memory
- **Instant responses** with optimized caching and streaming

**Personal Use Case**: I use this daily to chat with my own knowledge base, ask questions about docs/journal I've uploaded, and maintain a persistent memory about me.

## **System Architecture**

```
┌─────────────────┐ 
│   My Frontend   │    ┌─────────────────┐    ┌─────────────────┐
│   (Next.js)     │◄──►│   My Backend    │◄──►│   My Data Layer │
│                 │    │   (FastAPI)     │    │   (Redis +      │
└─────────────────┘    └─────────────────┘    │    SQLite)      │
         │                       │            └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Vercel        │    │   DigitalOcean  │    │   Upstash       │
│   (Deployed)    │    │   VPS           │    │   Redis         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## **What I Actually Built**

### **AI Stuff**
- **RAG System**: FAISS vector database + sentence transformers for finding relevant info
- **AI Models**: Cerebras GPT-OSS-120B (main) + OpenAI GPT (backup)
- **Memory System**: Stores facts about me and learns from conversations
- **File Processing**: Handles PDFs, Markdown, text files intelligently

### **Multi-Device Sync**
- **Session Management**: Each chat gets its own session, no mixing
- **Real-time Updates**: Changes sync across all my devices instantly
- **Context Isolation**: Each chat is completely separate
- **Offline Support**: Works even when offline

### **Performance**
- **Caching**: Similar questions get instant answers (5-min cache)
- **Streaming**: Real-time responses like ChatGPT
- **Smart Retrieval**: Finds the most relevant info from multiple sources

## **Tech Stack**

### **Frontend**
- **Next.js 15** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **SSE** - Real-time streaming

### **Backend**
- **FastAPI** - Python web framework
- **Pydantic** - Data validation
- **Streaming** - Real-time responses
- **CORS** - Cross-origin requests

### **AI & Data**
- **FAISS** - Vector similarity search
- **Sentence Transformers** - Text embeddings
- **Redis (Upstash)** - Session storage & chat history
- **SQLite** - Long-term memory storage

### **Infrastructure**
- **Vercel** - Frontend hosting
- **DigitalOcean VPS** - Backend server
- **Nginx** - Reverse proxy + SSL
- **GitHub Actions** - Auto-deployment

## **How It Works**

### **RAG Pipeline**
1. **Query** → Generate multiple search variants
2. **Search** → Look in FAISS + files + memory
3. **Merge** → Combine results using RRF ranking
4. **Generate** → Send to AI with context
5. **Cache** → Store response for similar future queries

### **Session Management**
- **Time-based IDs**: `session_2025-08-25_morning` (same across devices)
- **Unique IDs**: `session_2025-08-25_morning_1234567890` (new chats)
- **Redis Storage**: Sessions expire after 24 hours
- **Cross-device**: All devices see the same sessions

### **Memory System**
- **Personal Facts**: Info about me, preferences
- **Semantic Memories**: Contextual knowledge
- **Tasks**: Actionable items
- **Ephemeral**: Temporary file context

## **Key Endpoints**

- `/chat/stream` - Main chat with streaming
- `/api/sessions` - Create/manage chat sessions
- `/api/upload` - Handle file uploads
- `/memories/*` - Memory management
- `/tasks/*` - Task tracking
- `/health` - System health check


## **What I'm Using Daily**

- **Cerebras GPT-OSS-120B** - Main AI model
- **FAISS** - Vector search for my knowledge base
- **Redis** - Session storage and chat history
- **SQLite** - Long-term memory about me
- **Vercel** - Frontend hosting
- **DigitalOcean** - Backend server

## **Quick Start (For Future Me)**

```bash
# Backend
cd backend
pip install -r requirements.txt
python app.py

# Frontend  
cd frontend
npm install
npm run dev
```
---
