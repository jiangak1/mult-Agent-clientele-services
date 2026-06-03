import type { GraphState, GraphConfig, AgentType, ChatMessage, IntentResult, AgentResult } from "@/types";
import { AgentRegistry } from "@/lib/agents/base-agent";
import { prisma, withTenant } from "@/lib/auth/db-client";

// Import agents to trigger registration
import "@/lib/agents";

// ============================================
// LangGraph-compatible Workflow Engine
// ============================================

type NodeFn = (state: GraphState) => Promise<Partial<GraphState>>;
type EdgeFn = (state: GraphState) => string;

class WorkflowGraph {
  private nodes = new Map<string, NodeFn>();
  private edges = new Map<string, EdgeFn>();
  private entryPoint: string | null = null;

  addNode(name: string, fn: NodeFn): this {
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.set(from, () => to);
    return this;
  }

  addConditionalEdge(from: string, router: EdgeFn): this {
    this.edges.set(from, router);
    return this;
  }

  setEntryPoint(name: string): this {
    this.entryPoint = name;
    return this;
  }

  async invoke(initialState: GraphState): Promise<GraphState> {
    let state = { ...initialState };
    let currentNode = this.entryPoint;

    if (!currentNode) throw new Error("Entry point not set");

    const maxSteps = 10;
    let steps = 0;

    while (currentNode && currentNode !== "__end__" && steps < maxSteps) {
      const nodeFn = this.nodes.get(currentNode);
      if (!nodeFn) throw new Error(`Node not found: ${currentNode}`);

      const update = await nodeFn(state);
      state = { ...state, ...update };

      const edgeFn = this.edges.get(currentNode);
      if (!edgeFn) break;

      currentNode = edgeFn(state);
      steps++;
    }

    return state;
  }
}

// ============================================
// Node Implementations
// ============================================

async function classifyIntentNode(state: GraphState): Promise<Partial<GraphState>> {
  const intentAgent = AgentRegistry.get("intent_classifier");
  if (!intentAgent) throw new Error("Intent agent not registered");

  if (state.intent) {
    return { currentAgent: "intent_classifier" };
  }

  const ctx = state.context;
  ctx.history = state.messages;

  // Handoff to agent
  const result = await intentAgent.execute(ctx);

  const intent: IntentResult = {
    category: (result.metadata.intent as IntentResult["category"]) ?? "general_inquiry",
    subIntent: result.metadata.subIntent as string ?? "unknown",
    confidence: (result.metadata.confidence as number) ?? 0.5,
    entities: {},
  };

  const agentResult: AgentResult = {
    agentType: "intent_classifier",
    content: JSON.stringify(intent),
    metadata: result.metadata,
    nextAgent: result.nextAgent,
  };

  const newResults = new Map(state.agentResults);
  newResults.set("intent_classifier", agentResult);

  return {
    intent,
    agentResults: newResults,
    currentAgent: "intent_classifier",
    nextAgent: result.nextAgent ?? null,
  };
}

async function presaleNode(state: GraphState): Promise<Partial<GraphState>> {
  const agent = AgentRegistry.get("presale");
  if (!agent) throw new Error("Presale agent not registered");

  const result = await agent.execute({
    ...state.context,
    intent: state.intent ?? undefined,
    history: state.messages,
  });

  const newMessages = [
    ...state.messages,
    {
      id: `msg_${Date.now()}`,
      conversationId: state.context.conversationId,
      role: "assistant" as const,
      agentType: "presale" as AgentType,
      content: result.content,
      metadata: result.metadata,
      createdAt: new Date(),
    },
  ];

  const newResults = new Map(state.agentResults);
  newResults.set("presale", result);

  return {
    messages: newMessages,
    agentResults: newResults,
    currentAgent: "presale",
    nextAgent: result.nextAgent ?? null,
    shouldEscalate: result.shouldEscalate ?? false,
  };
}

async function aftersaleNode(state: GraphState): Promise<Partial<GraphState>> {
  const agent = AgentRegistry.get("aftersale");
  if (!agent) throw new Error("Aftersale agent not registered");

  const result = await agent.execute({
    ...state.context,
    intent: state.intent ?? undefined,
    history: state.messages,
  });

  const newMessages = [
    ...state.messages,
    {
      id: `msg_${Date.now()}`,
      conversationId: state.context.conversationId,
      role: "assistant" as const,
      agentType: "aftersale" as AgentType,
      content: result.content,
      metadata: result.metadata,
      createdAt: new Date(),
    },
  ];

  const newResults = new Map(state.agentResults);
  newResults.set("aftersale", result);

  return {
    messages: newMessages,
    agentResults: newResults,
    currentAgent: "aftersale",
    nextAgent: result.nextAgent ?? null,
    shouldEscalate: result.shouldEscalate ?? false,
  };
}

