import Link from "next/link";
import { ShieldAlert, GitPullRequest, History, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="container flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-foreground transition-colors hover:text-primary">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold tracking-wide">
              Autonomous PR Reviewer <span className="text-xs font-mono text-primary/80 font-normal">v1.0</span>
            </span>
          </Link>
          <Badge variant="outline" className="hidden sm:inline-flex text-[10px] tracking-wider text-muted-foreground uppercase border-muted-foreground/20">
            LangGraph Multi-Agent
          </Badge>
        </div>

        <nav className="flex items-center gap-2">
          <Link
            href="/reviews"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
            <span>Review History</span>
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            <span>GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
