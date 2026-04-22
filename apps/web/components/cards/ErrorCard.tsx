"use client";

import { useState } from "react";

import { Card } from "@/components/ui/Card";

export interface ErrorPayload {
  code: string;
  message: string;
  hint?: string;
  stderr_excerpt?: string | null;
  skill_id?: string | null;
}

export function ErrorCard({ error, attached }: { error: ErrorPayload; attached?: boolean }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <Card rail="error" attached={attached}>
      <div className="p-4 space-y-2">
        <header className="flex items-center gap-2 text-caption tracking-kicker uppercase">
          <span className="text-danger">✕ {error.code}</span>
          {error.skill_id && (
            <>
              <span className="text-border">·</span>
              <span className="text-text-muted font-mono normal-case tracking-normal">{error.skill_id}</span>
            </>
          )}
        </header>
        <p className="text-body text-text-primary">
          {error.message}
        </p>
        {error.hint && <p className="text-small text-text-secondary">{error.hint}</p>}
        {error.stderr_excerpt && (
          <div className="pt-2 border-t border-border-subtle">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-caption tracking-kicker uppercase text-text-muted hover:text-text-secondary"
            >
              {showRaw ? "hide raw stderr" : "show raw stderr"}
            </button>
            {showRaw && (
              <pre className="mt-2 bg-canvas border border-border-subtle rounded-sm p-2 text-[12px] font-mono text-text-secondary whitespace-pre-wrap max-h-48 overflow-auto">
                {error.stderr_excerpt}
              </pre>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
