"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, GitPullRequest, History, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    if (!verdict) return <Badge variant="outline">PENDING</Badge>;
    if (verdict === "request_changes") return <Badge variant="destructive">CHANGES REQUESTED</Badge>;
    if (verdict === "comment") return <Badge variant="high">COMMENT</Badge>;
    return <Badge variant="success">APPROVED</Badge>;
  };

  return (
    <div className="container max-w-7xl px-4 py-8 sm:px-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Reviewer
            </Button>
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Review History
          </h1>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : reviews.length === 0 ? (
        <Card className="border-dashed p-8 text-center bg-card/40">
          <CardContent className="space-y-2">
            <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">No reviews logged yet</p>
            <p className="text-xs text-muted-foreground">Submit a GitHub PR to create your first autonomous review.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Link key={r.review_id} href={`/reviews/${r.review_id}`} className="block group">
              <Card className="border-border/80 bg-card/60 transition-colors hover:border-primary/50 hover:bg-card/90">
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                        {r.repo}#{r.pr_number}
                      </span>
                      {getVerdictBadge(r.verdict)}
                      <span className="text-xs font-mono text-muted-foreground">
                        Score: {r.severity_score}/100
                      </span>
                    </div>
                    {r.title && <p className="text-xs text-foreground/80 line-clamp-1">{r.title}</p>}
                    {r.summary && <p className="text-xs text-muted-foreground line-clamp-2">{r.summary}</p>}
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center text-xs text-muted-foreground shrink-0 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                    <span className="text-[11px] text-primary/80">{r.status}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
