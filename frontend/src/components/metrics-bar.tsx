import { Clock, Cpu, DollarSign, ShieldAlert, Zap } from "lucide-react";
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
  const getRiskColor = (score: number) => {
    if (score >= 60) return "text-red-400 bg-red-950/40 border-red-500/30";
    if (score >= 20) return "text-amber-400 bg-amber-950/40 border-amber-500/30";
    return "text-emerald-400 bg-emerald-950/40 border-emerald-500/30";
  };

  const getVerdictBadge = (v?: string | null) => {
    if (!v) return null;
    const formatted = v.replace("_", " ").toUpperCase();
    if (v === "request_changes") {
      return <span className="rounded px-2 py-0.5 text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">CHANGES REQUESTED</span>;
    }
    if (v === "comment") {
      return <span className="rounded px-2 py-0.5 text-xs font-semibold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">COMMENT</span>;
    }
    return <span className="rounded px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">APPROVED</span>;
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 p-3 rounded-lg border border-border bg-card/60 backdrop-blur-sm">
      {/* Risk Score */}
      <div className="flex flex-col justify-between p-2.5 rounded-md border border-border/50 bg-background/50">
        <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" />
            Risk Score
          </span>
          {getVerdictBadge(verdict)}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`text-2xl font-bold font-mono px-2 py-0.5 rounded border ${getRiskColor(severityScore)}`}>
            {severityScore}
          </span>
          <span className="text-xs text-muted-foreground font-mono">/ 100</span>
        </div>
      </div>

      {/* Latency */}
      <div className="flex flex-col justify-between p-2.5 rounded-md border border-border/50 bg-background/50">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
          <Clock className="h-3.5 w-3.5" />
          Latency
        </span>
        <div className="mt-2">
          <span className="text-xl font-bold font-mono text-foreground">
            {formatMs(totalLatencyMs)}
          </span>
        </div>
      </div>

      {/* Tokens In */}
      <div className="flex flex-col justify-between p-2.5 rounded-md border border-border/50 bg-background/50">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
          <Cpu className="h-3.5 w-3.5" />
          Prompt Tokens
        </span>
        <div className="mt-2">
          <span className="text-xl font-bold font-mono text-foreground">
            {tokensIn.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Tokens Out */}
      <div className="flex flex-col justify-between p-2.5 rounded-md border border-border/50 bg-background/50">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
          <Zap className="h-3.5 w-3.5" />
          Completion Tokens
        </span>
        <div className="mt-2">
          <span className="text-xl font-bold font-mono text-foreground">
            {tokensOut.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Cost */}
      <div className="flex flex-col justify-between p-2.5 rounded-md border border-border/50 bg-background/50 col-span-2 sm:col-span-1">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
          <DollarSign className="h-3.5 w-3.5" />
          Est. Cost
        </span>
        <div className="mt-2">
          <span className="text-xl font-bold font-mono text-emerald-400">
            {formatCost(estimatedCostUsd)}
          </span>
        </div>
      </div>
    </div>
  );
}
