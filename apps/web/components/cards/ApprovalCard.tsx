"use client";

import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";

export interface ApprovalProps {
  runId: string;
  danger: boolean;
  reason?: string;
  /** The resolved pin name this plan targets — for danger skills, the
   *  reviewer must type it verbatim to unlock the approve button. */
  ctxName?: string | null;
  ctxKind?: "k8s" | "aws" | "gcp" | null;
  onDecided: (approved: boolean, payload: unknown) => void;
}

const HOLD_MS = 1200;

export function ApprovalCard({
  runId,
  danger,
  reason,
  ctxName,
  ctxKind,
  onDecided,
}: ApprovalProps) {
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectCtx = (ctxName ?? "").trim();
  const typedMatches = !danger || typed.trim() === expectCtx;
  const canApprove = !busy && typedMatches && (!danger || expectCtx.length > 0);

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
          yes_token:
            decision === "approve" && danger ? typed.trim() : undefined,
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
    <Card rail={danger ? "danger" : "write"} danger={danger}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Chip kind={danger ? "danger" : "write"}>
            {danger ? "DANGER" : "AWAITING APPROVAL"}
          </Chip>
          {expectCtx && (
            <span className="text-small font-mono">
              <span className="text-text-muted">target: </span>
              <span className="text-text-primary font-semibold">
                {ctxKind ? `${ctxKind}·` : ""}{expectCtx}
              </span>
            </span>
          )}
          {reason && (
            <span className="text-small text-text-secondary">· reason: {reason}</span>
          )}
        </div>

        {danger && (
          <div className="space-y-2">
            <label
              htmlFor={`ctx-${runId}`}
              className="kicker text-danger flex items-center gap-2"
            >
              type the environment name to unlock approve
            </label>
            <input
              id={`ctx-${runId}`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={expectCtx || "(no pin resolved)"}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className={cn(
                "w-full bg-surface-sub border rounded-md px-4 h-10 text-small font-mono",
                "focus:outline-none transition-colors duration-80",
                typedMatches && expectCtx
                  ? "border-danger text-text-primary"
                  : "border-border text-text-primary focus:border-danger",
              )}
            />
          </div>
        )}

        {rejectMode && (
          <div className="flex items-center gap-3">
            <label htmlFor={`rej-${runId}`} className="kicker shrink-0">
              reject reason
            </label>
            <input
              id={`rej-${runId}`}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="why are you rejecting?"
              className="flex-1 bg-surface-sub border border-border rounded-md px-3 h-9 text-small text-text-primary focus:border-brand focus:outline-none"
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
              className="h-10 px-4 text-caption tracking-chip rounded-full border border-border-subtle bg-surface text-text-secondary hover:border-border hover:bg-elevated transition-colors duration-80 disabled:opacity-50"
            >
              reject
            </button>
          )}
          {rejectMode && (
            <>
              <button
                disabled={busy}
                onClick={() => setRejectMode(false)}
                className="h-10 px-4 text-caption tracking-chip rounded-full border border-border-subtle bg-surface text-text-muted hover:text-text-secondary"
              >
                cancel
              </button>
              <button
                disabled={busy || !rejectReason.trim()}
                onClick={() => decide("reject")}
                className="h-10 px-4 text-caption tracking-chip rounded-full bg-danger-soft border border-danger/40 text-danger hover:bg-danger/15 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                confirm reject
              </button>
            </>
          )}
          <HoldButton
            disabled={!canApprove}
            danger={danger}
            label={danger ? "hold to apply" : "approve"}
            holdMs={danger ? HOLD_MS : 0}
            onFire={() => decide("approve")}
          />
        </div>
      </div>
    </Card>
  );
}

// ── HoldButton ───────────────────────────────────────────────────────────
// For danger approvals: user must press and hold the button for HOLD_MS to
// fire. The fill animates left-to-right over the duration; releasing early
// or the press cancelling resets the fill. Mouse + touch + keyboard Space.
//
// For non-danger approvals, holdMs <= 0 → click fires immediately.

function HoldButton({
  disabled,
  danger,
  label,
  holdMs,
  onFire,
}: {
  disabled: boolean;
  danger: boolean;
  label: string;
  holdMs: number;
  onFire: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanup = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => cleanup, []);

  const start = () => {
    if (disabled) return;
    if (holdMs <= 0) {
      onFire();
      return;
    }
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      setHolding(false);
      cleanup();
      onFire();
    }, holdMs);
  };

  const cancel = () => {
    if (!holding) return;
    setHolding(false);
    cleanup();
  };

  const baseClasses = danger
    ? "bg-danger text-white"
    : "bg-brand text-white hover:bg-brand-strong";

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          cancel();
        }
      }}
      className={cn(
        "relative overflow-hidden h-10 px-6 text-caption tracking-chip rounded-full shadow-xs",
        "transition-all duration-160 select-none",
        baseClasses,
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {/* fill pill */}
      {holdMs > 0 && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 bg-white/25 pointer-events-none",
            "transition-[width] ease-linear",
          )}
          style={{
            width: holding ? "100%" : "0%",
            transitionDuration: holding ? `${holdMs}ms` : "120ms",
          }}
        />
      )}
      <span className="relative">{label}</span>
    </button>
  );
}
