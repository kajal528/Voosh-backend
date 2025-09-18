from fastapi import FastAPI, HTTPException
import chromadb
from chromadb.utils import embedding_functions

# ✅ Use PersistentClient for local storage
client = chromadb.PersistentClient(path="./chroma_db")

# Example: if you’re using sentence-transformers for embeddings
embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2"
)

collection = client.get_or_create_collection(
    name="docs",
    embedding_function=embedding_function
)

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Retrieval service is running!"}

@app.post("/add")
async def add_document(doc_id: str, text: str):
    try:
        collection.add(documents=[text], ids=[doc_id])
        return {"status": "success", "id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/query")
async def query(q: str):
    try:
        results = collection.query(query_texts=[q], n_results=3)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
