"use client";

import { Check, X, Circle, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * TurnPhaseBar — compact horizontal breadcrumb showing where a single Turn
 * is in the state flow documented in docs/06-ui.md §2:
 *
 *   read:  parsed  →  running  →  finished
 *   write: parsed  →  planned  →  approval  →  running  →  finished
 *
 * Uses semantic CSS tokens (text-ok / text-danger / text-text-muted) so the
 * bar matches the rest of the Card chrome in any theme.
 */

type PhaseKind = "parsed" | "planned" | "approval" | "running" | "finished";

type PhaseState =
  | "pending"   // not reached yet
  | "current"   // active right now
  | "done"      // finished successfully
  | "failed"    // this phase surfaced the terminal error
  | "rejected"; // approval was rejected (write only)

export interface PhaseStep {
  kind: PhaseKind;
  label: string;
  state: PhaseState;
}

/** Build phases for a read turn. */
export function readPhases(state: "running" | "ok" | "error"): PhaseStep[] {
  const done = (state === "ok");
  return [
    { kind: "parsed", label: "parsed",   state: "done" },
    { kind: "running", label: "running", state: state === "running" ? "current" : (state === "error" ? "failed" : "done") },
    { kind: "finished", label: "finished", state: done ? "done" : "pending" },
  ];
}

/** Build phases for a write turn. */
export function writePhases(
  stage: "waiting" | "running" | "done" | "rejected",
  resultState?: "ok" | "error",
): PhaseStep[] {
  const rejected = stage === "rejected";
  const errored  = stage === "done" && resultState === "error";
  return [
    { kind: "parsed",   label: "parsed",   state: "done" },
    { kind: "planned",  label: "planned",  state: "done" },
    {
      kind: "approval",
      label: "approval",
      state: rejected ? "rejected" : stage === "waiting" ? "current" : "done",
    },
    {
      kind: "running",
      label: "running",
      state: rejected
        ? "pending"
        : stage === "running"
          ? "current"
          : stage === "done"
            ? (errored ? "failed" : "done")
            : "pending",
    },
    {
      kind: "finished",
      label: rejected ? "—" : (errored ? "failed" : "finished"),
      state: rejected
        ? "pending"
        : stage === "done"
          ? (errored ? "failed" : "done")
          : "pending",
    },
  ];
}

export function TurnPhaseBar({ phases }: { phases: PhaseStep[] }) {
  return (
    <div
      role="status"
      aria-label="turn state flow"
      className="flex items-center gap-1.5 text-caption tracking-chip uppercase select-none"
    >
      {phases.map((p) => (
        <PhaseDot key={p.kind} step={p} />
      )).reduce<React.ReactNode[]>((acc, node, i) => {
        if (i === 0) return [node];
        return [
          ...acc,
          <PhaseConnector key={`c${i}`} from={phases[i - 1].state} to={phases[i].state} />,
          node,
        ];
      }, [])}
    </div>
  );
}

function PhaseDot({ step }: { step: PhaseStep }) {
  const tone = toneClasses(step.state);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2 rounded-full border",
        tone.bg,
        tone.border,
        tone.text,
      )}
    >
      <PhaseGlyph state={step.state} />
      <span className="font-semibold">{step.label}</span>
    </span>
  );
}

function PhaseGlyph({ state }: { state: PhaseState }) {
  if (state === "done")     return <Check size={11} aria-hidden />;
  if (state === "failed")   return <X size={11} aria-hidden />;
  if (state === "rejected") return <X size={11} aria-hidden />;
  if (state === "current") {
    return <Loader2 size={11} className="animate-spin" aria-hidden />;
  }
  return <Circle size={9} className="opacity-50" aria-hidden />;
}

function PhaseConnector({ from, to }: { from: PhaseState; to: PhaseState }) {
  // Line tint follows whichever side is more "consequential" —
  //   failed / rejected > done > current > pending.
  const active =
    from === "done" || from === "failed" || from === "rejected" ||
    to === "done"   || to === "failed"   || to === "rejected";
  return (
    <span
      aria-hidden
      className={cn(
        "h-px w-3 shrink-0",
        active ? "bg-border" : "bg-border-subtle",
      )}
    />
  );
}

function toneClasses(state: PhaseState) {
  switch (state) {
    case "done":
      return {
        bg: "bg-ok-soft",
        border: "border-ok/30",
        text: "text-ok",
      };
    case "current":
      return {
        bg: "bg-brand-tint",
        border: "border-brand/40",
        text: "text-brand-strong",
      };
    case "failed":
      return {
        bg: "bg-danger-soft",
        border: "border-danger/40",
        text: "text-danger",
      };
    case "rejected":
      return {
        bg: "bg-surface-sub",
        border: "border-border-subtle",
        text: "text-text-muted",
      };
    case "pending":
    default:
      return {
        bg: "bg-surface-sub",
        border: "border-border-subtle",
        text: "text-text-muted",
      };
  }
}
