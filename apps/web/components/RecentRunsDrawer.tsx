"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Check, X, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * RecentRunsDrawer — a small dropdown off the top bar that shows the most
 * recent audit rows. Click a row to fill the CommandBar with its original
 * command (never auto-runs).
 *
 * Deliberately tiny: ~10 rows max, no paging, no filter UI. Power queries
 * go through `/ops audit logs`.
 */

interface AuditRow {
  run_id: string;
  ts: string;
  command?: string;
  skill_id?: string;
  mode?: string;
  risk?: string;
  state?: string;
  duration_ms?: number;
}

export function RecentRunsDrawer({
  onPickCommand,
}: {
  onPickCommand: (cmd: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/audit?since_seconds=3600&limit=12");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      setRows(Array.isArray(body?.items) ? body.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once on first open; reload each time it's opened.
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-small",
          "transition-colors duration-80",
          open
            ? "bg-brand-tint border-brand/40 text-brand-strong"
            : "bg-surface border-border-subtle text-text-secondary hover:border-border hover:text-text-primary",
        )}
        title="recent runs"
      >
        <History size={14} aria-hidden />
        <span className="font-semibold">recent</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="recent runs"
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-30",
            "w-[min(520px,90vw)] max-h-[420px] overflow-y-auto",
            "rounded-lg border border-border bg-surface shadow-palette",
          )}
        >
          <div className="sticky top-0 flex items-center justify-between px-3 h-9 bg-surface/95 backdrop-blur-sm border-b border-border-subtle">
            <span className="kicker text-text-muted">recent runs · last hour</span>
            <button
              onClick={() => void refresh()}
              className="text-caption tracking-chip uppercase text-text-muted hover:text-text-secondary"
            >
              refresh
            </button>
          </div>

          {loading && !rows && (
            <div className="flex items-center gap-2 px-4 py-4 text-small text-text-muted">
              <Loader2 size={13} className="animate-spin" aria-hidden />
              loading…
            </div>
          )}

          {error && (
            <div className="px-4 py-4 text-small text-danger">
              {error}
            </div>
          )}

          {rows && rows.length === 0 && (
            <div className="px-4 py-4 text-small text-text-muted">
              No runs in the last hour.
            </div>
          )}

          {rows && rows.length > 0 && (
            <ul>
              {rows.map((row) => (
                <li key={row.run_id} className="border-b border-border-subtle last:border-b-0">
                  <button
                    onClick={() => {
                      if (row.command) onPickCommand(row.command);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-elevated transition-colors duration-80"
                    title={row.command || row.run_id}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <StateGlyph state={row.state} />
                      <span className="text-text-primary font-mono text-small truncate flex-1">
                        {row.command || `(${row.run_id})`}
                      </span>
                      {row.duration_ms != null && (
                        <span className="text-caption tabular text-text-muted">{row.duration_ms}ms</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-caption text-text-muted pl-6">
                      <span>{fmtTs(row.ts)}</span>
                      <span className="text-border">·</span>
                      <span className="font-mono">{row.skill_id ?? "—"}</span>
                      {row.mode && (
                        <>
                          <span className="text-border">·</span>
                          <span>{row.mode}</span>
                        </>
                      )}
                      {row.risk && (
                        <>
                          <span className="text-border">·</span>
                          <span className={riskTone(row.risk)}>risk·{row.risk}</span>
                        </>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StateGlyph({ state }: { state?: string }) {
  if (state === "ok") {
    return <Check size={13} className="text-ok" aria-hidden />;
  }
  if (state === "rejected") {
    return <X size={13} className="text-text-muted" aria-hidden />;
  }
  if (state === "error" || state === "timeout") {
    return <X size={13} className="text-danger" aria-hidden />;
  }
  if (state === "awaiting_approval") {
    return <Loader2 size={13} className="text-pending" aria-hidden />;
  }
  return <span aria-hidden className="inline-block w-3 h-3 rounded-full bg-text-muted/30" />;
}

function riskTone(risk: string): string {
  if (risk === "high") return "text-danger";
  if (risk === "medium") return "text-warn";
  return "text-ok";
}

function fmtTs(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffSec = Math.round((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return iso;
  }
}
