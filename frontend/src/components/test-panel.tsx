"use client";

import { useState } from "react";
import { Check, Copy, FileCode2, ShieldCheck, Terminal, AlertCircle, Download, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

export interface GeneratedTestData {
  file: string;
  framework: string;
  test_code: string;
  syntax_valid: boolean;
  covers_finding_index?: number | null;
}

interface TestPanelProps {
  tests: GeneratedTestData[];
  isLoading?: boolean;
}

export function TestPanel({ tests, isLoading = false }: TestPanelProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyTests = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(idx);
    toast({
      title: "Generated tests copied",
      description: "Code copied to clipboard. Ready to execute in test harness.",
    });
    setTimeout(() => setCopiedIndex(null), 2500);
  };

  const downloadTestFile = (code: string, filename: string) => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.split("/").pop() || "test_suite.py";
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Test file downloaded",
      description: `Saved ${a.download}`,
    });
  };

  if (tests.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-white/[0.08] p-6 text-center bg-card/40 fui-panel">
        {isLoading ? (
          <>
            <Terminal className="h-7 w-7 text-cyan-400 animate-pulse mb-2" />
            <h4 className="text-sm font-semibold text-foreground">Generating Test Suites...</h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Node 3 (Test Generator) is writing reproduction and edge-case unit tests and verifying syntax with py_compile.
            </p>
          </>
        ) : (
          <>
            <AlertCircle className="h-7 w-7 text-muted-foreground/60 mb-2" />
            <h4 className="text-sm font-semibold text-foreground">No Automated Tests Generated Yet</h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Execute a PR review to automatically generate executable pytest or Jest reproduction suites.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tests.map((test, idx) => (
        <div key={idx} className="overflow-hidden rounded-xl border border-white/[0.08] bg-card/60 fui-panel shadow-lg">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/[0.08] bg-muted/40 px-4 py-2.5 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode2 className="h-4 w-4 text-cyan-400 shrink-0" />
              <span className="font-mono text-xs font-semibold text-foreground truncate">{test.file}</span>
              <Badge variant="outline" className="font-mono text-[10px] uppercase border-indigo-500/30 text-indigo-300 bg-indigo-950/30">
                {test.framework}
              </Badge>
              {test.syntax_valid && (
                <Badge variant="outline" className="font-mono text-[10px] text-emerald-400 border-emerald-500/30 bg-emerald-950/30 flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  SYNTAX: VERIFIED
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadTestFile(test.test_code, test.file)}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-cyan-300 transition-colors px-2 py-1 rounded border border-white/[0.08] bg-black/40"
              >
                <Download className="h-3 w-3" />
                <span>Download</span>
              </button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => copyTests(test.test_code, idx)}
                className="h-7 text-xs font-mono flex items-center gap-1.5 border-cyan-500/30 hover:border-cyan-400 text-cyan-300 bg-cyan-950/30 hover:bg-cyan-900/40"
              >
                {copiedIndex === idx ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Tests</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Test Code Block with Dark IDE Aesthetic */}
          <div className="p-4 bg-black/60 overflow-x-auto">
            <pre className="font-mono text-xs leading-relaxed text-cyan-100 whitespace-pre">
              <code>{test.test_code}</code>
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}
