// ============================================
// Core Type Definitions
// ============================================

export interface TenantContext {
  tenantId: string;
  userId?: string;
  bypassRls?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "agent";
  agentType?: AgentType;
  content: string;
  metadata: MessageMetadata;
  createdAt: Date;
}

export interface MessageMetadata {
  intent?: string;
  subIntent?: string;
  confidence?: number;
  sources?: Source[];
  recommendations?: Recommendation[];
  imageUrl?: string;
  processingTime?: number;
  [key: string]: unknown;
}

export interface Source {
  id: string;
  title: string;
  content: string;
  score: number;
  source: string;
}

export interface Recommendation {
  id: string;
  type: "product" | "solution" | "faq";
  title: string;
  description: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ============================================
// Agent Types
// ============================================
export type AgentType =
  | "intent_classifier"
  | "presale"
  | "aftersale"
  | "supervisor"
  | string; // extensible

export type IntentCategory =
  | "presale"
  | "aftersale"
  | "general_inquiry"
  | "complaint"
  | "technical_support";

export interface IntentResult {
  category: IntentCategory;
  subIntent: string;
  confidence: number;
  entities: Record<string, string>;
}

export interface AgentResult {
  agentType: AgentType;
  content: string;
  metadata: MessageMetadata;
  nextAgent?: AgentType;
  shouldEscalate?: boolean;
}

export interface AgentContext {
  tenantId: string;
  userId: string;
  conversationId: string;
  message: string;
  history: ChatMessage[];
  intent?: IntentResult;
  imageUrls?: string[];
  metadata: Record<string, unknown>;
}

// ============================================
// CV Adapter Types
// ============================================
export interface CVModelAdapter {
  analyze(imageUrl: string, prompt: string): Promise<CVResult>;
  analyzeBatch(requests: CVRequest[]): Promise<CVResult[]>;
}

export interface CVResult {
  description: string;
  tags: string[];
  defects: CVDefect[];
  confidence: number;
  rawResponse?: unknown;
}

export interface CVDefect {
  type: string;
  location: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface CVRequest {
  imageUrl: string;
  prompt?: string;
  context?: Record<string, unknown>;
}

// ============================================
// LangGraph Types
// ============================================
export interface GraphState {
  messages: ChatMessage[];
  intent: IntentResult | null;
  agentResults: Map<AgentType, AgentResult>;
  currentAgent: AgentType;
  nextAgent: AgentType | null;
  shouldEscalate: boolean;
  context: AgentContext;
  error: string | null;
}

export interface GraphConfig {
  tenantId: string;
  userId: string;
  conversationId: string;
  metadata: Record<string, unknown>;
}

// ============================================
// API Types
// ============================================
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface StreamEvent {
  type: "message" | "agent_switch" | "error" | "done";
  data: unknown;
  conversationId: string;
  timestamp: string;
}

// ============================================
// Memory Types
// ============================================
export interface MemoryEntry {
  key: string;
  value: unknown;
  ttl?: number;
}

export type MemoryNamespace = "user_preferences" | "conversation_history" | "complaint_context" | "product_interest";
