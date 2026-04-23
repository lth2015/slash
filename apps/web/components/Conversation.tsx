"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";

import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { ErrorCard, ErrorPayload } from "@/components/cards/ErrorCard";
import { LlmSummaryCard, LlmSummary } from "@/components/cards/LlmSummaryCard";
import { ParsedCard, ParsedSummary } from "@/components/cards/ParsedCard";
import { PlanCard, PlanData } from "@/components/cards/PlanCard";
import { ResultCard, ResultPayload } from "@/components/cards/ResultCard";
import { RunCard } from "@/components/cards/RunCard";
import { UserCommandRow } from "@/components/cards/UserCommandRow";
import { TurnPhaseBar, readPhases, writePhases } from "@/components/TurnPhaseBar";

export type Turn =
  | { kind: "read"; command: string; result: ResultPayload; llm?: LlmSummary }
  | { kind: "error"; command: string; error: ErrorPayload }
  | {
      kind: "write";
      command: string;
      plan: PlanData;
      stage: "waiting" | "running" | "done" | "rejected";
      result?: ResultPayload;
      rejection_reason?: string;
    };

interface Props {
  turns: Turn[];
  onApproved: (runId: string, payload: unknown) => void;
  onRejected: (runId: string) => void;
  onSuggestionClick: (cmd: string) => void;
}

export function Conversation({ turns, onApproved, onRejected, onSuggestionClick }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  if (turns.length === 0) {
    return <Welcome onPick={onSuggestionClick} />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-3 space-y-6">
        {turns.map((turn, i) => (
          <TurnView
            key={i}
            turn={turn}
            onApproved={onApproved}
            onRejected={onRejected}
            onSuggestionClick={onSuggestionClick}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function TurnView({
  turn,
  onApproved,
  onRejected,
  onSuggestionClick,
}: {
  turn: Turn;
  onApproved: (id: string, payload: unknown) => void;
  onRejected: (id: string) => void;
  onSuggestionClick: (cmd: string) => void;
}) {
  if (turn.kind === "read") {
    const result = turn.result;
    const phases = readPhases(
      result.state === "ok" ? "ok" : "error",
    );
    return (
      <section className="space-y-3">
        <UserCommandRow text={turn.command} />
        <TurnPhaseBar phases={phases} />
        <ParsedCard parsed={parsedFromResult(result)} />
        <ResultCard
          result={result}
          onRollback={onSuggestionClick}
          onAction={onSuggestionClick}
        />
        {turn.llm && (
          <LlmSummaryCard
            data={turn.llm}
            onSuggestionClick={onSuggestionClick}
          />
        )}
      </section>
    );
  }
  if (turn.kind === "error") {
    // Parse-time / network errors don't have a successful AST. We show the
    // phase bar with parsed=failed so the flow is still readable.
    return (
      <section className="space-y-3">
        <UserCommandRow text={turn.command} />
        <TurnPhaseBar
          phases={[
            { kind: "parsed", label: "parsed", state: "failed" },
            { kind: "finished", label: "—", state: "pending" },
          ]}
        />
        <ErrorCard error={turn.error} onSuggestionClick={onSuggestionClick} />
      </section>
    );
  }
  const stage = turn.stage;
  const resultState =
    turn.result?.state === "ok"
      ? "ok"
      : turn.result?.state === "error"
        ? "error"
        : undefined;
  const phases = writePhases(stage, resultState as "ok" | "error" | undefined);
  return (
    <section className="space-y-3">
      <UserCommandRow text={turn.command} />
      <TurnPhaseBar phases={phases} />
      <ParsedCard parsed={parsedFromPlan(turn.plan)} />
      <PlanCard plan={turn.plan} />
      {stage === "waiting" && (
        <ApprovalCard
          runId={turn.plan.run_id}
          danger={turn.plan.danger}
          reason={turn.plan.reason ?? undefined}
          ctxName={turn.plan.profile_name ?? null}
          ctxKind={turn.plan.profile_kind ?? null}
          onDecided={(approved, payload) =>
            approved ? onApproved(turn.plan.run_id, payload) : onRejected(turn.plan.run_id)
          }
        />
      )}
      {stage === "running" && <RunCard streaming message="" />}
      {stage === "done" && turn.result && (
        <ResultCard
          result={turn.result}
          onRollback={onSuggestionClick}
          onAction={onSuggestionClick}
        />
      )}
      {stage === "rejected" && (
        <ErrorCard
          error={{
            code: "Rejected",
            message: `Plan rejected${turn.rejection_reason ? `: ${turn.rejection_reason}` : "."}`,
          }}
          onSuggestionClick={onSuggestionClick}
        />
      )}
    </section>
  );
}

function parsedFromResult(r: ResultPayload): ParsedSummary {
  return {
    skill_id: r.skill_id,
    mode: r.mode as "read" | "write",
    flags: undefined,
    positional: undefined,
  };
}

function parsedFromPlan(p: PlanData): ParsedSummary {
  return {
    skill_id: p.skill_id,
    mode: "write",
    profile_kind: p.profile_kind ?? null,
    profile_name: p.profile_name ?? null,
  };
}

// ── Welcome / empty state ───────────────────────────────────────────────

function Welcome({ onPick }: { onPick: (cmd: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative max-w-5xl mx-auto px-8 pt-[18vh] pb-16 hero-halo">
        <div className="relative z-10">
          <h1 className="display-hero whitespace-nowrap">
            Your <span className="brand-grad">SRE copilot</span>.
          </h1>

          <div className="mt-10 flex items-center gap-4">
            <button
              onClick={() => onPick("/")}
              className="group inline-flex items-center gap-3 h-14 px-7 rounded-full bg-brand text-white font-display font-semibold text-[17px] shadow-md hover:bg-brand-strong transition-colors duration-160"
            >
              Start with
              <kbd className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 font-mono text-[16px] font-semibold">/</kbd>
              <ArrowRight size={18} className="transition-transform duration-160 group-hover:translate-x-0.5" />
            </button>
            <span className="text-small text-text-muted">
              or press <kbd className="px-1.5 py-0.5 rounded-md bg-surface-sub border border-border-subtle font-mono text-[11px]">/</kbd> any time
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
