"use client";

import { useState } from "react";
import { Check, Copy, FileCode2, ShieldCheck, Terminal, AlertCircle } from "lucide-react";
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
      title: "Tests copied to clipboard",
      description: "Ready to run in your local test environment.",
    });
    setTimeout(() => setCopiedIndex(null), 2500);
  };

  if (tests.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center bg-card/40">
        {isLoading ? (
          <>
            <Terminal className="h-7 w-7 text-primary animate-pulse mb-2" />
            <p className="text-sm font-medium text-foreground">Generating unit tests...</p>
            <p className="text-xs text-muted-foreground mt-1">
              Writing regression reproduction suites and validating syntax.
            </p>
          </>
        ) : (
          <>
            <AlertCircle className="h-7 w-7 text-muted-foreground/60 mb-2" />
            <p className="text-sm font-medium text-foreground">No generated tests yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Initiate a review to generate automated reproduction suites.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tests.map((test, idx) => (
        <div key={idx} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-primary" />
              <span className="font-mono text-xs font-semibold text-foreground">{test.file}</span>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {test.framework}
              </Badge>
              {test.syntax_valid && (
                <Badge variant="success" className="text-[10px] flex items-center gap-1">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  Syntax Verified
                </Badge>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => copyTests(test.test_code, idx)}
              className="h-7 text-xs flex items-center gap-1.5"
            >
              {copiedIndex === idx ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Generated Tests</span>
                </>
              )}
            </Button>
          </div>

          {/* Test Code Block */}
          <div className="p-4 bg-background/90 overflow-x-auto">
            <pre className="font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre">
              <code>{test.test_code}</code>
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}
