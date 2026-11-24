"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, GitPullRequest, History, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ReviewSummaryItem {
  review_id: string;
  url: string;
  repo: string;
  pr_number: number;
  title?: string;
  status: string;
  severity_score: number;
  verdict?: string;
  summary?: string;
  created_at: string;
}

export default function ReviewsHistoryPage() {
  const [reviews, setReviews] = useState<ReviewSummaryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${baseUrl}/api/reviews`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.reviews) {
          setReviews(data.reviews);
        }
      })
      .catch((err) => console.error("Failed to load review history:", err))
      .finally(() => setIsLoading(false));
  }, [baseUrl]);

  const getVerdictBadge = (verdict?: string) => {
    if (!verdict) return <Badge variant="outline" className="font-mono text-[10px]">PENDING</Badge>;
    if (verdict === "request_changes") {
      return (
        <Badge variant="outline" className="font-mono text-[10px] bg-rose-950/40 border-rose-500/40 text-rose-400">
          CHANGES REQUESTED
        </Badge>
      );
    }
    if (verdict === "comment") {
      return (
        <Badge variant="outline" className="font-mono text-[10px] bg-amber-950/40 border-amber-500/40 text-amber-400">
          COMMENT
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="font-mono text-[10px] bg-emerald-950/40 border-emerald-500/40 text-emerald-400">
        APPROVED
      </Badge>
    );
  };

  return (
    <div className="container max-w-7xl px-4 py-8 sm:px-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 font-mono text-xs border-white/[0.08] hover:border-cyan-500/40 bg-black/40 text-cyan-300">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Reviewer
            </Button>
          </Link>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <History className="h-5 w-5 text-cyan-400" />
            <span>Audit & Review Logs</span>
            <span className="font-mono text-[10px] text-muted-foreground">({reviews.length} total)</span>
          </h1>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] p-8 text-center bg-card/40 fui-panel space-y-2">
          <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto" />
          <h4 className="text-sm font-semibold text-foreground">No Review Logs Recorded</h4>
          <p className="text-xs text-muted-foreground">Execute a GitHub PR review to populate telemetry records.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Link key={r.review_id} href={`/reviews/${r.review_id}`} className="block group">
              <div className="rounded-xl border border-white/[0.08] bg-card/60 p-4 transition-all hover:border-cyan-500/50 hover:bg-card/90 fui-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono font-semibold text-sm text-foreground group-hover:text-cyan-400 transition-colors">
                      {r.repo}#{r.pr_number}
                    </span>
                    {getVerdictBadge(r.verdict)}
                    <span className="font-mono text-xs text-muted-foreground">
                      Risk Score: <span className="text-cyan-300">{r.severity_score}/100</span>
                    </span>
                  </div>
                  {r.title && <p className="text-xs text-foreground/80 line-clamp-1">{r.title}</p>}
                  {r.summary && <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{r.summary}</p>}
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center text-xs text-muted-foreground shrink-0 font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-cyan-400" />
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-[11px] text-cyan-400">{r.status}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
