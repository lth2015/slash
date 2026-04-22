"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";

import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { ErrorCard, ErrorPayload } from "@/components/cards/ErrorCard";
import { LlmSummaryCard, LlmSummary } from "@/components/cards/LlmSummaryCard";
import { PlanCard, PlanData } from "@/components/cards/PlanCard";
import { ResultCard, ResultPayload } from "@/components/cards/ResultCard";
import { RunCard } from "@/components/cards/RunCard";
import { UserCommandRow } from "@/components/cards/UserCommandRow";

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
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
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
    return (
      <section className="space-y-3">
        <UserCommandRow text={turn.command} />
        <ResultCard result={turn.result} onRollback={onSuggestionClick} />
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
    return (
      <section className="space-y-3">
        <UserCommandRow text={turn.command} />
        <ErrorCard error={turn.error} />
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <UserCommandRow text={turn.command} />
      <PlanCard plan={turn.plan} />
      {turn.stage === "waiting" && (
        <ApprovalCard
          runId={turn.plan.run_id}
          danger={turn.plan.danger}
          reason={turn.plan.reason ?? undefined}
          onDecided={(approved, payload) =>
            approved ? onApproved(turn.plan.run_id, payload) : onRejected(turn.plan.run_id)
          }
        />
      )}
      {turn.stage === "running" && <RunCard streaming message="" />}
      {turn.stage === "done" && turn.result && (
        <ResultCard result={turn.result} onRollback={onSuggestionClick} />
      )}
      {turn.stage === "rejected" && (
        <ErrorCard
          error={{
            code: "Rejected",
            message: `Plan rejected${turn.rejection_reason ? `: ${turn.rejection_reason}` : "."}`,
          }}
        />
      )}
    </section>
  );
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
