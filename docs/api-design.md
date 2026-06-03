# API Design — Customer Service Platform

## Base URL

```
Development: http://localhost:3000/api
Production:  https://{tenant}.csp.example.com/api
```

## Authentication

All requests require tenant context headers:

```http
x-tenant-id: {tenant_id}
x-user-id: {user_id}
Authorization: Bearer {jwt_token}
```

---

## Endpoints

### 1. Chat

#### POST `/api/chat`

Send a message and get a response from the multi-agent system.

**Request:**
```json
{
  "message": "What's the price of iPhone 16 Pro?",
  "conversationId": "conv_abc123 (optional, creates new if omitted)",
  "imageUrls": ["https://cdn.example.com/uploads/img_001.jpg"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_abc123",
    "message": "The iPhone 16 Pro starts at ¥8,999 for the 256GB model...",
    "agentType": "presale",
    "intent": {
      "category": "presale",
      "subIntent": "pricing_inquiry",
      "confidence": 0.95
    },
    "metadata": {
      "sources": [{"id": "kb_1", "title": "iPhone 16 Specs", "score": 0.92}],
      "recommendations": [{"type": "product", "title": "iPhone 16 Pro 256GB", "score": 0.88}],
      "inventory": {"products": [{"sku": "IP16P-256", "name": "iPhone 16 Pro", "stock": 12, "price": "8999.00"}], "total": 1}
    },
    "shouldEscalate": false
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Error Response (400/500):**
```json
{
  "success": false,
  "error": "message is required",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### GET `/api/chat?conversationId={id}`

Get conversation history.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "msg_1",
      "role": "user",
      "agentType": null,
      "content": "What's the price?",
      "metadata": {},
      "createdAt": "2025-01-15T10:29:00.000Z"
    },
    {
      "id": "msg_2",
      "role": "assistant",
      "agentType": "presale",
      "content": "The price is...",
      "metadata": {"sources": [], "recommendations": []},
      "createdAt": "2025-01-15T10:29:05.000Z"
    }
  ]
}
```

---

### 2. Conversations

#### GET `/api/conversations?userId={id}`

List conversations for a user.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "conv_abc123",
      "intent": "presale",
      "status": "active",
      "updatedAt": "2025-01-15T10:30:00.000Z",
      "lastMessage": "What's the price of..."
    }
  ]
}
```

---

### 3. Agents

#### GET `/api/agents`

List registered agents and capabilities.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "type": "intent_classifier",
      "name": "Intent Classifier",
      "capabilities": {
        "name": "Intent Classification",
        "description": "Classifies user messages with confidence scores",
        "tools": ["intent_detection", "entity_extraction"]
      }
    },
    {
      "type": "presale",
      "name": "Presale Agent",
      "capabilities": {
        "name": "Presale & Product Consultation",
        "description": "Product inquiries, recommendations, pre-purchase",
        "tools": ["vector_search", "inventory_query", "recommendation", "rag_response"]
      }
    }
  ],
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

### 4. Upload

#### POST `/api/upload`

Upload images for CV analysis. Multipart form data.

**Request:** `multipart/form-data`
- `files`: One or more image files (max 10MB each)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "urls": ["/uploads/abc123.jpg", "/uploads/def456.png"]
  }
}
```

**Error (413):**
```json
{
  "success": false,
  "error": "File photo.jpg exceeds max size"
}
```

---

### 5. Inventory

#### GET `/api/inventory?sku={sku}&keyword={kw}&category={cat}`

Query product inventory (future extension).

#### GET `/api/inventory/stock?sku={sku}`

Check stock for a specific SKU (future extension).

---

### 6. Knowledge Base (Admin)

#### POST `/api/knowledge`

Add entry to knowledge base with vector indexing (future extension).

#### DELETE `/api/knowledge/{id}`

Remove knowledge base entry (future extension).

---

### 7. Complaints (Admin)

#### GET `/api/complaints?category={cat}&severity={sev}`

List complaint cases (future extension).

#### POST `/api/complaints/{id}/resolve`

Mark complaint case as resolved (future extension).

---

## Real-Time Events (Socket.IO)

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message` | `{ message, imageUrls?, conversationId? }` | Send a chat message |
| `chat:typing` | `{ conversationId, isTyping }` | Typing indicator |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `stream:event` | `StreamEvent` | Multi-agent processing events |
| `conversation:created` | `{ conversationId }` | New conversation created |
| `chat:typing` | `{ userId, conversationId, isTyping }` | Typing indicator broadcast |

### StreamEvent Types

```typescript
// Agent switch
{ type: "agent_switch", data: { from: "intent_classifier", to: "presale" } }

// Message chunk
{ type: "message", data: { content: "...", agentType: "presale", metadata: {} } }

// Processing complete
{ type: "done", data: { intent: {...}, shouldEscalate: false } }

// Error occurred
{ type: "error", data: { message: "Error description" } }
```

---

## Rate Limiting

| Endpoint | Window | Max Requests | Scope |
|----------|--------|--------------|-------|
| POST /api/chat | 60s | 30 | Per tenant+user |
| POST /api/upload | 60s | 10 | Per tenant+user |
| GET /api/* | 60s | 100 | Per tenant |
| Socket.IO messages | 60s | 60 | Per connection |

Rate limit headers:
```http
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 28
X-RateLimit-Reset: 1705314600
```

---

## Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid input |
| 401 | `UNAUTHORIZED` | Missing/invalid auth headers |
| 403 | `FORBIDDEN` | Tenant access denied |
| 404 | `NOT_FOUND` | Resource not found |
| 413 | `PAYLOAD_TOO_LARGE` | Upload exceeds size limit |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |
| 503 | `SERVICE_UNAVAILABLE` | LLM/DB/Vector store down |

## Versioning

API version is embedded in the URL path for future breaking changes:
```
/api/v1/chat    (current — v1 implied when omitted)
/api/v2/chat    (future)
```
