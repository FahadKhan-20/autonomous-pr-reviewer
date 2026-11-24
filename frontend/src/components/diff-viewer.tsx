"use client";

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Copy, Check, ShieldAlert, Sparkles } from "lucide-react";
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
}

export function DiffViewer({ diff, findings }: DiffViewerProps) {
  const [copiedFixIndex, setCopiedFixIndex] = useState<number | null>(null);
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({});

  // Parse diff into structured files and lines
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
          currentFile = { filename: fname, lines: [] };
          files.push(currentFile);
        }
        if (currentFile) {
          currentFile.lines.push({ type: "header", content: line });
        }
      } else if (line.startsWith("@@")) {
        // Hunk header: @@ -old,count +new,count @@
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
          currentFile.lines.push({
            type: "add",
            content: line.substring(1),
            newLine: newLineNo,
          });
        }
        newLineNo++;
      } else if (line.startsWith("-")) {
        if (currentFile) {
          currentFile.lines.push({
            type: "del",
            content: line.substring(1),
            oldLine: oldLineNo,
          });
        }
        oldLineNo++;
      } else {
        // Context line
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

  const getSeverityBadgeVariant = (sev: string) => {
    switch (sev.toLowerCase()) {
      case "critical":
        return "critical";
      case "high":
        return "high";
      case "medium":
        return "medium";
      case "low":
        return "low";
      default:
        return "info";
    }
  };

  const copySuggestedFix = (fix: string, idx: number) => {
    navigator.clipboard.writeText(fix);
    setCopiedFixIndex(idx);
    toast({
      title: "Suggested fix copied",
      description: "Code snippet copied to clipboard.",
    });
    setTimeout(() => setCopiedFixIndex(null), 2000);
  };

  const toggleFinding = (key: string) => {
    setExpandedFindings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!diff.trim()) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground/60 mb-2" />
        <p className="text-sm font-medium text-foreground">No diff loaded</p>
        <p className="text-xs text-muted-foreground mt-1">Submit a GitHub PR URL to review code changes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {parsedFiles.map((file, fileIdx) => {
        // Collect findings matching this file
        const fileFindings = findings.filter((f) => {
          const normFile = f.file.replace(/^b\//, "");
          return normFile === file.filename || file.filename.endsWith(normFile) || normFile.endsWith(file.filename);
        });

        return (
          <div key={fileIdx} className="overflow-hidden rounded-lg border border-border bg-card">
            {/* File Header */}
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
              <span className="font-mono text-xs font-semibold text-foreground flex items-center gap-2">
                <span>{file.filename}</span>
              </span>
              {fileFindings.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
                    {fileFindings.length} {fileFindings.length === 1 ? "finding" : "findings"}
                  </Badge>
                </div>
              )}
            </div>

            {/* Code Diff Table */}
            <div className="overflow-x-auto font-mono text-xs leading-relaxed">
              <table className="w-full border-collapse">
                <tbody>
                  {file.lines.map((line, lineIdx) => {
                    // Match findings for this specific line
                    const matchedFinding = line.newLine
                      ? fileFindings.find((f) => line.newLine === f.line_start)
                      : null;

                    return (
                      <tbody key={lineIdx}>
                        <tr
                          className={`group transition-colors ${
                            line.type === "add"
                              ? "bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/30"
                              : line.type === "del"
                              ? "bg-red-950/20 text-red-300 hover:bg-red-950/30"
                              : line.type === "hunk"
                              ? "bg-muted/30 text-muted-foreground text-[11px]"
                              : "text-foreground/80 hover:bg-muted/10"
                          }`}
                        >
                          {/* Old line no */}
                          <td className="w-12 select-none border-r border-border/40 px-2 py-0.5 text-right text-[11px] text-muted-foreground/60">
                            {line.oldLine || ""}
                          </td>

                          {/* New line no */}
                          <td className="w-12 select-none border-r border-border/40 px-2 py-0.5 text-right text-[11px] text-muted-foreground/60">
                            {line.newLine || ""}
                          </td>

                          {/* Diff gutter indicator */}
                          <td className="w-4 select-none px-1 text-center font-bold">
                            {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
                          </td>

                          {/* Code content */}
                          <td className="px-2 py-0.5 whitespace-pre font-mono">{line.content}</td>
                        </tr>

                        {/* Inline Finding Annotation if triggered on this line */}
                        {matchedFinding && (
                          <tr>
                            <td colSpan={4} className="p-0">
                              <div className="border-y border-border/80 bg-card/95 p-3.5 my-1 mx-2 rounded-md shadow-lg backdrop-blur">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <Badge variant={getSeverityBadgeVariant(matchedFinding.severity)}>
                                      {matchedFinding.severity.toUpperCase()}
                                    </Badge>
                                    <span className="font-sans text-sm font-semibold text-foreground">
                                      {matchedFinding.title}
                                    </span>
                                    <span className="font-mono text-[10px] text-muted-foreground rounded bg-muted/60 px-1.5 py-0.5">
                                      {(matchedFinding.confidence * 100).toFixed(0)}% confidence
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => toggleFinding(`${fileIdx}-${lineIdx}`)}
                                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 font-sans"
                                  >
                                    <span>Details</span>
                                    {expandedFindings[`${fileIdx}-${lineIdx}`] ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>

                                <p className="mt-2 text-xs text-muted-foreground font-sans leading-relaxed">
                                  {matchedFinding.explanation}
                                </p>

                                {/* Suggested Fix Box */}
                                {matchedFinding.suggested_fix && (
                                  <div className="mt-3 rounded border border-border/60 bg-background/80 p-2.5">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="flex items-center gap-1 text-[11px] font-sans font-medium text-emerald-400">
                                        <Sparkles className="h-3 w-3" /> Suggested Remediation
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => copySuggestedFix(matchedFinding.suggested_fix, lineIdx)}
                                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-sans"
                                      >
                                        {copiedFixIndex === lineIdx ? (
                                          <>
                                            <Check className="h-3 w-3 text-emerald-400" />
                                            <span className="text-emerald-400">Copied</span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="h-3 w-3" />
                                            <span>Copy Fix</span>
                                          </>
                                        )}
                                      </button>
                                    </div>
                                    <pre className="overflow-x-auto text-xs text-foreground/90 font-mono p-1 bg-muted/20 rounded">
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
