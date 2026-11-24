import Link from "next/link";
import { ShieldAlert, GitPullRequest, History, Activity, Database, Sparkles, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-[#050811]/90 backdrop-blur-md">
      <div className="container flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-foreground transition-colors hover:text-cyan-400">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-950/60 text-cyan-400 border border-cyan-500/30 glow-cyan">
              <Database className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-wide flex items-center gap-1.5">
                <span>RAG REVIEWER</span>
                <span className="font-mono text-[9px] text-cyan-400 bg-cyan-950/40 px-1 py-0.2 rounded border border-cyan-500/30">
                  PGVECTOR // HNSW
                </span>
              </span>
              <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                Autonomous GitHub PR & Code Auditor
              </span>
            </div>
          </Link>
        </div>

        {/* Tactical Telemetry Strip */}
        <div className="hidden md:flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 radar-live" />
            <span className="text-[11px]">SYSTEM: NOMINAL</span>
          </div>
          <span className="text-white/20">|</span>
          <span className="text-muted-foreground text-[11px]">EMBEDDING: 1536-D</span>
          <span className="text-white/20">|</span>
          <span className="text-muted-foreground text-[11px]">SWARM: 4 AGENTS</span>
        </div>

        <nav className="flex items-center gap-2">
          <Link
            href="/reviews"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-cyan-300 border border-transparent hover:border-white/[0.08]"
          >
            <History className="h-3.5 w-3.5" />
            <span>History</span>
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-cyan-300 border border-transparent hover:border-white/[0.08]"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
