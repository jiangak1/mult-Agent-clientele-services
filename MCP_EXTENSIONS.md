# MCP (Model Context Protocol) Extensions

## Overview

The Customer Service Platform exposes its multi-agent system and services as MCP tools, resources, and prompts. This allows external AI systems (Claude Desktop, Codex, etc.) to interact with the platform through the standard MCP protocol.

## Architecture

```
┌──────────────────────────────────────┐
│          MCP Client                   │
│  (Claude Desktop / IDE / Custom)      │
└──────────────┬───────────────────────┘
               │ MCP Protocol (stdio/SSE)
┌──────────────▼───────────────────────┐
│          MCP Server (port 3001)       │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │  MCP Resource Handlers           │ │
│  │  - conversations://              │ │
│  │  - knowledge://                  │ │
│  │  - complaints://                 │ │
│  │  - products://                   │ │
│  └──────────────────────────────────┘ │
│  ┌──────────────────────────────────┐ │
│  │  MCP Tool Handlers               │ │
│  │  - csp.classify_intent           │ │
│  │  - csp.presale_query             │ │
│  │  - csp.aftersale_query           │ │
│  │  - csp.analyze_image             │ │
│  │  - csp.check_inventory           │ │
│  │  - csp.search_cases              │ │
│  └──────────────────────────────────┘ │
│  ┌──────────────────────────────────┐ │
│  │  MCP Prompt Handlers             │ │
│  │  - csp.presale                   │ │
│  │  - csp.aftersale                 │ │
│  │  - csp.supervisor                │ │
│  └──────────────────────────────────┘ │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│     Customer Service Platform        │
│     (Agents, RAG, Vector Store)      │
└──────────────────────────────────────┘
```

## MCP Tools

### 1. `csp.classify_intent`

Classify a customer message into intent categories.

**Input:**
```json
{
  "message": "string",
  "tenantId": "string"
}
```

**Output:**
```json
{
  "category": "presale|aftersale|general_inquiry|technical_support",
  "subIntent": "string",
  "confidence": 0.95,
  "entities": {}
}
```

---

### 2. `csp.presale_query`

Process a presale inquiry through the full pipeline (vector search + inventory + RAG).

**Input:**
```json
{
  "query": "string",
  "tenantId": "string",
  "userId": "string (optional)",
  "topK": 5
}
```

**Output:**
```json
{
  "content": "Full RAG-generated response",
  "sources": [{"id": "string", "content": "string", "score": 0.92}],
  "recommendations": [{"type": "product", "title": "string", "description": "string"}],
  "inventory": {"products": [], "total": 0}
}
```

---

### 3. `csp.aftersale_query`

Process an aftersale inquiry (complaint search + image analysis + RAG).

**Input:**
```json
{
  "query": "string",
  "tenantId": "string",
  "userId": "string (optional)",
  "imageUrls": ["string (optional)"],
  "topK": 5
}
```

**Output:**
```json
{
  "content": "Full RAG-generated response",
  "sources": [{"id": "string", "content": "string", "score": 0.88}],
  "similarCases": [{"id": "string", "title": "string", "severity": "string"}],
  "imageAnalyses": ["string"],
  "shouldEscalate": false
}
```

---

### 4. `csp.analyze_image`

Analyze a product image for defects and quality issues.

**Input:**
```json
{
  "imageUrl": "string (URL or base64)",
  "prompt": "string (optional analysis prompt)",
  "modelType": "openai|claude|local"
}
```

**Output:**
```json
{
  "description": "Detailed image description",
  "tags": ["scratch", "screen", "crack"],
  "defects": [{"type": "string", "location": "string", "severity": "string"}],
  "confidence": 0.89
}
```

---

### 5. `csp.check_inventory`

Query product inventory by SKU or keyword.

**Input:**
```json
{
  "tenantId": "string",
  "sku": "string (optional)",
  "keyword": "string (optional)",
  "category": "string (optional)"
}
```

**Output:**
```json
{
  "products": [{"sku": "string", "name": "string", "stock": 42, "price": "99.99"}],
  "total": 1
}
```

---

### 6. `csp.search_cases`

Search historical complaint/support cases (vector search).

**Input:**
```json
{
  "tenantId": "string",
  "query": "string",
  "topK": 5
}
```

**Output:**
```json
{
  "cases": [{"id": "string", "title": "string", "description": "string", "severity": "string", "resolution": "string"}]
}
```

---

### 7. `csp.list_agents`

List all registered agents and their capabilities.

**Output:**
```json
{
  "agents": [{"type": "string", "name": "string", "tools": ["string"]}]
}
```

---

## MCP Resources

| URI Pattern | Description | Returns |
|-------------|-------------|---------|
| `conversations://{tenantId}` | Active conversations | JSON array |
| `conversations://{tenantId}/{id}` | Single conversation with messages | JSON object |
| `knowledge://{tenantId}` | Knowledge base entries | JSON array |
| `complaints://{tenantId}` | Historical complaint cases | JSON array |
| `products://{tenantId}` | Product inventory | JSON array |
| `agents://{tenantId}` | Agent configurations | JSON array |
| `metrics://{tenantId}` | Agent performance metrics | JSON object |

## MCP Prompts

### `csp.presale`
Pre-configured prompt template for presale scenarios.
```
Arguments: { query: string, tenantName: string }
Returns: Full presale agent prompt with RAG context injected
```

### `csp.aftersale`
Pre-configured prompt template for aftersale/complaint scenarios.
```
Arguments: { query: string, tenantName: string, imageUrls?: string[] }
Returns: Full aftersale agent prompt with case context injected
```

### `csp.supervisor`
Pre-configured prompt template for escalation review.
```
Arguments: { conversationId: string, reason: string }
Returns: Full supervisor review prompt with conversation context
```

## MCP Server Implementation

```typescript
// mcp/server.ts — Implementation skeleton
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "csp-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "csp.classify_intent",
      description: "Classify customer message intent",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          tenantId: { type: "string" },
        },
        required: ["message", "tenantId"],
      },
    },
    // ... additional tools
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case "csp.classify_intent":
      // Delegate to IntentClassifierAgent
      break;
    case "csp.presale_query":
      // Delegate to PresaleAgent + RAG pipeline
      break;
    // ... handle other tools
  }
});

// Transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

## MCP Client Configuration (Claude Desktop)

```json
{
  "mcpServers": {
    "csp": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "env": {
        "CSP_API_URL": "http://localhost:3000",
        "OPENAI_API_KEY": "${OPENAI_API_KEY}"
      }
    }
  }
}
```

## Extension Points

1. **Custom Tools**: Add new entries to `ListToolsRequestSchema` handler
2. **Custom Resources**: Add URI patterns to `ListResourcesRequestSchema` handler
3. **Multi-Tenant**: Each tool already accepts `tenantId` parameter
4. **Streaming**: Use MCP SSE transport for real-time agent updates
5. **Authentication**: Add OAuth token validation in transport layer
