"use client";

import { useState } from "react";
import { 
  Database, 
  GitBranch, 
  Network, 
  Cpu, 
  Layers, 
  Zap, 
  Search, 
  CheckCircle2, 
  Sparkles, 
  ArrowRight, 
  Code2, 
  Server, 
  Binary, 
  Activity,
  Play
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface RagNode {
  id: string;
  number: string;
  name: string;
  tech: string;
  tagline: string;
  icon: any;
  status: "active" | "standby" | "verified";
  color: string;
  glow: string;
  metrics: { label: string; value: string }[];
  details: {
    description: string;
    algorithm: string;
    samplePayload: string;
  };
}

export function RagPipelineGraph() {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("pgvector");
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);

  const nodes: RagNode[] = [
    {
      id: "ingestion",
      number: "01",
      name: "Diff & File Ingestion",
      tech: "GitHub REST + unidiff",
      tagline: "Fetches unified PR diff, filters lockfiles & caps token budgets",
      icon: GitBranch,
      status: "verified",
      color: "text-sky-400 border-sky-500/40 bg-sky-950/20",
      glow: "glow-cyan",
      metrics: [
        { label: "Token Limit", value: "32,000" },
        { label: "Excluded Files", value: "pkg-lock, binaries" },
        { label: "Rate Limit Guard", value: "Active" },
      ],
      details: {
        description: "Parses unified diff into structured hunks, extracts modified file paths, and pulls HEAD commit contents for changed symbols.",
        algorithm: "unidiff.PatchSet + GitHub REST API (v3) with HMAC webhook ingestion",
        samplePayload: `{\n  "repo": "pallets/flask",\n  "pr_number": 5000,\n  "base_sha": "e9a1b2c",\n  "head_sha": "d3f4a8b",\n  "changed_files_count": 4\n}`,
      },
    },
    {
      id: "chunker",
      number: "02",
      name: "Language-Aware Chunker",
      tech: "Tree-sitter AST",
      tagline: "Syntactic function & class chunking for Python, TS, and JS",
      icon: Code2,
      status: "active",
      color: "text-indigo-400 border-indigo-500/40 bg-indigo-950/20",
      glow: "glow-violet",
      metrics: [
        { label: "Parsers", value: "Py, TS, JS" },
        { label: "Boundary", value: "AST Function / Class" },
        { label: "Fallback", value: "100-line overlap" },
      ],
      details: {
        description: "Instead of naive fixed-token splitting, Tree-sitter parses the abstract syntax tree to chunk code at natural semantic function and class boundaries.",
        algorithm: "tree_sitter.Parser (C-bindings) walking function_definition, class_declaration, and export nodes",
        samplePayload: `// Tree-sitter AST Chunk Node:\nclass AuthenticationService {\n  public verifySessionToken(token: string): Session {\n    // AST Node: method_definition [Lines 24-58]\n  }\n}`,
      },
    },
    {
      id: "embeddings",
      number: "03",
      name: "Hyper-Plane Embedding",
      tech: "text-embedding-3-small",
      tagline: "Generates 1536-dimensional dense vectors for semantic similarity",
      icon: Cpu,
      status: "active",
      color: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
      glow: "glow-emerald",
      metrics: [
        { label: "Dimensions", value: "1536" },
        { label: "Normalization", value: "L2 Unit Vector" },
        { label: "Cache Policy", value: "Commit SHA skip" },
      ],
      details: {
        description: "Converts structural AST code blocks into normalized dense float vectors in a 1536-dimensional geometric space.",
        algorithm: "f: Code_Chunk -> R^1536 where ||v||_2 = 1.0 (Unit Hypersphere)",
        samplePayload: `[\n  0.014285, -0.038102, 0.009412, ..., 0.021094\n] // 1536 float32 dimensions`,
      },
    },
    {
      id: "pgvector",
      number: "04",
      name: "pgvector Store & HNSW Index",
      tech: "PostgreSQL 16 + pgvector",
      tagline: "Hierarchical Navigable Small World index with Cosine distance",
      icon: Database,
      status: "active",
      color: "text-cyan-400 border-cyan-500/40 bg-cyan-950/20",
      glow: "glow-cyan",
      metrics: [
        { label: "Metric", value: "Cosine (<=>)" },
        { label: "HNSW Params", value: "m=16, ef_build=64" },
        { label: "Table", value: "repo_chunks" },
      ],
      details: {
        description: "Stores embedded chunks with commit SHA isolation. Sub-millisecond vector similarity search using the HNSW cosine distance operator.",
        algorithm: "dist(u, v) = 1 - (u · v) / (||u||_2 * ||v||_2) via HNSW graph traversal",
        samplePayload: `SELECT path, chunk_index, content,\n  1 - (embedding <=> $query_vector) AS cosine_similarity\nFROM repo_chunks\nWHERE repo = $1 AND commit_sha = $2\nORDER BY embedding <=> $query_vector ASC\nLIMIT 5;`,
      },
    },
    {
      id: "retriever",
      number: "05",
      name: "Semantic Context Matcher",
      tech: "Symbol Graph + Vector RAG",
      tagline: "Merges top-k vector chunks with imported symbol dependency graphs",
      icon: Network,
      status: "active",
      color: "text-amber-400 border-amber-500/40 bg-amber-950/20",
      glow: "glow-amber",
      metrics: [
        { label: "Top-k Chunks", value: "k = 5 per symbol" },
        { label: "Min Similarity", value: "> 0.72 Cosine" },
        { label: "Graph Tracing", value: "Imported references" },
      ],
      details: {
        description: "Retrieves surrounding contextual code for changed functions, including call sites and utility definitions, enabling the LLM to understand PR ramifications.",
        algorithm: "Dual-pass hybrid: AST Import extraction ∪ Cosine Vector similarity matching",
        samplePayload: `{\n  "changed_symbol": "authenticate_user",\n  "matched_chunks": [\n    {"file": "auth/session.py", "lines": [12, 45], "similarity": 0.942},\n    {"file": "db/models.py", "lines": [88, 120], "similarity": 0.819}\n  ]\n}`,
      },
    },
    {
      id: "langgraph",
      number: "06",
      name: "LangGraph Multi-Agent Swarm",
      tech: "StateGraph & TypedState",
      tagline: "4 specialized agents collaborating over typed immutable state",
      icon: Zap,
      status: "verified",
      color: "text-rose-400 border-rose-500/40 bg-rose-950/20",
      glow: "glow-rose",
      metrics: [
        { label: "Agent Nodes", value: "4 Autonomous Nodes" },
        { label: "Streaming", value: "SSE Event Channel" },
        { label: "Safety Fence", value: "Prompt Injection delim" },
      ],
      details: {
        description: "Coordinates Context Retriever, Security Auditor, Test Generator, and Synthesizer in a validated directed acyclic graph.",
        algorithm: "LangGraph StateGraph(ReviewState) with conditional edge error handling and atomic sequence dispatcher",
        samplePayload: `ReviewState {\n  review_id: UUID,\n  repo: str,\n  diff: str,\n  retrieved_context: List[Chunk],\n  findings: List[Finding],\n  generated_tests: List[Test],\n  verdict: Verdict\n}`,
      },
    },
  ];

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[3];

  const handleRunSimulation = () => {
    if (isSimulating) return;
    setIsSimulating(true);
    let currentStep = 0;

    const interval = setInterval(() => {
      if (currentStep < nodes.length) {
        setActiveStepIndex(currentStep);
        setSelectedNodeId(nodes[currentStep].id);
        currentStep++;
      } else {
        clearInterval(interval);
        setIsSimulating(false);
        setActiveStepIndex(null);
      }
    }, 900);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Bar */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-card/60 p-5 backdrop-blur-md fui-panel">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 radar-live" />
              <h2 className="text-base font-semibold tracking-wide text-foreground flex items-center gap-2">
                <span>RAG Retrieval & Vector Architecture</span>
                <span className="font-mono text-[10px] text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-950/40">
                  SEC-04 // PGVECTOR HNSW
                </span>
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Interactive structural map of repository embedding, tree-sitter AST chunking, pgvector similarity lookup, and multi-agent coordination.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunSimulation}
              disabled={isSimulating}
              className="h-8 gap-1.5 text-xs font-mono border-cyan-500/30 hover:border-cyan-400 text-cyan-300 bg-cyan-950/30 hover:bg-cyan-900/40"
            >
              <Play className={`h-3.5 w-3.5 ${isSimulating ? "animate-spin text-cyan-400" : ""}`} />
              <span>{isSimulating ? "Simulating Query..." : "Simulate RAG Pipeline"}</span>
            </Button>
          </div>
        </div>

        {/* Global Architecture Telemetry Bar */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 pt-4 border-t border-white/[0.06] text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono">Vector Engine:</span>
            <span className="font-mono font-medium text-cyan-300">pgvector 0.7+</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono">Index Type:</span>
            <span className="font-mono font-medium text-indigo-300">HNSW (Cosine)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono">Vector Dims:</span>
            <span className="font-mono font-medium text-emerald-300">1536 Float32</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono">Chunk Strategy:</span>
            <span className="font-mono font-medium text-amber-300">AST Structural</span>
          </div>
        </div>
      </div>

      {/* Interactive Horizontal Pipeline Visualizer */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {nodes.map((node, idx) => {
          const isSelected = selectedNodeId === node.id;
          const isActiveSimStep = activeStepIndex === idx;
          const Icon = node.icon;

          return (
            <div
              key={node.id}
              onClick={() => setSelectedNodeId(node.id)}
              className={`relative cursor-pointer rounded-lg border p-4 transition-all select-none ${
                isSelected
                  ? `border-cyan-400/80 bg-cyan-950/30 shadow-lg ${node.glow}`
                  : isActiveSimStep
                  ? "border-primary bg-primary/20 scale-[1.02]"
                  : "border-white/[0.08] bg-card/40 hover:border-white/20 hover:bg-card/70"
              }`}
            >
              {/* Tactical Top Tag */}
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-muted-foreground font-semibold">
                  STAGE {node.number}
                </span>
                <Badge variant="outline" className={`font-mono text-[10px] uppercase border ${node.color}`}>
                  {node.tech}
                </Badge>
              </div>

              {/* Node Title & Icon */}
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-md border ${node.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground tracking-tight">{node.name}</h4>
                </div>
              </div>

              {/* Short Tagline */}
              <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {node.tagline}
              </p>

              {/* Telemetry Micro-Pills */}
              <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-white/[0.05]">
                {node.metrics.map((m, mIdx) => (
                  <span
                    key={mIdx}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-foreground/80 border border-white/[0.05]"
                  >
                    <span className="text-muted-foreground">{m.label}:</span> {m.value}
                  </span>
                ))}
              </div>

              {/* Bottom selection indicator */}
              {isSelected && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Node Deep-Dive Telemetry Inspector */}
      <div className="rounded-xl border border-white/[0.08] bg-card/80 p-5 backdrop-blur-md fui-panel space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-7 w-7 items-center justify-center rounded border ${selectedNode.color}`}>
              <selectedNode.icon className="h-3.5 w-3.5" />
            </div>
            <div>
              <span className="text-xs font-mono text-muted-foreground">INSPECTING STAGE {selectedNode.number} ::</span>
              <h3 className="text-sm font-bold text-foreground">{selectedNode.name}</h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/20">
              {selectedNode.details.algorithm}
            </span>
          </div>
        </div>

        <p className="text-xs text-foreground/90 font-sans leading-relaxed">
          {selectedNode.details.description}
        </p>

        {/* Code / Vector Math Preview Payload */}
        <div className="rounded-lg border border-white/[0.08] bg-black/60 p-3.5 overflow-x-auto">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.05]">
            <span className="font-mono text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Binary className="h-3 w-3 text-cyan-400" />
              Payload & Execution Query Syntax
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">PostgreSQL / AST Tree</span>
          </div>
          <pre className="font-mono text-xs text-cyan-200 leading-relaxed whitespace-pre">
            <code>{selectedNode.details.samplePayload}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
