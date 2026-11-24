"use client";

import { useState } from "react";
import { 
  CheckCircle2, 
  ChevronDown, 
  ChevronRight, 
  Circle, 
  Clock, 
  Loader2, 
  Terminal, 
  AlertTriangle, 
  ShieldCheck, 
  Database, 
  Wrench, 
  Copy, 
  Check, 
  Filter,
  Sparkles,
  Activity
} from "lucide-react";
import { AgentEventData } from "@/lib/sse-client";
import { formatMs } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

interface AgentTimelineProps {
  events: AgentEventData[];
  currentAgent?: string;
  isCompleted: boolean;
}

interface AgentState {
  id: string;
  number: string;
  name: string;
  description: string;
  icon: any;
  status: "pending" | "running" | "completed" | "failed";
  reasoningSteps: string[];
  toolCalls: string[];
  latencyMs?: number;
  highlightColor: string;
  badgeTag: string;
}

export function AgentTimeline({ events, isCompleted }: AgentTimelineProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>("security_auditor");
  const [filterMode, setFilterMode] = useState<"all" | "reasoning" | "tools">("all");
  const [copiedLogs, setCopiedLogs] = useState(false);

  const agents: AgentState[] = [
    {
      id: "context_retriever",
      number: "NODE-01",
      name: "Context Retriever",
      description: "Embeds repo files in pgvector, traces dependencies & symbol references",
      icon: Database,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
      highlightColor: "text-cyan-400 border-cyan-500/30",
      badgeTag: "PGVECTOR",
    },
    {
      id: "security_auditor",
      number: "NODE-02",
      name: "Security & Bug Auditor",
      description: "Audits diff for SQLi, XSS, auth flaws, secrets, and anchors line coordinates",
      icon: ShieldCheck,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
      highlightColor: "text-amber-400 border-amber-500/30",
      badgeTag: "DIFF ANCHOR",
    },
    {
      id: "test_generator",
      number: "NODE-03",
      name: "Test Generator",
      description: "Generates reproduction & edge-case unit tests with syntax validation",
      icon: Terminal,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
      highlightColor: "text-indigo-400 border-indigo-500/30",
      badgeTag: "SYNTAX CHECK",
    },
    {
      id: "synthesizer",
      number: "NODE-04",
      name: "Synthesizer",
      description: "Computes overall risk score, executive summary, and final PR verdict",
      icon: Wrench,
      status: "pending",
      reasoningSteps: [],
      toolCalls: [],
      highlightColor: "text-rose-400 border-rose-500/30",
      badgeTag: "VERDICT",
    },
  ];

  // Map events to agent states
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

  if (isCompleted) {
    agents.forEach((a) => {
      if (a.status === "running") a.status = "completed";
    });
  }

  const copyEventStream = () => {
    const raw = JSON.stringify(events, null, 2);
    navigator.clipboard.writeText(raw);
    setCopiedLogs(true);
    toast({
      title: "Event stream copied",
      description: `Copied ${events.length} telemetry events to clipboard.`,
    });
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Header Deck */}
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-400">
            <Activity className="h-3 w-3" />
          </div>
          <h3 className="text-sm font-semibold tracking-wide text-foreground">
            LangGraph Swarm
          </h3>
          <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/30 px-1.5 py-0.5 rounded border border-cyan-500/20">
            {events.length} EVTS
          </span>
        </div>

        <button
          type="button"
          onClick={copyEventStream}
          className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-cyan-300 transition-colors"
          title="Copy raw telemetry event stream"
        >
          {copiedLogs ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy Stream</span>
            </>
          )}
        </button>
      </div>

      {/* 4 Agent Pipeline Cards */}
      <div className="space-y-2">
        {agents.map((agent) => {
          const isExpanded = expandedAgent === agent.id;
          const Icon = agent.icon;

          return (
            <div
              key={agent.id}
              className={`rounded-lg border transition-all ${
                agent.status === "running"
                  ? "border-cyan-500/60 bg-cyan-950/20 glow-cyan"
                  : agent.status === "completed"
                  ? "border-white/[0.08] bg-card/60 hover:border-white/20"
                  : "border-white/[0.04] bg-card/20 opacity-60"
              }`}
            >
              {/* Header Click Target */}
              <button
                type="button"
                onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                className="flex w-full items-center justify-between p-3 text-left select-none"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Status Indicator Beacon */}
                  {agent.status === "completed" && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 shrink-0">
                      <CheckCircle2 className="h-3 w-3" />
                    </div>
                  )}
                  {agent.status === "running" && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-950/40 border border-cyan-500/40 text-cyan-400 shrink-0">
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </div>
                  )}
                  {agent.status === "failed" && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-950/40 border border-rose-500/40 text-rose-400 shrink-0">
                      <AlertTriangle className="h-3 w-3" />
                    </div>
                  )}
                  {agent.status === "pending" && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.02] border border-white/10 text-muted-foreground/40 shrink-0">
                      <Circle className="h-2 w-2" />
                    </div>
                  )}

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground">{agent.number}</span>
                      <span className="text-xs font-semibold text-foreground truncate">{agent.name}</span>
                      <span className={`font-mono text-[9px] px-1 rounded border ${agent.highlightColor} bg-black/40`}>
                        {agent.badgeTag}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{agent.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {agent.latencyMs ? (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-cyan-300 bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded">
                      <Clock className="h-2.5 w-2.5" />
                      {formatMs(agent.latencyMs)}
                    </span>
                  ) : null}
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Collapsible Reasoning & Tools Drawer */}
              {isExpanded && (
                <div className="border-t border-white/[0.06] bg-black/40 p-3 space-y-2 text-xs">
                  {agent.reasoningSteps.length === 0 && agent.toolCalls.length === 0 ? (
                    <p className="font-mono text-[10px] text-muted-foreground italic">
                      Awaiting agent trigger in state graph...
                    </p>
                  ) : (
                    <div className="space-y-1.5 font-mono text-[11px]">
                      {agent.reasoningSteps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-muted-foreground">
                          <span className="text-cyan-400 select-none">›</span>
                          <span className="text-foreground/90">{step}</span>
                        </div>
                      ))}
                      {agent.toolCalls.map((call, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-indigo-300 bg-indigo-950/30 border border-indigo-500/20 rounded p-1.5">
                          <span className="text-indigo-400 shrink-0 font-bold select-none">[TOOL]</span>
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
