"use client";

import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";

export interface ApprovalProps {
  runId: string;
  danger: boolean;
  reason?: string;
  onDecided: (approved: boolean, payload: unknown) => void;
}

export function ApprovalCard({ runId, danger, reason, onDecided }: ApprovalProps) {
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [yesText, setYesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canApprove = !danger || yesText.trim() === "YES";

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/approvals/${runId}/decide`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Slash-Actor": "human-local",
        },
        body: JSON.stringify({
          decision,
          comment: decision === "reject" ? rejectReason : undefined,
          yes_token: decision === "approve" && danger ? "YES" : undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail?.message ?? `HTTP ${r.status}`);
      onDecided(decision === "approve", body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card rail={danger ? "danger" : "write"} danger={danger} attached>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Chip kind={danger ? "danger" : "write"}>{danger ? "DANGER" : "WRITE"}</Chip>
          <span className="text-caption tracking-kicker uppercase text-text-muted">awaiting approval</span>
          {reason && (
            <>
              <span className="text-border">·</span>
              <span className="text-small text-text-secondary">reason: {reason}</span>
            </>
          )}
        </div>

        {danger && (
          <div className="font-mono text-mono-body flex items-center gap-3">
            <label htmlFor={`yes-${runId}`} className="text-caption tracking-kicker uppercase text-text-muted shrink-0">
              type YES to unlock approve
            </label>
            <input
              id={`yes-${runId}`}
              value={yesText}
              onChange={(e) => setYesText(e.target.value)}
              placeholder="YES"
              className="flex-1 bg-canvas border border-border-subtle rounded-sm px-2 h-7 text-mono-body font-mono text-text-primary focus:border-danger focus:outline-none"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="characters"
            />
          </div>
        )}

        {rejectMode && (
          <div className="flex items-center gap-3">
            <label htmlFor={`rej-${runId}`} className="text-caption tracking-kicker uppercase text-text-muted shrink-0">
              reject reason
            </label>
            <input
              id={`rej-${runId}`}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="why are you rejecting?"
              className="flex-1 bg-canvas border border-border-subtle rounded-sm px-2 h-7 text-body font-sans text-text-primary focus:border-focus focus:outline-none"
            />
          </div>
        )}

        {error && <div className="text-small text-danger">{error}</div>}

        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1" />
          {!rejectMode && (
            <button
              disabled={busy}
              onClick={() => setRejectMode(true)}
              className="h-7 px-3 text-caption tracking-kicker uppercase border border-border-subtle rounded-sm text-text-secondary hover:border-border hover:bg-elevated transition-colors duration-80 ease-m-instant disabled:opacity-50"
            >
              reject
            </button>
          )}
          {rejectMode && (
            <>
              <button
                disabled={busy}
                onClick={() => setRejectMode(false)}
                className="h-7 px-3 text-caption tracking-kicker uppercase border border-border-subtle rounded-sm text-text-muted hover:text-text-secondary"
              >
                cancel
              </button>
              <button
                disabled={busy || !rejectReason.trim()}
                onClick={() => decide("reject")}
                className="h-7 px-3 text-caption tracking-kicker uppercase border border-danger/40 bg-danger/10 text-danger rounded-sm hover:bg-danger/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                confirm reject
              </button>
            </>
          )}
          <button
            disabled={busy || !canApprove}
            onClick={() => decide("approve")}
            className={cn(
              "h-7 px-4 text-caption tracking-kicker uppercase rounded-sm border transition-colors duration-80 ease-m-instant",
              danger
                ? canApprove
                  ? "bg-danger text-white border-danger hover:brightness-110"
                  : "bg-danger/20 text-danger/70 border-danger/40 cursor-not-allowed"
                : "bg-write/20 text-write border-write/50 hover:bg-write/30",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
            aria-disabled={!canApprove}
          >
            approve
          </button>
        </div>
      </div>
    </Card>
  );
}
