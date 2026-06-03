/**
 * Agent Barrel Export
 * Import this file to ensure all agents are registered.
 * Add new agents here to make them available to the system.
 */
export { BaseAgent, AgentRegistry } from "./base-agent";
export { IntentClassifierAgent } from "./intent-agent";
export { PresaleAgent } from "./presale-agent";
export { AfterSaleAgent } from "./aftersale-agent";
export { SupervisorAgent } from "./supervisor-agent";

// Re-import to trigger auto-registration side effects
import "./intent-agent";
import "./presale-agent";
import "./aftersale-agent";
import "./supervisor-agent";
