/**
 * MCP Server — Model Context Protocol Extension
 *
 * Exposes the Customer Service Platform agent system
 * as MCP tools, resources, and prompts for external AI clients.
 *
 * Usage:
 *   npx tsx mcp/server.ts
 *
 * Configure in Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "csp": {
 *         "command": "npx",
 *         "args": ["tsx", "mcp/server.ts"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CSP_API_URL = process.env.CSP_API_URL ?? "http://localhost:3000/api";

const server = new Server(
  {
    name: "csp-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
);

// ============================================
// Tool Definitions
// ============================================
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "csp.classify_intent",
      description: "Classify a customer service message into intent categories (presale, aftersale, general_inquiry, technical_support)",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Customer message to classify" },
          tenantId: { type: "string", description: "Tenant identifier" },
        },
        required: ["message", "tenantId"],
      },
    },
    {
      name: "csp.presale_query",
      description: "Process a presale inquiry through the full pipeline: vector search + inventory + recommendations + RAG response",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Customer presale question" },
          tenantId: { type: "string" },
          userId: { type: "string", description: "Optional user ID for memory" },
          topK: { type: "number", description: "Number of results (default 5)" },
        },
        required: ["query", "tenantId"],
      },
    },
    {
      name: "csp.aftersale_query",
      description: "Process an aftersale/complaint inquiry: historical case search + image analysis + RAG response",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Customer complaint description" },
          tenantId: { type: "string" },
          userId: { type: "string" },
          imageUrls: { type: "array", items: { type: "string" }, description: "Product images for analysis" },
        },
        required: ["query", "tenantId"],
      },
    },
    {
      name: "csp.check_inventory",
      description: "Check product inventory by SKU or keyword search",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: { type: "string" },
          sku: { type: "string", description: "Product SKU" },
          keyword: { type: "string", description: "Search keyword" },
          category: { type: "string" },
        },
        required: ["tenantId"],
      },
    },
    {
      name: "csp.search_cases",
      description: "Search historical complaint/support cases using vector similarity",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: { type: "string" },
          query: { type: "string" },
          topK: { type: "number" },
        },
        required: ["tenantId", "query"],
      },
    },
    {
      name: "csp.list_agents",
      description: "List all registered customer service agents and their capabilities",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

// ============================================
// Tool Handlers
// ============================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "csp.classify_intent": {
      const res = await fetch(`${CSP_API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": args?.tenantId as string, "x-user-id": "mcp-system" },
        body: JSON.stringify({ message: args?.message, conversationId: undefined }),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data.data?.intent ?? {}, null, 2) }] };
    }

    case "csp.presale_query": {
      const res = await fetch(`${CSP_API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": args?.tenantId as string, "x-user-id": (args?.userId as string) ?? "mcp-system" },
        body: JSON.stringify({ message: args?.query }),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data.data ?? {}, null, 2) }] };
    }

    case "csp.aftersale_query": {
      const res = await fetch(`${CSP_API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": args?.tenantId as string, "x-user-id": (args?.userId as string) ?? "mcp-system" },
        body: JSON.stringify({ message: args?.query, imageUrls: args?.imageUrls }),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data.data ?? {}, null, 2) }] };
    }

    case "csp.check_inventory": {
      const url = `${CSP_API_URL}/inventory?${new URLSearchParams(args as Record<string, string>).toString()}`;
      const res = await fetch(url, {
        headers: { "x-tenant-id": args?.tenantId as string, "x-user-id": "mcp-system" },
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data.data ?? data, null, 2) }] };
    }

    case "csp.search_cases": {
      const res = await fetch(`${CSP_API_URL}/complaints/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": args?.tenantId as string },
        body: JSON.stringify({ query: args?.query, topK: args?.topK ?? 5 }),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data.data ?? data, null, 2) }] };
    }

    case "csp.list_agents": {
      const res = await fetch(`${CSP_API_URL}/agents`);
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data.data ?? [], null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ============================================
// Resource Definitions
// ============================================
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "agents://registered", name: "Registered Agents", mimeType: "application/json", description: "List of all registered agents" },
    { uri: "conversations://active", name: "Active Conversations", mimeType: "application/json", description: "Currently active conversations" },
    { uri: "knowledge://base", name: "Knowledge Base", mimeType: "application/json", description: "Knowledge base entries" },
    { uri: "complaints://history", name: "Complaint History", mimeType: "application/json", description: "Historical complaint cases" },
    { uri: "products://inventory", name: "Product Inventory", mimeType: "application/json", description: "Current product inventory" },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  // Map URIs to API endpoints (simplified — in production, add proper routing)
  const endpointMap: Record<string, string> = {
    "agents://registered": "/agents",
    "conversations://active": "/conversations",
    "knowledge://base": "/knowledge",
    "complaints://history": "/complaints",
    "products://inventory": "/inventory",
  };

  const endpoint = endpointMap[uri];
  if (!endpoint) throw new Error(`Unknown resource: ${uri}`);

  const res = await fetch(`${CSP_API_URL}${endpoint}`, {
    headers: { "x-tenant-id": "default", "x-user-id": "mcp-system" },
  });
  const data = await res.json();

  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
});

// ============================================
// Prompt Definitions
// ============================================
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "csp.presale",
      description: "Pre-built prompt for presale customer service",
      arguments: [
        { name: "query", description: "Customer question", required: true },
        { name: "tenantName", description: "Business/tenant name", required: true },
      ],
    },
    {
      name: "csp.aftersale",
      description: "Pre-built prompt for aftersale complaint handling",
      arguments: [
        { name: "query", description: "Customer complaint", required: true },
        { name: "tenantName", description: "Business/tenant name", required: true },
      ],
    },
    {
      name: "csp.supervisor",
      description: "Pre-built prompt for escalation review",
      arguments: [
        { name: "conversationId", description: "Escalated conversation ID", required: true },
        { name: "reason", description: "Escalation reason", required: true },
      ],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "csp.presale": {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `You are a professional presale agent for ${args?.tenantName ?? "a business"}.

Customer Question: ${args?.query ?? ""}

Please provide a helpful, accurate response. Check the knowledge base for product details and the inventory system for current availability. Recommend complementary products when appropriate.

Respond in a professional yet friendly tone.`,
          },
        }],
      };
    }
    case "csp.aftersale": {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `You are a professional aftersale agent for ${args?.tenantName ?? "a business"}.

Customer Complaint: ${args?.query ?? ""}

Please handle this with empathy and professionalism. Search for similar historical cases and their resolutions. If product images were provided, analyze them for defects. Provide clear next steps and expected timelines.`,
          },
        }],
      };
    }
    case "csp.supervisor": {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `ESCALATION REVIEW

Conversation: ${args?.conversationId ?? "unknown"}
Reason for escalation: ${args?.reason ?? "not specified"}

Review the full conversation history. Make a determination:
1. Can this be resolved automatically?
2. Does it require human intervention?
3. Are there policy exceptions that should be applied?

Provide your decision with reasoning.`,
          },
        }],
      };
    }
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// ============================================
// Start Server
// ============================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] CSP MCP Server running on stdio");
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
