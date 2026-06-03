import type { AgentContext, AgentResult, AgentType } from "@/types";

export interface AgentCapability {
  name: string;
  description: string;
  tools: string[];
}

/**
 * Base Agent — all agents extend this.
 * Pluggable architecture: register new agents via AgentRegistry.
 */
export abstract class BaseAgent {
  abstract readonly type: AgentType;
  abstract readonly capabilities: AgentCapability;

  /** Execute the agent's logic */
  abstract execute(ctx: AgentContext): Promise<AgentResult>;

  /** Whether this agent can handle the given context */
  abstract canHandle(ctx: AgentContext): Promise<boolean>;

  /** Agent-specific system prompt */
  abstract get systemPrompt(): string;

  /** Handler name for observability */
  get name(): string {
    return this.type;
  }
}

// ============================================
// Agent Registry (Pluggable)
// ============================================
export class AgentRegistry {
  private static agents = new Map<AgentType, BaseAgent>();

  static register(agent: BaseAgent): void {
    AgentRegistry.agents.set(agent.type, agent);
  }

  static unregister(type: AgentType): void {
    AgentRegistry.agents.delete(type);
  }

  static get(type: AgentType): BaseAgent | undefined {
    return AgentRegistry.agents.get(type);
  }

  static getAll(): BaseAgent[] {
    return Array.from(AgentRegistry.agents.values());
  }

  static findByCapability(capability: string): BaseAgent[] {
    return AgentRegistry.getAll().filter(
      (a) => a.capabilities.tools.includes(capability),
    );
  }
}
