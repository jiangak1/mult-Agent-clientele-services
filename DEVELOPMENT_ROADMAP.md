# Development Roadmap — Customer Service Platform

## Phase 0: Foundation (Week 1-2)

### Environment Setup
- [ ] Install Docker Desktop, configure `docker compose up`
- [ ] Run `npm install` and `npx prisma generate`
- [ ] Initialize PostgreSQL: `npx prisma migrate dev --name init`
- [ ] Run RLS init script: `psql -U csp_admin -d customer_service -f prisma/init.sql`
- [ ] Seed demo data: `npm run prisma:seed`

### Core Infrastructure
- [ ] Verify Redis connectivity (`redis-cli ping`)
- [ ] Verify Milvus connectivity (check `http://localhost:9091/healthz`)
- [ ] Set up `.env.local` from `.env.example`
- [ ] Verify `npm run dev` starts without errors
- [ ] Verify `npm run server` starts Socket.IO server

### Tenant Setup
- [ ] Create demo tenant in PostgreSQL
- [ ] Populate `KnowledgeBase` with 50+ FAQ entries with embeddings
- [ ] Populate `ComplaintCase` with 30+ historical cases with embeddings
- [ ] Populate `Product` with 20+ inventory items
- [ ] Test tenant isolation: switch `x-tenant-id` header, verify data separation

---

## Phase 1: Single-Tenant MVP (Week 3-4)

### Agent Pipeline
- [ ] Integrate OpenAI API key, test LLM connectivity
- [ ] Verify Intent Classifier returns correct categories
- [ ] Test Presale Agent: product inquiry → vector search → RAG response
- [ ] Test AfterSale Agent: complaint → similar case search → RAG response
- [ ] Test Supervisor Agent escalation logic
- [ ] Monitor agent routing in LangGraph workflow

### Frontend
- [ ] Verify PWA manifest and install prompt
- [ ] Test chat in REST mode (fallback)
- [ ] Test chat in Socket.IO real-time mode
- [ ] Verify image upload flow: upload → CV analysis → response
- [ ] Test agent panel display
- [ ] Verify glassmorphism rendering across browsers
- [ ] Mobile responsive layout testing

### Data Flow
- [ ] Verify conversation persistence
- [ ] Verify long-term memory storage per user
- [ ] Check vector search relevance (cosine threshold tuning)
- [ ] Verify Redis caching hit/miss rates

---

## Phase 2: Multi-Tenant Production (Week 5-6)

### Security Hardening
- [ ] Implement JWT authentication middleware
- [ ] Replace demo headers with real JWT tokens
- [ ] Enable and test RLS policies for all tables
- [ ] Add rate limiting per tenant (Redis-based)
- [ ] Input sanitization and validation (Zod schemas)
- [ ] File upload virus scanning integration
- [ ] Audit log implementation

### Performance
- [ ] Connection pooling for PostgreSQL (PgBouncer or Prisma pool)
- [ ] Redis cluster configuration (if needed)
- [ ] Milvus index optimization (IVF_FLAT → HNSW)
- [ ] Edge caching for static assets
- [ ] Bundle size analysis (`@next/bundle-analyzer`)
- [ ] LLM response streaming with Server-Sent Events

### Observability
- [ ] LangSmith tracing integration
- [ ] OpenTelemetry instrumentation
- [ ] Grafana dashboard for agent metrics
- [ ] Error tracking (Sentry integration)
- [ ] Conversation analytics pipeline

---

## Phase 3: Advanced Features (Week 7-8)

### Agent Enhancements
- [ ] Multi-turn conversation memory (beyond single RAG)
- [ ] Agent handoff with context preservation
- [ ] Intent re-classification mid-conversation
- [ ] Custom agent plugin system (hot-reload)
- [ ] Agent A/B testing framework

### CV Model Improvements
- [ ] Add Claude Vision adapter
- [ ] Add local model adapter (vLLM/ollama)
- [ ] Image pre-processing pipeline (resize, normalize)
- [ ] Multi-image comparison for defect analysis
- [ ] OCR for screenshot text extraction

### Integrations
- [ ] Webhook system for CRM/ERP integration
- [ ] Email channel (receive/send via SMTP/IMAP)
- [ ] WeChat Official Account integration
- [ ] Slack/Teams connector
- [ ] Zendesk/Salesforce ticket sync

---

## Phase 4: Scale & Optimize (Week 9-10)

### Scaling
- [ ] Horizontal scaling with Redis pub/sub for Socket.IO
- [ ] Milvus cluster (read replicas)
- [ ] PostgreSQL read replicas
- [ ] CDN for uploaded files (S3/MinIO)
- [ ] Load testing with k6/Artillery

### Optimization
- [ ] LLM prompt caching (Anthropic prompt cache)
- [ ] Embedding pre-computation for FAQ
- [ ] Response template system for common queries
- [ ] Incremental vector index updates
- [ ] Cold start optimization (warm-up scripts)

### MCP Extension
- [ ] Implement MCP server (Model Context Protocol)
- [ ] Expose agents as MCP tools
- [ ] MCP resource listing (conversations, cases, products)
- [ ] MCP prompts for common customer service scenarios
- [ ] Multi-MCP server discovery

---

## Phase 5: Compliance & Launch (Week 11-12)

### Compliance
- [ ] Data retention policy implementation
- [ ] GDPR data export/deletion
- [ ] PII masking in logs
- [ ] Encryption at rest verification
- [ ] Penetration testing

### Launch
- [ ] Production environment provisioning
- [ ] Database backup strategy
- [ ] Disaster recovery plan
- [ ] Runbook documentation
- [ ] Training: agent configuration per tenant

---

## Dependencies

| Service | Version | Purpose |
|---------|---------|---------|
| PostgreSQL | 16 + pgvector | Primary DB + vector search fallback |
| Redis | 7.x | Caching, session, rate limiting |
| Milvus | 2.4.x | Vector search (primary) |
| Next.js | 15.x | Frontend + API routes |
| LangChain/LangGraph | 0.3.x / 0.2.x | Agent workflow orchestration |
| Socket.IO | 4.8.x | Real-time communication |
| Prisma | 6.x | ORM + migrations |

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM latency > 3s | High | Streaming, caching, timeout fallback |
| Milvus instability | Medium | pgvector as fallback index |
| Tenant data leak | Critical | RLS + integration tests per tenant |
| Socket.IO scaling | Medium | Redis adapter for horizontal scaling |
| CV model cost | Medium | Local model fallback, image compression |
