from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai
import os
from dotenv import load_dotenv
from pydantic import BaseModel
import redis

# Configure Gemini with API key
load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise ValueError("Missing GOOGLE_API_KEY")
genai.configure(api_key=GOOGLE_API_KEY)
r = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)

# Use latest GenerativeModel API
model = genai.GenerativeModel("models/gemini-1.5-pro")
chat = model.start_chat(history=[])

app = FastAPI()

# Allow frontend (React on port 5173) to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    query: str
    session_id: str

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    try:
        query = request.query
        session_id = request.session_id

        if not query:
            return {"error": "No query provided"}
        
        history_key = f"history:{session_id}"
        past_messages = r.lrange(history_key, 0, -1)

        # Send message to Gemini
        response = chat.send_message(query)
        r.rpush(history_key, f"User: {query}")
        r.rpush(history_key, f"Bot: {response.text}")
        return {"answer": response.text}

    except Exception as e:
         if "429" in str(e):
            return {"error": "Gemini quota exceeded. Please try again later or upgrade your plan."}
         return {"error": f"Error calling Gemini API: {e}"}

@app.post("/reset/{session_id}")
async def reset_session(session_id: str):
    history_key = f"history:{session_id}"
    r.delete(history_key)
    return {"message": f"Session {session_id} has been reset."}


@app.get("/history/{session_id}")
async def get_history(session_id: str):
    history_key = f"history:{session_id}"
    messages = r.lrange(history_key, 0, -1)  # get all stored messages
    if not messages:
        return {"history": []}  # return empty array if no history
    return {"history": messages}