"use client";

import { useEffect, useRef } from "react";

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
      // stages: waiting | running | done | rejected
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
    return <EmptyState onPick={onSuggestionClick} />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
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
      <section className="space-y-0">
        <UserCommandRow text={turn.command} />
        <ResultCard result={turn.result} attached />
        {turn.llm && (
          <LlmSummaryCard
            data={turn.llm}
            attached
            onSuggestionClick={onSuggestionClick}
          />
        )}
      </section>
    );
  }
  if (turn.kind === "error") {
    return (
      <section className="space-y-0">
        <UserCommandRow text={turn.command} />
        <ErrorCard error={turn.error} attached />
      </section>
    );
  }
  return (
    <section className="space-y-0">
      <UserCommandRow text={turn.command} />
      <PlanCard plan={turn.plan} attached />
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
      {turn.stage === "done" && turn.result && <ResultCard result={turn.result} attached />}
      {turn.stage === "rejected" && (
        <ErrorCard
          error={{
            code: "Rejected",
            message: `Plan rejected${turn.rejection_reason ? `: ${turn.rejection_reason}` : "."}`,
          }}
          attached
        />
      )}
    </section>
  );
}

function EmptyState({ onPick }: { onPick: (cmd: string) => void }) {
  const examples = [
    "/ops audit logs --since 1d",
    "/infra aws vm list --region us-east-1",
    "/cluster prod list pod --ns api",
  ];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 pt-16">
        <h1 className="text-hero text-text-primary">Slash.</h1>
        <p className="mt-3 text-body text-text-secondary max-w-lg">
          A strict SRE cockpit. Type a command below. Read runs now; write stages an
          approval card — nothing happens until a human clicks Approve.
        </p>
        <div className="mt-8 text-caption tracking-kicker uppercase text-text-muted mb-2">Try</div>
        <div className="border border-border-subtle rounded-md overflow-hidden">
          {examples.map((cmd, i) => (
            <button
              key={cmd}
              onClick={() => onPick(cmd)}
              className={`w-full h-9 px-4 text-left font-mono text-mono-body text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors duration-80 ease-m-instant ${
                i > 0 ? "border-t border-border-subtle" : ""
              }`}
            >
              <span className="text-text-muted mr-3">›</span>
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
