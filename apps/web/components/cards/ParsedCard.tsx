import { Braces } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";

/**
 * ParsedCard — a one-liner that keeps the parse result visible in the
 * conversation flow. The CommandBar's StatusLine only shows this during
 * typing; once a Turn lands it disappears, which makes it hard to tell
 * later exactly how an ambiguous input was resolved.
 *
 * Renders the (skill, mode, resolved profile, notable flag set) tuple.
 */

export interface ParsedSummary {
  skill_id: string;
  mode: "read" | "write";
  profile_kind?: string | null;
  profile_name?: string | null;
  /** Top 2-3 flags to make visible (reason/ns/replicas …) */
  flags?: Record<string, unknown>;
  /** Positional args — collapsed to a list of strings */
  positional?: unknown[];
}

export function ParsedCard({ parsed }: { parsed: ParsedSummary }) {
  return (
    <Card rail={parsed.mode === "write" ? "write" : "ok"}>
      <div className="flex items-center gap-2 px-4 h-8 text-small font-mono overflow-x-auto">
        <Braces size={13} className="text-text-muted shrink-0" aria-hidden />
        <span className="kicker text-text-muted shrink-0">parsed</span>
        <span className="text-text-primary font-semibold">{parsed.skill_id}</span>
        <Chip kind={parsed.mode === "write" ? "write" : "read"}>
          {parsed.mode.toUpperCase()}
        </Chip>
        {parsed.profile_kind && parsed.profile_name && (
          <span className="text-text-secondary whitespace-nowrap">
            <span className="text-text-muted">{parsed.profile_kind}·</span>
            <span className="text-text-primary">{parsed.profile_name}</span>
          </span>
        )}
        {parsed.positional && parsed.positional.length > 0 && (
          <span className="text-text-secondary whitespace-nowrap">
            <span className="text-text-muted">args </span>
            <span className="text-text-primary">{parsed.positional.map(String).join(" ")}</span>
          </span>
        )}
        {parsed.flags && Object.keys(parsed.flags).length > 0 && (
          <span className="text-text-secondary whitespace-nowrap">
            <span className="text-text-muted">flags </span>
            <span className="text-text-primary">{fmtFlags(parsed.flags)}</span>
          </span>
        )}
      </div>
    </Card>
  );
}

function fmtFlags(flags: Record<string, unknown>): string {
  // Show up to 3 flag=value pairs; drop `reason` (it's free-text noise at
  // a glance; still visible on the full PlanCard / ResultCard).
  const keep = Object.entries(flags).filter(([k]) => k !== "reason").slice(0, 3);
  return keep.map(([k, v]) => `${k}=${fmtScalar(v)}`).join(" ");
}

function fmtScalar(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v.length > 32 ? v.slice(0, 29) + "…" : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
