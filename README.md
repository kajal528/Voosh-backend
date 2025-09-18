This backend powers the **Voosh Full-Stack Chatbot** assignment.  
It provides APIs for chat, session history, and integration with embeddings + LLMs (Google Gemini).

## Tech Stack

- **Python 3.10+**
- **FastAPI + Uvicorn** → REST APIs
- **sentence-transformers** → Embedding model
- **ChromaDB** → Vector store for semantic search
- **Redis** → In-memory session & chat history
- **Google Generative AI (Gemini API)** → Large Language Model

---

## Features

1. **RAG Pipeline**

   - Ingests ~50 news articles.
   - Embeds text chunks with `sentence-transformers`.
   - Stores embeddings in **ChromaDB**.
   - Retrieves top-k similar chunks for queries.
   - Sends context + query to **Gemini API** for final response.

2. **Session Management**

   - Every new user gets a **session ID**.
   - Session chat history stored in **Redis**.
   - Supports fetching and clearing session history.

3. **APIs**
   - `POST /chat` → Ask a query, get an answer.
   - `GET /history/{session_id}` → Fetch past chat history.
   - `POST /reset/{session_id}` → Clear session history.
