"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, Loader2, Terminal, AlertTriangle, ShieldCheck, Database, Wrench } from "lucide-react";
import { AgentEventData } from "@/lib/sse-client";
import { formatMs } from "@/lib/utils";

interface AgentTimelineProps {
  events: AgentEventData[];
  currentAgent?: string;
  isCompleted: boolean;
}

interface AgentState {
  id: string;
  name: string;
  description: string;
  icon: any;
  status: "pending" | "running" | "completed" | "failed";
  reasoningSteps: string[];
  toolCalls: string[];
  latencyMs?: number;
}

export function AgentTimeline({ events, currentAgent, isCompleted }: AgentTimelineProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>("security_auditor");

  // Derive status and steps per agent from events
  const agents: AgentState[] = [
    {
      id: "context_retriever",
      name: "Context Retriever",
      description: "Embeds repo files in pgvector, traces dependencies & symbol references",
      icon: Database,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
    },
    {
      id: "security_auditor",
      name: "Security & Bug Auditor",
      description: "Audits diff for SQLi, XSS, auth flaws, secrets, and anchors line coordinates",
      icon: ShieldCheck,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
    },
    {
      id: "test_generator",
      name: "Test Generator",
      description: "Generates reproduction & edge-case unit tests with syntax validation",
      icon: Terminal,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
    },
    {
      id: "synthesizer",
      name: "Synthesizer",
      description: "Computes overall risk score, executive summary, and final PR verdict",
      icon: Wrench,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
    },
  ];

  // Process events into agent states
  events.forEach((ev) => {
    const target = agents.find((a) => a.id === ev.agent);
    if (!target) return;

    if (ev.event_type === "node_started") {
      target.status = "running";
    } else if (ev.event_type === "reasoning" && ev.data?.step) {
      target.reasoningSteps.push(ev.data.step);
    } else if (ev.event_type === "tool_call" && ev.data?.tool) {
      target.toolCalls.push(`${ev.data.tool} (${JSON.stringify(ev.data)})`);
    } else if (ev.event_type === "node_finished") {
      target.status = "completed";
      if (ev.data?.latency_ms) target.latencyMs = ev.data.latency_ms;
    } else if (ev.event_type === "error") {
      target.status = "failed";
    }
  });

  // If completed, mark any running agents as completed
  if (isCompleted) {
    agents.forEach((a) => {
      if (a.status === "running") a.status = "completed";
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
          <span>Multi-Agent Orchestration</span>
          <span className="text-xs font-normal text-muted-foreground font-mono">({events.length} events)</span>
        </h3>
      </div>

      <div className="space-y-2">
        {agents.map((agent) => {
          const isExpanded = expandedAgent === agent.id;
          const Icon = agent.icon;

          return (
            <div
              key={agent.id}
              className={`rounded-lg border transition-all ${
                agent.status === "running"
                  ? "border-primary/50 bg-primary/5 shadow-sm"
                  : agent.status === "completed"
                  ? "border-border/60 bg-card/60"
                  : "border-border/30 bg-card/20 opacity-70"
              }`}
            >
              {/* Header Accordion */}
              <button
                type="button"
                onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                className="flex w-full items-center justify-between p-3.5 text-left"
              >
                <div className="flex items-center gap-3">
                  {/* Status Indicator */}
                  {agent.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
                  {agent.status === "running" && <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />}
                  {agent.status === "failed" && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
                  {agent.status === "pending" && <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />}

                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{agent.name}</span>
                      {agent.latencyMs ? (
                        <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground rounded bg-muted/60 px-1.5 py-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {formatMs(agent.latencyMs)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{agent.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {/* Collapsible Reasoning & Tool Execution Log */}
              {isExpanded && (
                <div className="border-t border-border/50 bg-background/50 p-3 space-y-2 text-xs">
                  {agent.reasoningSteps.length === 0 && agent.toolCalls.length === 0 ? (
                    <p className="text-muted-foreground italic text-[11px]">Awaiting agent activation...</p>
                  ) : (
                    <div className="space-y-1.5 font-mono text-[11px]">
                      {agent.reasoningSteps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-muted-foreground">
                          <span className="text-primary/70 shrink-0 select-none">›</span>
                          <span className="text-foreground/90">{step}</span>
                        </div>
                      ))}
                      {agent.toolCalls.map((call, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-blue-400/80 bg-blue-950/20 rounded p-1">
                          <span className="text-blue-400 shrink-0 font-bold select-none">[tool]</span>
                          <span className="truncate">{call}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
