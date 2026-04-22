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
    { cmd: "/ops audit logs --since 1d", hint: "read · audit trail" },
    { cmd: "/infra aws vm list --region us-east-1", hint: "read · inventory" },
    { cmd: "/cluster prod list pod --ns api", hint: "read · kube" },
  ];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative max-w-3xl mx-auto px-6 pt-20 pb-10 hero-halo">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 h-6 px-2.5 rounded-full border border-accent/40 bg-accent/10 text-caption tracking-kicker uppercase text-accent">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden />
            cockpit · online
          </div>

          <h1 className="mt-5 font-semibold tracking-tight text-[56px] leading-[1.02]">
            <span className="brand-grad">Slash.</span>
          </h1>
          <p className="mt-4 text-lead text-text-secondary max-w-xl">
            A strict SRE cockpit. Type a command below — read runs now, write stages an
            approval card. Nothing touches prod until a human clicks{" "}
            <span className="text-accent font-medium">Approve</span>.
          </p>

          <div className="mt-10 flex items-center gap-3 text-caption tracking-kicker uppercase text-text-muted">
            <span>Try</span>
            <span className="flex-1 h-px bg-border-subtle" />
          </div>
          <div className="mt-3 rounded-lg border border-border-subtle bg-surface/60 backdrop-blur-sm overflow-hidden">
            {examples.map(({ cmd, hint }, i) => (
              <button
                key={cmd}
                onClick={() => onPick(cmd)}
                className={`group w-full h-11 px-4 flex items-center gap-3 text-left transition-colors duration-80 ease-m-instant hover:bg-accent/5 ${
                  i > 0 ? "border-t border-border-subtle" : ""
                }`}
              >
                <span className="text-accent/70 group-hover:text-accent font-mono">›</span>
                <span className="font-mono text-mono-body text-text-secondary group-hover:text-text-primary flex-1 truncate">
                  {cmd}
                </span>
                <span className="text-caption tracking-kicker uppercase text-text-muted group-hover:text-text-secondary">
                  {hint}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
