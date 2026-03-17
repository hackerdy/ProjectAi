# ProjectAi — Autonomous Academic Research Engine

An autonomous system that researches and writes comprehensive academic-style projects based on pre-defined "Style Profiles," powered by a multi-agent AI workflow.

## Architecture

```
projectai/
├── frontend/                    # Next.js (App Router) + TailwindCSS
│   ├── app/
│   │   ├── dashboard/page.tsx   # Main UI: topic input, style selection, status
│   │   ├── admin/page.tsx       # Admin: upload reference docs to knowledge base
│   │   ├── layout.tsx
│   │   └── page.tsx             # Redirects → /dashboard
│   ├── components/
│   │   └── AgentStatusBar.tsx   # Visual pipeline status bar
│   ├── lib/
│   │   ├── api.ts               # Backend API client
│   │   └── useJobStatus.ts      # WebSocket + polling hook
│   └── types/index.ts           # Shared TypeScript types
│
└── backend/                     # Node.js + TypeScript + LangGraph.js
    └── src/
        ├── agents/
        │   ├── types.ts          # AgentState, Outline schema (Zod)
        │   ├── plannerAgent.ts   # Gemini Pro: outline + style retrieval
        │   ├── researcherAgent.ts # Gemini Flash: Tavily + Zyte scraping
        │   ├── writerAgent.ts    # Gemini Flash: chapter drafting
        │   ├── reviewerAgent.ts  # Gemini Pro: style compliance + hallucination check
        │   └── graph.ts          # LangGraph StateGraph orchestration
        ├── lib/
        │   ├── gemini.ts         # @google/genai wrapper (Pro + Flash + Embeddings)
        │   ├── pinecone.ts       # Vector DB with style_id metadata filtering
        │   └── appwrite.ts       # Job tracking + file storage
        ├── routes/
        │   ├── jobs.ts           # POST /api/jobs, GET /api/jobs/:id
        │   ├── admin.ts          # POST /api/admin/upload
        │   └── websocket.ts      # WebSocket manager for real-time updates
        ├── scripts/
        │   └── ingestDocuments.ts # CLI: chunk → embed → upsert to Pinecone
        └── index.ts              # Express server + WebSocket init
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 19, TailwindCSS |
| Backend | Node.js, TypeScript, Express |
| Agent Engine | LangGraph.js (`@langchain/langgraph`) |
| LLM Orchestration | Gemini 2.5 Pro (`gemini-2.5-pro`) |
| LLM Research/Writing | Gemini 2.0 Flash (`gemini-2.0-flash`) |
| Embeddings | Gemini `text-embedding-004` |
| Vector Database | Pinecone (with `style_id` metadata filtering) |
| Backend/BaaS | Appwrite (job tracking, document storage) |
| Web Search | Tavily Search API |
| Deep Scraping | Zyte API (anti-bot bypass) |
| Real-time Updates | WebSockets (`ws`) + HTTP polling fallback |

## Multi-Agent Pipeline

```
User Input (topic + style_id)
         │
    ┌────▼────┐
    │ Planner │  ← Gemini Pro
    │  Agent  │    Queries Pinecone (filter: style_id)
    └────┬────┘    Outputs structured JSON chapter outline
         │
    ┌────▼──────┐
    │ Researcher│  ← Gemini Flash
    │   Agent   │    Tavily search + Zyte deep scraping
    └────┬──────┘    Compiles raw factual markdown
         │
    ┌────▼───┐
    │ Writer │  ← Gemini Flash
    │  Agent │    Drafts each chapter with inline citations
    └────┬───┘    Loops until all chapters complete
         │
    ┌────▼────┐
    │Reviewer │  ← Gemini Pro
    │  Agent  │    Style compliance check + hallucination detection
    └────┬────┘    Routes back to Writer OR approves
         │
    Final Document
```

## Quick Start

### 1. Clone and install dependencies

```bash
git clone https://github.com/hackerdy/ProjectAi
cd ProjectAi

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 2. Configure environment variables

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

# Frontend
cp frontend/.env.example frontend/.env.local
```

Required environment variables:
- `GEMINI_API_KEY` — Google AI Studio API key
- `TAVILY_API_KEY` — Tavily Search API key
- `ZYTE_API_KEY` — Zyte API key for deep scraping
- `APPWRITE_PROJECT_ID` — Appwrite project ID
- `APPWRITE_API_KEY` — Appwrite API key
- `PINECONE_API_KEY` — Pinecone API key

### 3. Ingest reference documents (Knowledge Base)

```bash
cd backend

# Single file
npm run ingest -- --file ./references/harvard_business.pdf \
  --style_id harvard_business \
  --style_name "Harvard Business School"

# Batch mode with config file
npm run ingest -- --config ./ingest-config.json
```

Example `ingest-config.json`:
```json
{
  "documents": [
    {
      "file": "./references/harvard_business.pdf",
      "style_id": "harvard_business",
      "style_name": "Harvard Business School",
      "description": "HBS case study format with in-text citations"
    },
    {
      "file": "./references/cs_thesis.pdf",
      "style_id": "computer_science_thesis",
      "style_name": "Computer Science Thesis",
      "description": "IEEE-style CS thesis with numbered references"
    }
  ]
}
```

### 4. Start development servers

```bash
# Terminal 1: Backend (port 4000)
cd backend && npm run dev

# Terminal 2: Frontend (port 3000)
cd frontend && npm run dev
```

### 5. Production deployment (Ubuntu daemon)

```bash
# Build backend
cd backend && npm run build

# Start as daemon with PM2
npm install -g pm2
pm2 start dist/index.js --name projectai-backend --max-memory-restart 1G
pm2 save
pm2 startup

# Build and serve frontend
cd frontend && npm run build
# Deploy .next/ to Vercel or self-host with:
npx serve .next
```

## API Reference

### Create a job
```http
POST /api/jobs
Content-Type: application/json

{
  "topic": "The impact of AI on supply chain management",
  "style_id": "harvard_business"
}
```

### Get job status
```http
GET /api/jobs/:jobId
```

### Real-time updates (WebSocket)
```javascript
const ws = new WebSocket(`ws://localhost:4000/ws?job_id=${jobId}`);
ws.onmessage = (event) => {
  const { type, status, current_agent, final_document } = JSON.parse(event.data);
};
```

### Admin: Upload reference document
```http
POST /api/admin/upload
Content-Type: multipart/form-data

document: <file>
style_id: harvard_business
style_name: Harvard Business School
description: HBS case study format
```
