"use client";

import { useState } from "react";
import { Sparkles, AlertTriangle } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";

export interface LlmSummary {
  model?: string;
  summary?: string | null;
  highlights?: string[];
  findings?: { level: "info" | "warn" | "error"; detail: string }[];
  suggested_commands?: string[];
  divergence_warnings?: string[];
}

export function LlmSummaryCard({
  data,
  onSuggestionClick,
}: {
  data: LlmSummary;
  onSuggestionClick?: (cmd: string) => void;
  attached?: boolean;
}) {
  const [ackDivergence, setAckDivergence] = useState(false);
  const hasDivergence = (data.divergence_warnings?.length ?? 0) > 0 && !ackDivergence;

  return (
    <Card rail="llm">
      {hasDivergence && (
        <div className="flex items-start gap-2 bg-danger-soft border-b border-danger/40 px-4 py-2">
          <AlertTriangle size={14} className="text-danger mt-0.5 shrink-0" />
          <div className="flex-1 text-small text-danger">
            <div className="font-medium">LLM summary may not match the raw result.</div>
            {data.divergence_warnings?.map((w, i) => (
              <div key={i} className="text-danger/80">{w}</div>
            ))}
            <div className="mt-1 text-text-muted">
              Read the raw result above before acting on the summary.
            </div>
          </div>
          <button
            onClick={() => setAckDivergence(true)}
            className="kicker text-text-muted hover:text-text-secondary"
          >
            got it
          </button>
        </div>
      )}

      <header className="flex items-center gap-2 px-5 h-10 bg-llm-soft/60 border-b border-border-subtle">
        <Sparkles size={14} className="text-brand" />
        <Chip kind="llm">LLM · generated</Chip>
        {data.model && (
          <span className="kicker text-text-muted">{data.model}</span>
        )}
      </header>

      <div className="divide-y divide-border-subtle">
        {data.summary && (
          <div className="px-5 py-4 text-body text-text-primary leading-relaxed">
            {data.summary}
          </div>
        )}

        {(data.highlights?.length ?? 0) > 0 && (
          <div className="px-5 py-4">
            <div className="kicker mb-2">highlights</div>
            <ul className="space-y-1.5">
              {data.highlights!.map((h, i) => (
                <li key={i} className="text-small text-text-secondary flex gap-2">
                  <span className="text-brand shrink-0">·</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(data.findings?.length ?? 0) > 0 && (
          <div className="px-5 py-4">
            <div className="kicker mb-2">findings</div>
            <ul className="space-y-1.5">
              {data.findings!.map((f, i) => (
                <li
                  key={i}
                  className={cn(
                    "text-small flex gap-3",
                    f.level === "error" && "text-danger",
                    f.level === "warn" && "text-warn",
                    f.level === "info" && "text-text-primary",
                  )}
                >
                  <span className="kicker shrink-0 w-12">{f.level}</span>
                  <span>{f.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(data.suggested_commands?.length ?? 0) > 0 && (
          <div className="px-5 py-4">
            <div className="kicker mb-2">suggested</div>
            <div className="flex flex-wrap gap-2">
              {data.suggested_commands!.map((c, i) => (
                <button
                  key={i}
                  onClick={() => onSuggestionClick?.(c)}
                  className="font-mono text-small text-text-primary bg-surface-sub border border-border-subtle rounded-full px-3 h-8 hover:border-brand hover:text-brand transition-colors duration-80"
                  title="Click to copy into CommandBar (never auto-runs)"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
