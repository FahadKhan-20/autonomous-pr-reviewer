"use client";

import { useEffect, useState, useRef } from "react";
import { GitPullRequest, Loader2, Play, AlertCircle, RefreshCw, CheckCircle2, ShieldCheck, Sparkles, FileDiff, Terminal, Activity } from "lucide-react";
import { AgentTimeline } from "@/components/agent-timeline";
import { DiffViewer, FindingData } from "@/components/diff-viewer";
import { MetricsBar } from "@/components/metrics-bar";
import { TestPanel, GeneratedTestData } from "@/components/test-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { AgentEventData, ReviewSSEClient } from "@/lib/sse-client";

export default function Home() {
  const [url, setUrl] = useState("");
  const [postComment, setPostComment] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEventData[]>([]);
  const [findings, setFindings] = useState<FindingData[]>([]);
  const [generatedTests, setGeneratedTests] = useState<GeneratedTestData[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [reviewMeta, setReviewMeta] = useState<{ repo?: string; prNumber?: number; title?: string }>({});
  const [isCompleted, setIsCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Observability metrics state
  const [tokensIn, setTokensIn] = useState(0);
  const [tokensOut, setTokensOut] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [costUsd, setCostUsd] = useState(0);
  const [riskScore, setRiskScore] = useState(0);
  const [verdict, setVerdict] = useState<string | null>(null);

  const sseClientRef = useRef<ReviewSSEClient | null>(null);
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Pre-fill sample PR
  const handleQuickSample = (sampleUrl: string) => {
    setUrl(sampleUrl);
  };

  const startReview = async (targetUrl?: string) => {
    const prUrl = targetUrl || url;
    if (!prUrl.trim()) {
      toast({
        variant: "destructive",
        title: "URL required",
        description: "Please enter a valid GitHub pull request or repository URL.",
      });
      return;
    }

    // Reset view state
    setIsLoading(true);
    setErrorMessage(null);
    setEvents([]);
    setFindings([]);
    setGeneratedTests([]);
    setSummary(null);
    setDiff("");
    setIsCompleted(false);
    setTokensIn(0);
    setTokensOut(0);
    setLatencyMs(0);
    setCostUsd(0);
    setRiskScore(0);
    setVerdict(null);

    try {
      const resp = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: prUrl.trim(),
          post_github_comment: postComment,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(errData.detail || `Server error (${resp.status})`);
      }

      const data = await resp.json();
      setReviewId(data.review_id);
      setReviewMeta({ repo: data.repo, prNumber: data.pr_number });

      toast({
        title: "Review initiated",
        description: `Connected to multi-agent stream for ${data.repo}#${data.pr_number}`,
      });

      // Connect SSE stream
      connectStream(data.review_id);
    } catch (err: any) {
      console.error("Failed to start review:", err);
      setErrorMessage(err.message || "Failed to start review");
      setIsLoading(false);
      toast({
        variant: "destructive",
        title: "Failed to initiate review",
        description: err.message || "Check backend connection.",
      });
    }
  };

  const connectStream = (id: string) => {
    if (sseClientRef.current) {
      sseClientRef.current.disconnect();
    }

    const client = new ReviewSSEClient(
      id,
      (event: AgentEventData) => {
        setEvents((prev) => [...prev, event]);

        if (event.event_type === "finding" && event.data) {
          setFindings((prev) => [...prev, event.data as FindingData]);
        } else if (event.event_type === "test_generated" && event.data) {
          setGeneratedTests((prev) => [...prev, event.data as GeneratedTestData]);
        } else if (event.event_type === "done" && event.data) {
          setIsCompleted(true);
          setIsLoading(false);
          setRiskScore(event.data.risk_score || 0);
          setVerdict(event.data.verdict || "approve");
          setSummary(event.data.summary);
          setTokensIn(event.data.total_tokens_in || 0);
          setTokensOut(event.data.total_tokens_out || 0);
          setCostUsd(event.data.estimated_cost_usd || 0);
          setLatencyMs(event.data.total_latency_ms || 0);

          // Fetch full review details to populate complete diff
          fetchFullReview(id);
        } else if (event.event_type === "error") {
          setIsLoading(false);
          setErrorMessage(event.data?.error || "Review encountered an error");
        }
      },
      (err) => {
        console.warn("SSE stream interrupted:", err);
      }
    );

    sseClientRef.current = client;
    client.connect();
  };

  const fetchFullReview = async (id: string) => {
    try {
      const resp = await fetch(`${baseUrl}/api/reviews/${id}`);
      if (resp.ok) {
        const full = await resp.json();
        if (full.findings && full.findings.length > 0) setFindings(full.findings);
        if (full.generated_tests && full.generated_tests.length > 0) setGeneratedTests(full.generated_tests);
        if (full.summary) setSummary(full.summary);
        if (full.title) setReviewMeta((m) => ({ ...m, title: full.title }));
      }
    } catch (e) {
      console.warn("Could not fetch finalized review details:", e);
    }
  };

  useEffect(() => {
    return () => {
      if (sseClientRef.current) {
        sseClientRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="container max-w-7xl px-4 py-6 sm:px-6 space-y-6">
      {/* Top Banner & PR Input Form */}
      <Card className="border-border/80 bg-card/60 backdrop-blur-md shadow-lg">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <span>Autonomous Code Review</span>
                <span className="text-xs font-normal font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                  LangGraph 4-Agent Pipeline
                </span>
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                Context Retriever › Security & Bug Auditor › Test Generator › Synthesizer
              </CardDescription>
            </div>

            {/* Quick Demo Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Quick Demos:</span>
              <button
                type="button"
                onClick={() => handleQuickSample("https://github.com/facebook/react/pull/31415")}
                className="text-[11px] px-2 py-1 rounded border border-border/80 bg-muted/40 hover:bg-muted text-foreground/80 transition-colors"
              >
                React PR
              </button>
              <button
                type="button"
                onClick={() => handleQuickSample("https://github.com/pallets/flask/pull/5000")}
                className="text-[11px] px-2 py-1 rounded border border-border/80 bg-muted/40 hover:bg-muted text-foreground/80 transition-colors"
              >
                Flask PR
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startReview();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <GitPullRequest className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repository/pull/123"
                disabled={isLoading}
                className="w-full h-10 rounded-md border border-input bg-background/80 pl-9 pr-4 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="h-10 px-6 font-semibold flex items-center gap-2 shadow"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Reviewing...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span>Start Review</span>
                </>
              )}
            </Button>
          </form>

          {/* Options */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={postComment}
                onChange={(e) => setPostComment(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span>Post review comments back to GitHub PR (requires GITHUB_TOKEN)</span>
            </label>

            {reviewId && (
              <span className="font-mono text-[11px]">
                Review ID: <span className="text-primary">{reviewId.slice(0, 8)}...</span>
              </span>
            )}
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Observability Metrics Bar */}
      <MetricsBar
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        totalLatencyMs={latencyMs}
        estimatedCostUsd={costUsd}
        severityScore={riskScore}
        verdict={verdict}
      />

      {/* Executive Summary Card (Visible when synthesized) */}
      {summary && (
        <Card className="border-border/80 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                Synthesized Review Verdict
              </span>
              <span className="text-xs font-mono text-muted-foreground uppercase">{verdict}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-foreground/90 leading-relaxed font-sans">{summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Main Review Panels: Timeline & Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Multi-Agent Timeline (1 col) */}
        <div className="lg:col-span-1">
          <Card className="border-border/80 bg-card/60 backdrop-blur-sm">
            <CardContent className="p-4">
              <AgentTimeline
                events={events}
                currentAgent={events.length > 0 ? events[events.length - 1].agent : undefined}
                isCompleted={isCompleted}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Diff Viewer & Test Panel Tabs (2 cols) */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="diff" className="w-full">
            <TabsList className="w-full justify-start border-b border-border/60 bg-card/40 rounded-t-lg rounded-b-none p-1">
              <TabsTrigger value="diff" className="flex items-center gap-2 text-xs">
                <FileDiff className="h-3.5 w-3.5" />
                <span>Annotated Diff</span>
                {findings.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1.5 text-[10px]">
                    {findings.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="tests" className="flex items-center gap-2 text-xs">
                <Terminal className="h-3.5 w-3.5" />
                <span>Generated Tests</span>
                {generatedTests.length > 0 && (
                  <Badge variant="outline" className="ml-1 h-4 px-1.5 text-[10px]">
                    {generatedTests.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="diff" className="mt-4">
              <DiffViewer diff={diff} findings={findings} />
            </TabsContent>

            <TabsContent value="tests" className="mt-4">
              <TestPanel tests={generatedTests} isLoading={isLoading && generatedTests.length === 0} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