async function supervisorNode(state: GraphState): Promise<Partial<GraphState>> {
  const agent = AgentRegistry.get("supervisor");
  if (!agent) throw new Error("Supervisor agent not registered");

  const result = await agent.execute({
    ...state.context,
    intent: state.intent ?? undefined,
    history: state.messages,
  });

  const newMessages = [
    ...state.messages,
    {
      id: `msg_${Date.now()}`,
      conversationId: state.context.conversationId,
      role: "assistant" as const,
      agentType: "supervisor" as AgentType,
      content: result.content,
      metadata: result.metadata,
      createdAt: new Date(),
    },
  ];

  const newResults = new Map(state.agentResults);
  newResults.set("supervisor", result);

  return {
    messages: newMessages,
    agentResults: newResults,
    currentAgent: "supervisor",
    nextAgent: null,
    shouldEscalate: result.shouldEscalate ?? false,
  };
}

// ============================================
// Routing Logic
// ============================================

function intentRouter(state: GraphState): string {
  if (!state.intent) return "supervisor";

  const route = IntentAgentClassifier.routeToAgent(state.intent);

  if (route === "aftersale") return "aftersale";
  return "presale";
}

function aftersaleRouter(state: GraphState): string {
  if (state.shouldEscalate) return "supervisor";
  return "__end__";
}

function presaleRouter(state: GraphState): string {
  if (state.shouldEscalate) return "supervisor";
  return "__end__";
}

function supervisorRouter(state: GraphState): string {
  return "__end__";
}

// Helper - referenced in intentRouter
import { IntentClassifierAgent } from "@/lib/agents/intent-agent";
const IntentAgentClassifier = { routeToAgent: IntentClassifierAgent.routeToAgent };

// ============================================
// Build the Workflow Graph
// ============================================
function buildGraph(): WorkflowGraph {
  const graph = new WorkflowGraph();

  graph.addNode("classify_intent", classifyIntentNode);
  graph.addNode("presale", presaleNode);
  graph.addNode("aftersale", aftersaleNode);
  graph.addNode("supervisor", supervisorNode);

  graph.setEntryPoint("classify_intent");

  graph.addConditionalEdge("classify_intent", intentRouter);
  graph.addConditionalEdge("presale", presaleRouter);
  graph.addConditionalEdge("aftersale", aftersaleRouter);
  graph.addConditionalEdge("supervisor", supervisorRouter);

  return graph;
}

// ============================================
// Public API: Process a customer message
// ============================================

export async function processMessage(
  config: GraphConfig,
  message: string,
  imageUrls?: string[],
): Promise<GraphState> {
  const tenantCtx = {
    tenantId: config.tenantId,
    userId: config.userId,
  };

  // Load conversation history from DB
  const history = await prisma.message.findMany({
    where: { conversationId: config.conversationId },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const messages: ChatMessage[] = history.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    role: m.role as ChatMessage["role"],
    agentType: m.agentType as AgentType | undefined,
    content: m.content,
    metadata: m.metadata as ChatMessage["metadata"],
    createdAt: m.createdAt,
  }));

  // Save user message
  const userMsg = await prisma.message.create({
    data: {
      conversationId: config.conversationId,
      role: "user",
      content: message,
      metadata: imageUrls ? { imageUrls } : {},
    },
  });

  messages.push({
    id: userMsg.id,
    conversationId: config.conversationId,
    role: "user",
    content: message,
    metadata: imageUrls ? { imageUrls } : {},
    createdAt: userMsg.createdAt,
  });

  const initialState: GraphState = {
    messages,
    intent: null,
    agentResults: new Map(),
    currentAgent: "intent_classifier",
    nextAgent: null,
    shouldEscalate: false,
    context: {
      tenantId: config.tenantId,
      userId: config.userId,
      conversationId: config.conversationId,
      message,
      history: messages,
      imageUrls,
      metadata: config.metadata,
    },
    error: null,
  };

  const graph = buildGraph();
  const result = await graph.invoke(initialState);

  // Save assistant messages
  const lastResult = result.agentResults.get(result.currentAgent);
  if (lastResult) {
    await prisma.message.create({
      data: {
        conversationId: config.conversationId,
        role: "assistant",
        agentType: result.currentAgent,
        content: lastResult.content,
        metadata: lastResult.metadata as object,
      },
    });
  }

  // Update conversation intent if classified
  if (result.intent) {
    await prisma.conversation.update({
      where: { id: config.conversationId },
      data: {
        intent: result.intent.category,
        subIntent: result.intent.subIntent,
      },
    });
  }

  return result;
}

export async function createConversation(
  tenantId: string,
  userId: string,
  channel = "web",
): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: { tenantId, userId, channel },
  });
  return conversation.id;
}

export { buildGraph, WorkflowGraph };
