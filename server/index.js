
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const axios = require('axios');
const { createParser } = require('eventsource-parser'); // to parse SSE stream

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.json());

const redis = new Redis({ host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT || 6379 });

const RETRIEVAL_URL = process.env.RETRIEVAL_URL || 'http://localhost:8001/retrieve';
const LLM_STREAM_URL = process.env.LLM_STREAM_URL || 'http://localhost:8002/stream';
const LLM_GEN_URL = process.env.LLM_GEN_URL || 'http://localhost:8002/generate';

// create session
app.post('/session', async (req, res) => {
  const sessionId = uuidv4();
  const key = `hist:${sessionId}`;
  const ttl = parseInt(process.env.REDIS_SESSION_TTL || '86400', 10);
  await redis.del(key).catch(()=>{});
  await redis.expire(key, ttl).catch(()=>{});
  res.json({ sessionId });
});

app.get('/history/:sessionId', async (req, res) => {reset
  const { sessionId } = req.params;
  const key = `hist:${sessionId}`;
  const items = await redis.lrange(key, 0, -1);
  const history = items.map(i => JSON.parse(i));
  res.json({ history });
});

app.post('/reset/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const key = `hist:${sessionId}`;
  await redis.del(key);
  res.json({ cleared: true });
});

// simple REST chat (non-streaming)
app.post('/chat/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;
  const key = `hist:${sessionId}`;
  await redis.rpush(key, JSON.stringify({ role: 'user', text: message, ts: Date.now() }));

  const retrievalResp = await axios.post(RETRIEVAL_URL, { query: message, top_k: 5 });
  const contexts = retrievalResp.data;

  const prompt = `You are an assistant. Use only the following snippets to answer. If answer not present, say you don't know.\n\n${contexts.map((c,i)=>`Snippet ${i+1}:\n${c.text}\nSource: ${c.metadata.source_url||c.metadata.source || 'unknown'}`).join("\n\n")}\n\nUser question: ${message}\nAnswer:`;

  // call LLM non-streaming
  const llmResp = await axios.post(LLM_GEN_URL, { prompt, max_tokens: 512 });
  const answer = llmResp.data.answer || 'No response';

  await redis.rpush(key, JSON.stringify({ role: 'assistant', text: answer, ts: Date.now() }));
  res.json({ answer, contexts });
});

// Socket.IO streaming: client emits 'user_message' with {sessionId, message}
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('init', ({ sessionId }) => {
    socket.join(sessionId);
  });

  socket.on('user_message', async ({ sessionId, message }) => {
    const key = `hist:${sessionId}`;
    await redis.rpush(key, JSON.stringify({ role: 'user', text: message, ts: Date.now() }));

    // Retrieve top-k contexts
    const retrievalResp = await axios.post(RETRIEVAL_URL, { query: message, top_k: 5 });
    const contexts = retrievalResp.data;
    const prompt = `You are an assistant. Use only the following snippets to answer. If answer not present, say you don't know.\n\n${contexts.map((c,i)=>`Snippet ${i+1}:\n${c.text}\nSource: ${c.metadata.source_url||c.metadata.source || 'unknown'}`).join("\n\n")}\n\nUser question: ${message}\nAnswer:`;

    // POST to LLM streaming endpoint; we expect SSE text/event-stream reply
    try {
      const resp = await axios({
        method: 'post',
        url: LLM_STREAM_URL,
        data: { prompt, max_tokens: 512 },
        timeout: 0, // streaming, do not timeout
        responseType: 'stream',
        headers: { 'Content-Type': 'application/json' },
      });

      const parser = createParser((event) => {
        if (event.type === 'event') {
          // event.data is a JSON string per our llm_service SSE generator
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'chunk') {
              socket.emit('bot_chunk', { chunk: payload.text });
            } else if (payload.type === 'done') {
              const finalText = payload.text;
              // persist final
              redis.rpush(key, JSON.stringify({ role: 'assistant', text: finalText, ts: Date.now() }));
              socket.emit('bot_done', { answer: finalText });
            } else if (payload.type === 'error') {
              socket.emit('bot_error', { error: payload.error });
            }
          } catch (err) {
            // non-json chunk
            socket.emit('bot_chunk', { chunk: event.data });
          }
        }
      });

      resp.data.on('data', (chunk) => {
        const str = chunk.toString('utf8');
        // SSE emits lines like: data: <json>\n\n
        parser.feed(str);
      });

      resp.data.on('end', () => {
        // stream ended
      });

      resp.data.on('error', (err) => {
        socket.emit('bot_error', { error: String(err) });
      });

    } catch (err) {
      console.error('LLM streaming error', err?.message || err);
      socket.emit('bot_error', { error: err?.message || 'LLM stream failed' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on', PORT));
