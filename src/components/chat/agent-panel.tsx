"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";

interface AgentInfo {
  type: string;
  name: string;
  capabilities: {
    name: string;
    description: string;
    tools: string[];
  };
}

interface AgentPanelProps {
  onClose: () => void;
}

export function AgentPanel({ onClose }: AgentPanelProps) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setAgents(data.data);
      })
      .catch(() => {
        setAgents([
          {
            type: "intent_classifier",
            name: "Intent Classifier",
            capabilities: {
              name: "Intent Classification",
              description: "Classifies user messages with confidence scores",
              tools: ["intent_detection", "entity_extraction"],
            },
          },
          {
            type: "presale",
            name: "Presale Agent",
            capabilities: {
              name: "Presale & Product Consultation",
              description: "Product inquiries, recommendations, pre-purchase questions",
              tools: ["vector_search", "inventory_query", "recommendation", "rag_response"],
            },
          },
          {
            type: "aftersale",
            name: "AfterSale Agent",
            capabilities: {
              name: "Aftersale & Complaint Handling",
              description: "Complaints, returns, technical issues, aftersale support",
              tools: ["image_analysis", "complaint_search", "long_term_memory", "rag_response"],
            },
          },
          {
            type: "supervisor",
            name: "Supervisor Agent",
            capabilities: {
              name: "Supervisor & Escalation",
              description: "Handles escalated cases, coordinates agents, ensures quality",
              tools: ["escalation_handling", "quality_review", "agent_coordination", "human_handoff"],
            },
          },
        ]);
      });
  }, []);

  const workflowSteps = [
    t("agent.intentClassifier") as string,
    t("agent.presaleAftersale") as string,
    t("agent.supervisor") as string,
  ];

  return (
    <aside className="glass-elevated" style={{
      width: 320,
      height: "100%",
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid var(--glass-border)",
      borderRadius: 0,
      flexShrink: 0,
    }}>
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--glass-border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{t("agent.monitor")}</div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 18,
            padding: "4px 8px",
          }}
        >
          x
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
        <div style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 16,
          lineHeight: 1.5,
        }}>
          {t("agent.description")}
        </div>

        {/* Workflow Visualization */}
        <div style={{
          padding: 16,
          borderRadius: 12,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid var(--glass-border)",
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            {t("agent.workflowPipeline")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0, fontSize: 12 }}>
            {workflowSteps.map((step, i) => (
              <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: `rgba(108, 140, 255, ${0.3 + i * 0.2})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                <div style={{ padding: "8px 0" }}>{step}</div>
                {i < 2 && (
                  <div style={{
                    width: 2,
                    height: 20,
                    background: "var(--glass-border)",
                    marginLeft: 11,
                  }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Registered Agents */}
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 12,
        }}>
          {t("agent.registeredAgents")} ({agents.length})
        </div>

        {agents.map((agent) => (
          <div
            key={agent.type}
            className="glass"
            style={{
              padding: "12px 14px",
              marginBottom: 8,
              borderRadius: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{agent.name}</span>
              <span className="agent-badge">{agent.type}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
              {agent.capabilities.description}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {agent.capabilities.tools.map((tool) => (
                <span
                  key={tool}
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "var(--text-muted)",
                  }}
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
