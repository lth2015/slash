"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

import { Card } from "@/components/ui/Card";

export interface ErrorPayload {
  code: string;
  message: string;
  hint?: string;
  stderr_excerpt?: string | null;
  skill_id?: string | null;
}

export function ErrorCard({ error }: { error: ErrorPayload; attached?: boolean }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <Card rail="error">
      <div className="p-5 space-y-3">
        <header className="flex items-center gap-2">
          <AlertCircle size={16} className="text-danger" />
          <span className="display-lg text-text-primary">{error.code}</span>
          {error.skill_id && (
            <span className="text-small text-text-muted font-mono">· {error.skill_id}</span>
          )}
        </header>
        <p className="text-body text-text-primary leading-relaxed">{error.message}</p>
        {error.hint && <p className="text-small text-text-secondary">{error.hint}</p>}
        {error.stderr_excerpt && (
          <div className="pt-2 border-t border-border-subtle">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="kicker text-text-muted hover:text-text-secondary"
            >
              {showRaw ? "hide raw stderr" : "show raw stderr"}
            </button>
            {showRaw && (
              <pre className="mt-2 bg-surface-sub border border-border-subtle rounded-lg p-3 text-[12.5px] font-mono text-text-secondary whitespace-pre-wrap max-h-48 overflow-auto">
                {error.stderr_excerpt}
              </pre>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
