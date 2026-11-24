"use client";

import { useEffect, useState, useRef } from "react";
import { 
  GitPullRequest, 
  Loader2, 
  Play, 
  AlertCircle, 
  RefreshCw, 
  CheckCircle2, 
  ShieldCheck, 
  Sparkles, 
  FileDiff, 
  Terminal, 
  Activity, 
  Network, 
  Database, 
  Download, 
  Copy, 
  ExternalLink 
} from "lucide-react";
import { AgentTimeline } from "@/components/agent-timeline";
import { DiffViewer, FindingData } from "@/components/diff-viewer";
import { MetricsBar } from "@/components/metrics-bar";
import { TestPanel, GeneratedTestData } from "@/components/test-panel";
import { RagPipelineGraph } from "@/components/rag-pipeline-graph";
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
        title: "Review pipeline initiated",
        description: `Connected to LangGraph stream for ${data.repo}#${data.pr_number}`,
      });

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

  const exportReviewReport = () => {
    const report = {
      review_id: reviewId,
      repository: reviewMeta.repo,
      pr_number: reviewMeta.prNumber,
      verdict,
      risk_score: riskScore,
      summary,
      findings_count: findings.length,
      findings,
      tests_generated_count: generatedTests.length,
      telemetry: {
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        total_latency_ms: latencyMs,
        cost_usd: costUsd,
      },
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `review_${reviewMeta.repo?.replace("/", "_") || "pr"}_${reviewMeta.prNumber || "report"}.json`;
    a.click();
    URL.revokeObjectURL(u);
    toast({
      title: "Review report exported",
      description: `Saved report JSON file.`,
    });
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
      {/* Hero Command Bar Card */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-card/60 p-5 backdrop-blur-md fui-panel shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 radar-live" />
              <h1 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                <span>Autonomous Code Reviewer</span>
                <span className="font-mono text-[10px] text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-950/40">
                  RAG ENGINE v1.0
                </span>
              </h1>
            </div>
            <p className="text-xs text-muted-foreground">
              pgvector HNSW Semantic Retrieval › Tree-sitter AST Chunker › LangGraph 4-Agent Swarm
            </p>
          </div>

          {/* Quick Demo PR Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground mr-1">DEMOS:</span>
            <button
              type="button"
              onClick={() => handleQuickSample("https://github.com/facebook/react/pull/31415")}
              className="font-mono text-[11px] px-2.5 py-1 rounded border border-white/[0.08] bg-white/[0.02] hover:border-cyan-500/40 hover:bg-cyan-950/30 text-foreground/80 hover:text-cyan-300 transition-colors"
            >
              React #31415
            </button>
            <button
              type="button"
              onClick={() => handleQuickSample("https://github.com/pallets/flask/pull/5000")}
              className="font-mono text-[11px] px-2.5 py-1 rounded border border-white/[0.08] bg-white/[0.02] hover:border-cyan-500/40 hover:bg-cyan-950/30 text-foreground/80 hover:text-cyan-300 transition-colors"
            >
              Flask #5000
            </button>
          </div>
        </div>

        {/* Input Command Line */}
        <div className="mt-4 space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startReview();
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <div className="relative flex-1">
              <GitPullRequest className="absolute left-3.5 top-3 h-4 w-4 text-cyan-400" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repository/pull/123"
                disabled={isLoading}
                className="w-full h-10 rounded-lg border border-white/[0.1] bg-black/50 pl-10 pr-4 text-xs font-mono text-cyan-100 placeholder:text-muted-foreground focus:outline-none focus:border-cyan-400/80 focus:ring-1 focus:ring-cyan-400 disabled:opacity-50 transition-colors"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="h-10 px-6 font-mono text-xs font-semibold flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg glow-cyan border border-cyan-400/30"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Reviewing...</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>Execute Review</span>
                </>
              )}
            </Button>
          </form>

          {/* Options & Metadata */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-muted-foreground gap-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={postComment}
                onChange={(e) => setPostComment(e.target.checked)}
                className="rounded border-white/20 bg-black text-cyan-500 focus:ring-cyan-500"
              />
              <span className="text-[11px]">Post review comments back to GitHub PR (requires GITHUB_TOKEN)</span>
            </label>

            {reviewId && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px]">
                  SESSION: <span className="text-cyan-400">{reviewId.slice(0, 8)}...</span>
                </span>
                <button
                  type="button"
                  onClick={exportReviewReport}
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-cyan-300 transition-colors px-2 py-0.5 rounded border border-white/[0.08] bg-black/40"
                >
                  <Download className="h-3 w-3" />
                  <span>Export Report</span>
                </button>
              </div>
            )}
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs font-mono">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* Telemetry Metrics Bar */}
      <MetricsBar
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        totalLatencyMs={latencyMs}
        estimatedCostUsd={costUsd}
        severityScore={riskScore}
        verdict={verdict}
      />

      {/* Executive Summary Verdict Card */}
      {summary && (
        <div className="rounded-xl border border-white/[0.08] bg-card/60 p-4 backdrop-blur-md fui-panel space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-foreground">Executive PR Synthesis</h3>
            </div>
            <span className="font-mono text-xs text-cyan-400 uppercase">{verdict}</span>
          </div>
          <p className="text-xs text-foreground/90 font-sans leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Main Orchestration & Architecture Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Multi-Agent Swarm Timeline */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-white/[0.08] bg-card/60 p-4 backdrop-blur-md fui-panel">
            <AgentTimeline
              events={events}
              currentAgent={events.length > 0 ? events[events.length - 1].agent : undefined}
              isCompleted={isCompleted}
            />
          </div>
        </div>

        {/* Right Column: Visual Tabs (RAG Architecture / Diff / Tests) */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="diff" className="w-full">
            <TabsList className="w-full justify-start border-b border-white/[0.08] bg-card/40 rounded-t-xl rounded-b-none p-1 gap-1">
              <TabsTrigger value="diff" className="flex items-center gap-1.5 text-xs font-mono data-[state=active]:bg-cyan-950/60 data-[state=active]:text-cyan-300 data-[state=active]:border-b-2 data-[state=active]:border-cyan-400">
                <FileDiff className="h-3.5 w-3.5" />
                <span>Annotated Diff</span>
                {findings.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1.5 text-[9px] font-mono">
                    {findings.length}
                  </Badge>
                )}
              </TabsTrigger>

              <TabsTrigger value="rag" className="flex items-center gap-1.5 text-xs font-mono data-[state=active]:bg-cyan-950/60 data-[state=active]:text-cyan-300 data-[state=active]:border-b-2 data-[state=active]:border-cyan-400">
                <Network className="h-3.5 w-3.5 text-cyan-400" />
                <span>RAG Architecture & Vector Graph</span>
              </TabsTrigger>

              <TabsTrigger value="tests" className="flex items-center gap-1.5 text-xs font-mono data-[state=active]:bg-cyan-950/60 data-[state=active]:text-cyan-300 data-[state=active]:border-b-2 data-[state=active]:border-cyan-400">
                <Terminal className="h-3.5 w-3.5" />
                <span>Generated Tests</span>
                {generatedTests.length > 0 && (
                  <Badge variant="outline" className="ml-1 h-4 px-1.5 text-[9px] font-mono border-indigo-500/30 text-indigo-300">
                    {generatedTests.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="diff" className="mt-4">
              <DiffViewer diff={diff} findings={findings} />
            </TabsContent>

            <TabsContent value="rag" className="mt-4">
              <RagPipelineGraph />
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
