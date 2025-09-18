# scripts/ingest_news.py
# Requirements: pip install requests beautifulsoup4 transformers sentence-transformers chromadb

from sentence_transformers import SentenceTransformer
import requests
from bs4 import BeautifulSoup
import chromadb
from chromadb.config import Settings
import uuid
import time

# config
CHROMA_DIR = "./chroma_db"
MODEL_NAME = "all-MiniLM-L6-v2"  # compact & fast
DOCS = [
    # fill with ~50 URLs or read from rss.txt
    "https://example.com/news/article1",
    # ...
]

def fetch_text(url):
    r = requests.get(url, timeout=8)
    soup = BeautifulSoup(r.text, "html.parser")
    # naive text extract - you can improve with newspaper3k
    paragraphs = soup.find_all('p')
    text = "\n".join(p.get_text() for p in paragraphs)
    return text

def chunk_text(text, max_chars=1500):
    chunks = []
    start = 0
    while start < len(text):
        chunk = text[start:start+max_chars]
        chunks.append(chunk.strip())
        start += max_chars
    return chunks

def main():
    embed_model = SentenceTransformer(MODEL_NAME)
    client = chromadb.Client(Settings(chroma_db_impl="duckdb+parquet", persist_directory=CHROMA_DIR))
    collection = client.get_or_create_collection(name="news", metadata={"source": "news-corpus"})

    for url in DOCS:
        try:
            text = fetch_text(url)
        except Exception as e:
            print("fetch failed", url, e)
            continue
        chunks = chunk_text(text)
        ids = [str(uuid.uuid4()) for _ in chunks]
        metadatas = [{"source_url": url, "chunk_index": i} for i in range(len(chunks))]
        embeddings = embed_model.encode(chunks, convert_to_numpy=True).tolist()
        collection.add(
            documents=chunks,
            metadatas=metadatas,
            ids=ids,
            embeddings=embeddings
        )
        print(f"Added {len(chunks)} chunks from {url}")
        time.sleep(0.5)

    client.persist()

if __name__ == "__main__":
    main()
