"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Clock, FileDiff, Loader2, ShieldAlert, Sparkles, Terminal } from "lucide-react";
import { DiffViewer } from "@/components/diff-viewer";
import { MetricsBar } from "@/components/metrics-bar";
import { TestPanel } from "@/components/test-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ReviewDetailPage() {
  const params = useParams();
  const reviewId = params?.id as string;
  const [review, setReview] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    if (!reviewId) return;
    fetch(`${baseUrl}/api/reviews/${reviewId}`)
      .then((res) => res.json())
      .then((data) => setReview(data))
      .catch((err) => console.error("Failed to load review:", err))
      .finally(() => setIsLoading(false));
  }, [reviewId, baseUrl]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!review) {
    return (
      <div className="container max-w-7xl px-4 py-8 text-center space-y-4">
        <ShieldAlert className="h-10 w-10 text-muted-foreground mx-auto" />
        <h2 className="text-lg font-bold">Review not found</h2>
        <Link href="/reviews">
          <Button variant="outline" size="sm">Back to Reviews</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container max-w-7xl px-4 py-6 sm:px-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/reviews">
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" /> All Reviews
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold text-foreground">
              {review.repo}#{review.pr_number}
            </h1>
            <p className="text-xs text-muted-foreground">{review.title || review.url}</p>
          </div>
        </div>
      </div>

      <MetricsBar
        tokensIn={review.total_tokens_in || 0}
        tokensOut={review.total_tokens_out || 0}
        totalLatencyMs={review.total_latency_ms || 0}
        estimatedCostUsd={review.estimated_cost_usd || 0}
        severityScore={review.severity_score || 0}
        verdict={review.verdict}
      />

      {review.summary && (
        <Card className="border-border/80 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Executive Review Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-foreground/90 leading-relaxed font-sans">{review.summary}</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="diff" className="w-full">
        <TabsList className="w-full justify-start border-b border-border/60 bg-card/40 rounded-t-lg rounded-b-none p-1">
          <TabsTrigger value="diff" className="flex items-center gap-2 text-xs">
            <FileDiff className="h-3.5 w-3.5" />
            <span>Annotated Findings ({review.findings?.length || 0})</span>
          </TabsTrigger>
          <TabsTrigger value="tests" className="flex items-center gap-2 text-xs">
            <Terminal className="h-3.5 w-3.5" />
            <span>Generated Tests ({review.generated_tests?.length || 0})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="diff" className="mt-4">
          <DiffViewer diff="" findings={review.findings || []} />
        </TabsContent>

        <TabsContent value="tests" className="mt-4">
          <TestPanel tests={review.generated_tests || []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
