import { ArrowRight, CircleDashed } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";

export interface PlanData {
  run_id: string;
  command: string;
  skill_id: string;
  danger: boolean;
  before?: { value?: unknown } | null;
  after?: { value?: unknown } | null;
  rollback_hint?: string | null;
  reason?: string | null;
  /** The resolved profile this plan will apply against (pin or --ctx). */
  profile_kind?: "k8s" | "aws" | "gcp" | null;
  profile_name?: string | null;
  /** Populated when the write was staged within 60s of a pin change —
   *  drives the drift banner at the top of the card. */
  drift?: {
    kind: "k8s" | "aws" | "gcp";
    name: string;
    since_seconds: number;
  } | null;
}

export function PlanCard({ plan }: { plan: PlanData; attached?: boolean }) {
  return (
    <Card rail={plan.danger ? "danger" : "write"}>
      {plan.drift && <DriftBanner drift={plan.drift} />}
      <div className="p-5 space-y-4">
        <header className="flex items-center gap-2">
          <Chip kind={plan.danger ? "danger" : "write"}>
            {plan.danger ? "DANGER" : "PLAN"}
          </Chip>
          <span className="font-mono text-small text-text-secondary">{plan.skill_id}</span>
        </header>

        {(plan.before || plan.after) && (
          <div className="font-mono text-small space-y-2 bg-surface-sub rounded-lg p-4 border border-border-subtle">
            <div className="grid grid-cols-[80px_1fr] gap-x-3 items-baseline">
              <span className="kicker text-text-muted">before</span>
              <span className="text-text-secondary break-all">
                {fmt(plan.before?.value) ?? "—"}
              </span>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-x-3 items-baseline">
              <span className="kicker text-brand">after</span>
              <span className="text-text-primary font-medium flex items-center gap-2 break-all">
                <ArrowRight size={13} className="text-brand shrink-0" />
                {fmt(plan.after?.value) ?? "—"}
              </span>
            </div>
          </div>
        )}

        {plan.rollback_hint && (
          <div className="rounded-lg bg-warn-soft/60 border border-warn/30 p-3">
            <div className="kicker text-warn mb-1">rollback</div>
            <pre className="font-mono text-small text-text-secondary whitespace-pre-wrap">{plan.rollback_hint}</pre>
          </div>
        )}

        <div className="text-small text-text-muted">
          {plan.danger
            ? "Needs 1 approver + typed YES confirmation · audit recorded on apply"
            : "Needs 1 approver · audit recorded on apply"}
        </div>
      </div>
    </Card>
  );
}

function fmt(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Drift guard: a calm second-look nudge when the write landed within 60s
 *  of the user pinning a different context. Not a block — tone is "Intended?"
 *  not "STOP". The banner fades into the top of the Plan card, inheriting
 *  the warn tint (amber) to sit between read-green and write-orange. */
function DriftBanner({ drift }: { drift: NonNullable<PlanData["drift"]> }) {
  const ago = drift.since_seconds < 10
    ? `${Math.max(1, Math.round(drift.since_seconds))}s`
    : `${Math.round(drift.since_seconds)}s`;
  return (
    <div className="flex items-start gap-3 px-5 py-3 bg-warn-soft/60 border-b border-warn/25">
      <CircleDashed size={15} className="mt-0.5 text-warn shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-small text-text-primary leading-snug">
          You pinned <span className="font-mono font-semibold">{drift.kind}·{drift.name}</span> {ago} ago.
          <span className="text-text-muted"> Intended?</span>
        </div>
      </div>
    </div>
  );
}
