import { ArrowRight } from "lucide-react";

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
}

export function PlanCard({ plan }: { plan: PlanData; attached?: boolean }) {
  return (
    <Card rail={plan.danger ? "danger" : "write"}>
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
