# Multi-Agent Clientele Services

Enterprise Multi-Agent Customer Service Platform built with Next.js 15, LangChain/LangGraph, and modern AI infrastructure.

## Architecture

```
User → Next.js (PWA) → Socket.IO → LangGraph Agent Pipeline
                                    ├── Intent Classifier
                                    ├── Presale Agent (RAG + Vector Search)
                                    ├── AfterSale Agent (RAG + Complaint Matching)
                                    ├── CV Agent (Image Analysis)
                                    └── Supervisor Agent (Escalation)
                                         │
                                    ┌────┴────┐
                                    │  PostgreSQL + pgvector
                                    │  Redis (Cache / Session)
                                    │  Milvus (Vector DB)
                                    └─────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS, Framer Motion |
| Agent Framework | LangChain 0.3 + LangGraph 0.2 |
| Database | PostgreSQL 16 + pgvector |
| Vector Search | Milvus 2.4 (primary), pgvector (fallback) |
| Cache | Redis 7 |
| Real-time | Socket.IO 4.8 |
| ORM | Prisma 6 |
| CV Model | Adapter pattern (OpenAI / Claude / local) |
| LLM | DeepSeek (OpenAI-compatible) |
| Embedding | BGE-M3 (Ollama, 1024-dim) |

## Quick Start

### Prerequisites

- Docker Desktop
- Node.js 18+
- PowerShell (for setup scripts)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your API keys

# 3. Start infrastructure (PostgreSQL + Redis + Milvus)
docker compose up -d

# 4. Initialize database
npx prisma generate
npx prisma db push
npm run prisma:seed

# 5. Start development
npm run dev       # Next.js dev server (port 3000)
npm run server    # Socket.IO server
```

Or use the all-in-one script:

```bash
npm run quick
```

### Setup Scripts

```bash
npm run setup           # Full automated setup
npm run setup:bge-m3    # BGE-M3 embedding model setup
```

## Project Structure

```
src/
├── app/          # Next.js App Router pages & API routes
├── components/   # React components (chat, dashboard, agents)
├── hooks/        # Custom React hooks
├── lib/          # Utility libraries & agent logic
└── types/        # TypeScript type definitions

server/           # Socket.IO server
prisma/           # Database schema & migrations
mcp/              # MCP (Model Context Protocol) extensions
docs/             # Documentation
```

## Features

- **Multi-Agent Pipeline**: Intent classification → agent routing → RAG response generation
- **Real-time Chat**: Socket.IO-based messaging with typing indicators
- **Vector Search**: Semantic FAQ matching via Milvus/pgvector + BGE-M3 embeddings
- **CV Analysis**: Multi-model image analysis (product defect, screenshot OCR)
- **Multi-Tenant**: Row-Level Security with tenant isolation
- **PWA**: Installable, offline-capable progressive web app
- **MCP Extensions**: Model Context Protocol for agent tool exposure

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `MILVUS_ADDRESS` | Milvus server address |
| `OPENAI_API_KEY` | LLM API key (DeepSeek or OpenAI) |
| `OPENAI_BASE_URL` | LLM API endpoint |
| `EMBEDDING_BASE_URL` | Embedding model endpoint |
| `CV_MODEL_*` | Computer Vision model configuration |

## License

Private — All rights reserved.
