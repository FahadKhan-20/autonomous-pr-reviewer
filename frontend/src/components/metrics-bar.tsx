import { Clock, Cpu, DollarSign, ShieldAlert, Zap, Activity } from "lucide-react";
import { formatCost, formatMs } from "@/lib/utils";

interface MetricsBarProps {
  tokensIn: number;
  tokensOut: number;
  totalLatencyMs: number;
  estimatedCostUsd: number;
  severityScore: number;
  verdict?: string | null;
}

export function MetricsBar({
  tokensIn,
  tokensOut,
  totalLatencyMs,
  estimatedCostUsd,
  severityScore,
  verdict,
}: MetricsBarProps) {
  const getRiskStyles = (score: number) => {
    if (score >= 60) {
      return {
        badge: "text-rose-400 bg-rose-950/40 border-rose-500/40 glow-rose",
        label: "HIGH RISK",
      };
    }
    if (score >= 20) {
      return {
        badge: "text-amber-400 bg-amber-950/40 border-amber-500/40 glow-amber",
        label: "MODERATE",
      };
    }
    return {
      badge: "text-emerald-400 bg-emerald-950/40 border-emerald-500/40 glow-emerald",
      label: "NOMINAL",
    };
  };

  const getVerdictStamp = (v?: string | null) => {
    if (!v) return null;
    if (v === "request_changes") {
      return (
        <span className="font-mono text-[10px] px-2 py-0.5 rounded font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 glow-rose tracking-wider">
          CHANGES REQUESTED
        </span>
      );
    }
    if (v === "comment") {
      return (
        <span className="font-mono text-[10px] px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 glow-amber tracking-wider">
          COMMENT
        </span>
      );
    }
    return (
      <span className="font-mono text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 glow-emerald tracking-wider">
        APPROVED
      </span>
    );
  };

  const riskStyle = getRiskStyles(severityScore);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 p-3 rounded-xl border border-white/[0.08] bg-card/60 backdrop-blur-md fui-panel shadow-md">
      {/* Risk Score */}
      <div className="flex flex-col justify-between p-3 rounded-lg border border-white/[0.06] bg-black/40">
        <div className="flex items-center justify-between text-muted-foreground text-[11px] font-medium">
          <span className="flex items-center gap-1.5 font-mono">
            <ShieldAlert className="h-3.5 w-3.5 text-cyan-400" />
            RISK ASSESSMENT
          </span>
          {getVerdictStamp(verdict)}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`text-2xl font-bold font-mono px-2 py-0.5 rounded border tabular-nums ${riskStyle.badge}`}>
            {severityScore}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">/ 100</span>
          <span className="text-[10px] font-mono text-muted-foreground uppercase ml-auto">
            {riskStyle.label}
          </span>
        </div>
      </div>

      {/* Latency */}
      <div className="flex flex-col justify-between p-3 rounded-lg border border-white/[0.06] bg-black/40">
        <span className="flex items-center gap-1.5 text-muted-foreground text-[11px] font-mono font-medium">
          <Clock className="h-3.5 w-3.5 text-cyan-400" />
          TOTAL LATENCY
        </span>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-xl font-bold font-mono text-foreground tabular-nums">
            {formatMs(totalLatencyMs)}
          </span>
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/20">
            E2E
          </span>
        </div>
      </div>

      {/* Tokens In */}
      <div className="flex flex-col justify-between p-3 rounded-lg border border-white/[0.06] bg-black/40">
        <span className="flex items-center gap-1.5 text-muted-foreground text-[11px] font-mono font-medium">
          <Cpu className="h-3.5 w-3.5 text-indigo-400" />
          PROMPT TOKENS
        </span>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-xl font-bold font-mono text-foreground tabular-nums">
            {tokensIn.toLocaleString()}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">IN</span>
        </div>
      </div>

      {/* Tokens Out */}
      <div className="flex flex-col justify-between p-3 rounded-lg border border-white/[0.06] bg-black/40">
        <span className="flex items-center gap-1.5 text-muted-foreground text-[11px] font-mono font-medium">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          COMPLETION TOKENS
        </span>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-xl font-bold font-mono text-foreground tabular-nums">
            {tokensOut.toLocaleString()}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">OUT</span>
        </div>
      </div>

      {/* Cost */}
      <div className="flex flex-col justify-between p-3 rounded-lg border border-white/[0.06] bg-black/40 col-span-2 sm:col-span-1">
        <span className="flex items-center gap-1.5 text-muted-foreground text-[11px] font-mono font-medium">
          <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
          EST. COST (USD)
        </span>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
            {formatCost(estimatedCostUsd)}
          </span>
          <span className="text-[10px] font-mono text-emerald-500/80 bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-500/20">
            OPTIMIZED
          </span>
        </div>
      </div>
    </div>
  );
}
