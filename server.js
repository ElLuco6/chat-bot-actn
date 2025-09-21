import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import crypto from 'crypto';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CHAT_MODEL = process.env.CHAT_MODEL || 'llama3:8b-instruct';
const EMB_MODEL  = process.env.EMB_MODEL  || 'nomic-embed-text';
const IDX_FILE   = process.env.IDX_FILE   || './index.json';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

/* --------------------- Utils --------------------- */
const norm = v => Math.sqrt(v.reduce((s,x)=>s+x*x,0)) || 1;
const dot = (a,b) => a.reduce((s,x,i)=>s + x*(b[i]||0),0);
const cosine = (a,b) => dot(a,b)/(norm(a)*norm(b));

async function embed(text) {
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ model: EMB_MODEL, prompt: text })
  });
  if (!r.ok) throw new Error('Embeddings error');
  const j = await r.json();
  return j.embedding;
}

async function chat(system, user) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      options: { temperature: 0.2 }
    })
  });
  if (!r.ok) throw new Error('Chat error');
  const j = await r.json();
  return j.message?.content?.trim() || '';
}

/* --------------------- Ingestion (RAG) --------------------- */
// Very basic HTML → texte
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

async function fetchPage(url) {
  const r = await fetch(url, { timeout: 15000 });
  if (!r.ok) throw new Error(`Fetch fail: ${url}`);
  const html = await r.text();
  const text = htmlToText(html);
  return { url, text };
}

// Découpe en blocs ~1200 caractères
function chunk(text, max=1200) {
  const out = [];
  for (let i=0; i<text.length; i+=max) out.push(text.slice(i, i+max));
  return out;
}

app.post('/ingest', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ error:'Provide {urls:[...]}'});    
    const docs = [];
    for (const url of urls) {
      const { text } = await fetchPage(url);
      const parts = chunk(text);
      for (const p of parts) {
        if (p.length < 200) continue;
        docs.push({ id: crypto.randomUUID(), url, text: p });
      }
    }
    // Embeddings
    const index = [];
    for (const d of docs) {
      const vec = await embed(d.text);
      index.push({ id: d.id, url: d.url, text: d.text, vec });
    }
    await fs.writeFile(IDX_FILE, JSON.stringify(index));
    res.json({ ok:true, chunks: index.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* --------------------- Chat avec RAG --------------------- */
async function searchSimilar(q, k=6) {
  const buf = await fs.readFile(IDX_FILE, 'utf8').catch(()=>null);
  if (!buf) return [];
  const index = JSON.parse(buf);
  const qvec = await embed(q);
  const scored = index.map(r => ({ ...r, score: cosine(qvec, r.vec) }));
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,k);
}

const SYSTEM_PROMPT = `Tu es l'assistant support d'ACTN.
- Réponds en français, clair et concis.
- Utilise uniquement les informations fournies en contexte (extraits).
- Si tu n'es pas sûr, propose de créer un ticket (https://tickets.actn.fr) ou d'écrire à sav@actn.fr.
- Donne des liens sources si possible.
- Ne fabrique pas de délais/numéros non présents dans le contexte.`;

app.post('/chat', async (req, res) => {
  try {
    const q = (req.body?.message || '').toString().slice(0, 1000);
    if (!q) return res.status(400).json({ error:'message required' });

    // Recherche contextuelle
    const ctx = await searchSimilar(q, 6);
    const ctxTxt = ctx.map((c,i)=>`[${i+1}] (${c.url})\n${c.text}`).join('\n\n');

    const prompt = `Question: ${q}\n\nContexte (extraits du site):\n${ctxTxt}\n\nConsignes: réponds en citant les sources [numéro] pertinentes. Termine par des actions possibles (Créer un ticket / Email SAV / Téléphone si présent).`;

    const answer = await chat(SYSTEM_PROMPT, prompt);

    const sources = ctx.map((c,i)=>({ n:i+1, url:c.url }));
    const ctas = [
      { label:'Créer un ticket', url:'https://tickets.actn.fr' },
      { label:'Écrire au SAV', url:'mailto:sav@actn.fr' }
    ];
    res.json({ answer, sources, ctas });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log('ACTN bot API on :' + PORT));
