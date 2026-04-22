import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/Card";

export interface PlanData {
  run_id: string;
  command: string;
  skill_id: string;
  danger: boolean;
  before?: { value?: unknown } | null;
  after?: { value?: unknown } | null;
  rollback_hint?: string | null;
  reason?: string | null;
}

export function PlanCard({ plan, attached }: { plan: PlanData; attached?: boolean }) {
  return (
    <Card rail={plan.danger ? "danger" : "write"} attached={attached}>
      <div className="p-4 space-y-3">
        <header className="flex items-center gap-2 text-caption tracking-kicker uppercase text-text-muted">
          <span>plan</span>
          <span className="text-border">·</span>
          <span className="font-mono normal-case tracking-normal text-text-secondary">{plan.skill_id}</span>
        </header>

        {(plan.before || plan.after) && (
          <div className="font-mono text-mono-body space-y-1">
            <div className="flex items-center gap-3">
              <span className="w-14 text-caption tracking-kicker uppercase text-text-muted">before</span>
              <span className="text-text-secondary">
                {fmt(plan.before?.value) ?? "—"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-14 text-caption tracking-kicker uppercase text-text-muted">after</span>
              <ArrowRight size={11} className="text-text-muted" />
              <span className="text-text-primary font-medium">
                {fmt(plan.after?.value) ?? "—"}
              </span>
            </div>
          </div>
        )}

        {plan.rollback_hint && (
          <div className="pt-2 border-t border-border-subtle">
            <div className="text-caption tracking-kicker uppercase text-text-muted mb-1">rollback</div>
            <pre className="text-mono-body font-mono text-text-secondary whitespace-pre-wrap">{plan.rollback_hint}</pre>
          </div>
        )}

        <div className="pt-2 border-t border-border-subtle text-small text-text-muted">
          {plan.danger
            ? "needs 1 approver + YES confirmation · audit recorded on apply"
            : "needs 1 approver · audit recorded on apply"}
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
