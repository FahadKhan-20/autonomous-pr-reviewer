"use client";

import { useState } from "react";
import { 
  AlertCircle, 
  ChevronDown, 
  ChevronRight, 
  Copy, 
  Check, 
  ShieldAlert, 
  Sparkles, 
  FileCode2, 
  Terminal, 
  CheckCircle2, 
  AlertTriangle,
  Lock,
  ExternalLink
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

export interface FindingData {
  file: string;
  line_start: number;
  line_end: number;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: number;
  title: string;
  explanation: string;
  suggested_fix: string;
}

interface DiffViewerProps {
  diff: string;
  findings: FindingData[];
}

interface DiffLine {
  type: "header" | "add" | "del" | "ctx" | "hunk";
  content: string;
  oldLine?: number;
  newLine?: number;
}

interface DiffFile {
  filename: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export function DiffViewer({ diff, findings }: DiffViewerProps) {
  const [copiedFixIndex, setCopiedFixIndex] = useState<number | null>(null);
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({});
  const [selectedFileFilter, setSelectedFileFilter] = useState<string | "all">("all");

  // Parse diff into structured files, hunks, and lines
  const parseDiff = (rawDiff: string): DiffFile[] => {
    if (!rawDiff.trim()) return [];
    const files: DiffFile[] = [];
    let currentFile: DiffFile | null = null;
    let newLineNo = 0;
    let oldLineNo = 0;

    const rawLines = rawDiff.split("\n");
    for (const line of rawLines) {
      if (line.startsWith("diff --git") || line.startsWith("--- ") || line.startsWith("+++ ")) {
        if (line.startsWith("+++ b/")) {
          const fname = line.replace("+++ b/", "").trim();
          currentFile = { filename: fname, lines: [], additions: 0, deletions: 0 };
          files.push(currentFile);
        }
        if (currentFile) {
          currentFile.lines.push({ type: "header", content: line });
        }
      } else if (line.startsWith("@@")) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLineNo = parseInt(match[1], 10);
          newLineNo = parseInt(match[2], 10);
        }
        if (currentFile) {
          currentFile.lines.push({ type: "hunk", content: line });
        }
      } else if (line.startsWith("+")) {
        if (currentFile) {
          currentFile.additions++;
          currentFile.lines.push({
            type: "add",
            content: line.substring(1),
            newLine: newLineNo,
          });
        }
        newLineNo++;
      } else if (line.startsWith("-")) {
        if (currentFile) {
          currentFile.deletions++;
          currentFile.lines.push({
            type: "del",
            content: line.substring(1),
            oldLine: oldLineNo,
          });
        }
        oldLineNo++;
      } else {
        if (currentFile) {
          currentFile.lines.push({
            type: "ctx",
            content: line.startsWith(" ") ? line.substring(1) : line,
            oldLine: oldLineNo,
            newLine: newLineNo,
          });
        }
        oldLineNo++;
        newLineNo++;
      }
    }
    return files;
  };

  const parsedFiles = parseDiff(diff);

  const getSeverityStyles = (sev: string) => {
    switch (sev.toLowerCase()) {
      case "critical":
        return {
          badge: "bg-rose-500/20 text-rose-400 border-rose-500/40 glow-rose",
          border: "border-rose-500/40 bg-rose-950/20",
          tag: "CRITICAL",
        };
      case "high":
        return {
          badge: "bg-amber-500/20 text-amber-400 border-amber-500/40 glow-amber",
          border: "border-amber-500/40 bg-amber-950/20",
          tag: "HIGH",
        };
      case "medium":
        return {
          badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
          border: "border-yellow-500/40 bg-yellow-950/20",
          tag: "MEDIUM",
        };
      case "low":
        return {
          badge: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
          border: "border-cyan-500/40 bg-cyan-950/20",
          tag: "LOW",
        };
      default:
        return {
          badge: "bg-slate-500/20 text-slate-300 border-slate-500/40",
          border: "border-slate-500/40 bg-slate-950/20",
          tag: "INFO",
        };
    }
  };

  const copySuggestedFix = (fix: string, idx: number) => {
    navigator.clipboard.writeText(fix);
    setCopiedFixIndex(idx);
    toast({
      title: "Remediation patch copied",
      description: "Code replacement copied to clipboard.",
    });
    setTimeout(() => setCopiedFixIndex(null), 2500);
  };

  const toggleFinding = (key: string) => {
    setExpandedFindings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const visibleFiles = parsedFiles.filter(
    (f) => selectedFileFilter === "all" || f.filename === selectedFileFilter
  );

  if (!diff.trim() && findings.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-white/[0.08] p-8 text-center bg-card/40 fui-panel">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-950/30 border border-cyan-500/20 text-cyan-400 mb-3">
          <Terminal className="h-6 w-6" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">No Diff Loaded in Buffer</h4>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Submit a GitHub pull request URL to execute the AST chunker, pgvector retrieval, and security auditing pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* File Quick-Filter Selector Pills (if multiple files exist) */}
      {parsedFiles.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-white/[0.08] bg-black/40">
          <span className="text-[10px] font-mono text-muted-foreground mr-1">FILES:</span>
          <button
            type="button"
            onClick={() => setSelectedFileFilter("all")}
            className={`font-mono text-[10px] px-2 py-0.5 rounded border transition-colors ${
              selectedFileFilter === "all"
                ? "bg-cyan-950/60 border-cyan-500/40 text-cyan-300"
                : "bg-white/[0.02] border-white/10 text-muted-foreground hover:text-foreground"
            }`}
          >
            All Files ({parsedFiles.length})
          </button>
          {parsedFiles.map((f, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedFileFilter(f.filename)}
              className={`font-mono text-[10px] px-2 py-0.5 rounded border transition-colors truncate max-w-[200px] ${
                selectedFileFilter === f.filename
                  ? "bg-cyan-950/60 border-cyan-500/40 text-cyan-300"
                  : "bg-white/[0.02] border-white/10 text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.filename}
            </button>
          ))}
        </div>
      )}

      {/* Render Files */}
      {visibleFiles.map((file, fileIdx) => {
        const fileFindings = findings.filter((f) => {
          const normFile = f.file.replace(/^b\//, "");
          return normFile === file.filename || file.filename.endsWith(normFile) || normFile.endsWith(file.filename);
        });

        return (
          <div key={fileIdx} className="overflow-hidden rounded-xl border border-white/[0.08] bg-card/60 fui-panel shadow-lg">
            {/* File Header */}
            <div className="flex items-center justify-between border-b border-white/[0.08] bg-muted/40 px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode2 className="h-4 w-4 text-cyan-400 shrink-0" />
                <span className="font-mono text-xs font-semibold text-foreground truncate">
                  {file.filename}
                </span>
                <span className="font-mono text-[10px] text-emerald-400">+{file.additions}</span>
                <span className="font-mono text-[10px] text-rose-400">-{file.deletions}</span>
              </div>

              {fileFindings.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge variant="outline" className="font-mono text-[10px] h-5 px-2 bg-rose-950/40 border-rose-500/40 text-rose-400">
                    <ShieldAlert className="h-3 w-3 mr-1" />
                    {fileFindings.length} {fileFindings.length === 1 ? "Vulnerability" : "Vulnerabilities"}
                  </Badge>
                </div>
              )}
            </div>

            {/* Code Diff Table */}
            <div className="overflow-x-auto font-mono text-xs leading-relaxed">
              <table className="w-full border-collapse">
                <tbody>
                  {file.lines.map((line, lineIdx) => {
                    const matchedFinding = line.newLine
                      ? fileFindings.find((f) => line.newLine === f.line_start)
                      : null;

                    return (
                      <tbody key={lineIdx}>
                        <tr
                          className={`transition-colors ${
                            line.type === "add"
                              ? "bg-emerald-950/25 text-emerald-200 hover:bg-emerald-950/35"
                              : line.type === "del"
                              ? "bg-rose-950/25 text-rose-200 hover:bg-rose-950/35"
                              : line.type === "hunk"
                              ? "bg-white/[0.02] text-muted-foreground/80 text-[11px]"
                              : "text-foreground/85 hover:bg-white/[0.02]"
                          }`}
                        >
                          {/* Old line number */}
                          <td className="w-12 select-none border-r border-white/[0.06] px-2 py-0.5 text-right text-[11px] text-muted-foreground/50">
                            {line.oldLine || ""}
                          </td>

                          {/* New line number */}
                          <td className="w-12 select-none border-r border-white/[0.06] px-2 py-0.5 text-right text-[11px] text-muted-foreground/50">
                            {line.newLine || ""}
                          </td>

                          {/* Sign gutter */}
                          <td className="w-4 select-none px-1 text-center font-bold">
                            {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
                          </td>

                          {/* Content */}
                          <td className="px-2 py-0.5 whitespace-pre font-mono">{line.content}</td>
                        </tr>

                        {/* In-Line Holographic Vulnerability Card */}
                        {matchedFinding && (
                          <tr>
                            <td colSpan={4} className="p-0">
                              <div className={`my-2 mx-3 rounded-lg border p-4 shadow-xl backdrop-blur-md ${getSeverityStyles(matchedFinding.severity).border}`}>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className={`font-mono text-[10px] font-bold uppercase ${getSeverityStyles(matchedFinding.severity).badge}`}>
                                      {matchedFinding.severity}
                                    </Badge>
                                    <span className="font-semibold text-xs text-foreground tracking-tight">
                                      {matchedFinding.title}
                                    </span>
                                    <span className="font-mono text-[10px] text-cyan-300 bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded">
                                      {matchedFinding.category}
                                    </span>
                                    <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                                      {(matchedFinding.confidence * 100).toFixed(0)}% Confidence
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      L{matchedFinding.line_start}-L{matchedFinding.line_end} [ANCHOR VERIFIED]
                                    </span>
                                  </div>
                                </div>

                                <p className="mt-2 text-xs text-foreground/80 font-sans leading-relaxed">
                                  {matchedFinding.explanation}
                                </p>

                                {/* Suggested Remediation Code Block */}
                                {matchedFinding.suggested_fix && (
                                  <div className="mt-3 rounded-md border border-white/[0.08] bg-black/60 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="flex items-center gap-1.5 text-[11px] font-mono font-medium text-emerald-400">
                                        <Sparkles className="h-3 w-3" />
                                        Suggested Remediation Patch
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => copySuggestedFix(matchedFinding.suggested_fix, lineIdx)}
                                        className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-cyan-300 transition-colors"
                                      >
                                        {copiedFixIndex === lineIdx ? (
                                          <>
                                            <Check className="h-3 w-3 text-emerald-400" />
                                            <span className="text-emerald-400">Copied!</span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="h-3 w-3" />
                                            <span>Copy Patch</span>
                                          </>
                                        )}
                                      </button>
                                    </div>
                                    <pre className="overflow-x-auto text-xs text-emerald-200 font-mono p-2 bg-emerald-950/20 rounded border border-emerald-500/20">
                                      <code>{matchedFinding.suggested_fix}</code>
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
