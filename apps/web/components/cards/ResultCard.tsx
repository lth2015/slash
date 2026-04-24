"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsUpDown, Inbox, MoreHorizontal, RotateCcw, Search } from "lucide-react";

import { Card, CardMeta } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";
import {
  CtxInventory,
  EventTimeline,
  MetricsSparkline,
  MultiMetricChart,
  RolloutBanner,
  SecurityGroupRules,
} from "@/components/cards/views";

type Column = {
  key: string;
  label: string;
  width?: number;
  renderer?: "state-badge" | "relative-time" | "default";
  fallback?: string;
};

/** A row_action declares one follow-up skill invocation applied to a table
 *  row. `command` is a slash-command template; any `${path.to.key}` tokens
 *  are resolved against the row object at click time. The resolved command
 *  is dropped into the CommandBar (never auto-run) so the user sees the
 *  full shape and can edit required args (like --reason) before Enter. */
export interface RowAction {
  label: string;
  command: string;
}

export interface OutputSpec {
  kind?:
    | "table"
    | "object"
    | "log"
    | "chart"
    | "rollout-banner"
    | "event-timeline"
    | "metrics-sparkline"
    | "multi-metric-chart"
    | "sg-rules"
    | "ctx-inventory";
  parse?: "json" | "text" | "lines";
  path?: string;
  columns?: Column[];
  row_actions?: RowAction[];
}

export interface StepResult {
  id: string;
  state: "ok" | "error" | "timeout" | "skipped";
  exit_code: number | null;
  duration_ms: number;
  started_at: string;
  ended_at: string;
  argv: string[];
}

export interface ResultPayload {
  run_id: string;
  skill_id: string;
  mode: "read" | "write";
  state: "ok" | "error";
  outputs: unknown;
  stdout_excerpt?: string | null;
  duration_ms?: number | null;
  output_spec?: OutputSpec | null;
  profile?: { kind?: string | null; name?: string | null } | null;
  ts?: string;
  /** Pre-rendered slash command that inverts this change; present only for
   *  write skills whose spec.rollback could be fully resolved at plan time. */
  rollback_command?: string | null;
  /** Per-step breakdown for multi-step writes (spec.bash.steps). Empty or
   *  undefined for single-step skills. */
  per_step_results?: StepResult[];
}

export function ResultCard({
  result,
  onRollback,
  onAction,
}: {
  result: ResultPayload;
  attached?: boolean;
  /** Called when the user clicks "Roll back". Receives the pre-rendered slash
   *  command; consumer should populate the CommandBar with it (not auto-run). */
  onRollback?: (cmd: string) => void;
  /** Called when the user picks a row action. Receives the interpolated
   *  slash command; consumer should populate the CommandBar with it. */
  onAction?: (cmd: string) => void;
}) {
  const spec = result.output_spec ?? {};
  const kind = spec.kind ?? "object";
  const rowCount = asArray(result.outputs).length;
  const canRollback =
    result.mode === "write" &&
    result.state === "ok" &&
    !!result.rollback_command;
  return (
    <Card rail={result.state === "ok" ? "ok" : "error"}>
      <CardMeta
        hash={result.run_id}
        ts={result.ts}
        profile={[result.profile?.kind, result.profile?.name].filter(Boolean).join(" / ") || null}
      />
      <div className="border-t border-border-subtle">
        {kind === "table" && (
          <TableView
            rows={asArray(result.outputs)}
            columns={spec.columns ?? []}
            rowActions={spec.row_actions}
            onAction={onAction}
          />
        )}
        {kind === "object" && <ObjectView value={result.outputs} />}
        {kind === "log" && <LogView text={String(result.outputs ?? "")} />}
        {kind === "chart" && <ObjectView value={result.outputs} />}
        {kind === "rollout-banner" && (
          <RolloutBanner text={String(result.outputs ?? "")} />
        )}
        {kind === "event-timeline" && (
          <EventTimeline
            rows={asArray(result.outputs)}
            rowActions={spec.row_actions}
            onAction={onAction}
          />
        )}
        {kind === "metrics-sparkline" && (
          <MetricsSparkline value={result.outputs} />
        )}
        {kind === "multi-metric-chart" && (
          <MultiMetricChart value={result.outputs} />
        )}
        {kind === "sg-rules" && (
          <SecurityGroupRules rows={asArray(result.outputs)} />
        )}
        {kind === "ctx-inventory" && (
          <CtxInventory value={result.outputs} onAction={onAction} />
        )}

        {result.per_step_results && result.per_step_results.length > 0 && (
          <PerStepPanel steps={result.per_step_results} />
        )}

        {canRollback && (
          <div className="px-4 py-3 bg-warn-soft/40 border-t border-border-subtle flex items-start gap-3">
            <RotateCcw size={14} className="mt-0.5 text-warn shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="kicker text-warn mb-1">executable rollback available</div>
              <code className="block font-mono text-[12.5px] text-text-secondary truncate">
                {result.rollback_command}
              </code>
            </div>
            <button
              onClick={() => onRollback?.(result.rollback_command ?? "")}
              className="shrink-0 h-8 px-3 rounded-full bg-surface border border-warn/50 text-warn text-caption tracking-chip font-mono hover:bg-warn hover:text-white transition-colors duration-160"
            >
              roll back
            </button>
          </div>
        )}

        <footer className="h-8 px-4 flex items-center gap-3 text-caption tracking-chip text-text-muted border-t border-border-subtle bg-surface-sub">
          <Chip kind={result.mode === "write" ? "write" : "read"}>{result.mode}</Chip>
          <span className="font-mono text-text-secondary">{result.skill_id}</span>
          {typeof result.duration_ms === "number" && (
            <>
              <span className="text-border">·</span>
              <span className="tabular font-mono">{result.duration_ms} ms</span>
            </>
          )}
          {kind === "table" && (
            <>
              <span className="text-border">·</span>
              <span className="tabular font-mono">{rowCount} rows</span>
            </>
          )}
        </footer>
      </div>
    </Card>
  );
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

// ── Table ──────────────────────────────────────────────────────────────
// For lists of meaningful size we reduce noise with three affordances:
//   1. A search box that filters rows via substring match across all cells.
//      Backed by a simple join-and-includes so no new dep and instantly fast.
//   2. A default row cap (DEFAULT_ROW_LIMIT) so 200-row k8s event lists don't
//      drown the screen. A single chip reveals the rest when needed.
//   3. Click-to-expand per row — opens a detail panel showing the raw row JSON
//      (dl layout) plus row_actions as full-width buttons. This turns the
//      table into summary → drill-down rather than a wall of text.

const DEFAULT_ROW_LIMIT = 20;

function TableView({
  rows,
  columns,
  rowActions,
  onAction,
}: {
  rows: unknown[];
  columns: Column[];
  rowActions?: RowAction[];
  onAction?: (cmd: string) => void;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = String(resolveKey(a, sortKey) ?? "");
      const bv = String(resolveKey(b, sortKey) ?? "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((row) => {
      // Match against every column's resolved value — cheap and covers what the
      // user actually sees. Fallback to full JSON for rows with keys that
      // aren't declared as columns.
      for (const c of columns) {
        const v = resolveKey(row, c.key);
        if (v != null && String(v).toLowerCase().includes(q)) return true;
      }
      try {
        return JSON.stringify(row).toLowerCase().includes(q);
      } catch {
        return false;
      }
    });
  }, [sorted, columns, query]);

  const stateSummary = useMemo(() => buildStateSummary(rows, columns), [rows, columns]);

  if (rows.length === 0) {
    return (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted">
        <Inbox size={22} strokeWidth={1.8} aria-hidden />
        <div className="text-small">No rows matched.</div>
        <div className="text-caption text-text-muted/80">The command ran cleanly — just nothing to show.</div>
      </div>
    );
  }

  const hasActions = !!(rowActions && rowActions.length && onAction);
  const showSearch = rows.length >= 6;
  const capApplied = !showAll && !query && filtered.length > DEFAULT_ROW_LIMIT;
  const visible = capApplied ? filtered.slice(0, DEFAULT_ROW_LIMIT) : filtered;

  return (
    <div>
      {stateSummary && <TableSummaryStrip total={rows.length} {...stateSummary} />}
      {showSearch && (
        <TableFilterBar
          query={query}
          onQuery={setQuery}
          total={rows.length}
          matched={filtered.length}
          onClear={() => {
            setQuery("");
            setExpandedRow(null);
          }}
        />
      )}
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-small">
        <thead>
          <tr className="bg-surface-sub border-b border-border-subtle">
            <th className="w-6" aria-label="expand" />
            {columns.map((c) => (
              <th
                key={c.key}
                className="h-9 px-4 text-left kicker font-normal select-none cursor-pointer"
                onClick={() => {
                  if (sortKey === c.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  else { setSortKey(c.key); setSortDir("asc"); }
                }}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {sortKey === c.key ? (
                    <ChevronDown
                      size={10}
                      className={cn("transition-transform", sortDir === "asc" ? "" : "rotate-180")}
                    />
                  ) : (
                    <ChevronsUpDown size={10} className="text-text-muted" />
                  )}
                </span>
              </th>
            ))}
            {hasActions && <th className="w-10" aria-label="actions" />}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => (
            <Fragment key={i}>
            <tr
              className={cn(
                "border-b border-border-subtle last:border-b-0 transition-colors duration-80 cursor-pointer",
                expandedRow === i ? "bg-elevated" : "hover:bg-elevated",
              )}
              onClick={() => setExpandedRow((cur) => (cur === i ? null : i))}
            >
              <td
                className="w-6 px-1 text-text-muted select-none"
                aria-label={expandedRow === i ? "collapse" : "expand"}
              >
                <ChevronRight
                  size={12}
                  className={cn(
                    "transition-transform duration-160",
                    expandedRow === i && "rotate-90",
                  )}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className="h-9 px-4 whitespace-nowrap">
                  <CellRenderer row={row} col={c} />
                </td>
              ))}
              {hasActions && (
                <td
                  className="w-10 px-2 whitespace-nowrap relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RowActionMenu
                    open={openRow === i}
                    onToggle={(next) => setOpenRow(next ? i : null)}
                    row={row}
                    actions={rowActions!}
                    onPick={(cmd) => {
                      onAction!(cmd);
                      setOpenRow(null);
                    }}
                  />
                </td>
              )}
            </tr>
            {expandedRow === i && (
              <tr className="bg-surface-sub border-b border-border-subtle">
                <td />
                <td
                  colSpan={columns.length + (hasActions ? 1 : 0)}
                  className="px-4 py-3"
                >
                  <RowDetail
                    row={row}
                    columns={columns}
                    actions={hasActions ? rowActions : undefined}
                    onAction={onAction}
                  />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
    {capApplied && (
      <button
        onClick={() => setShowAll(true)}
        className="w-full h-9 text-caption tracking-chip uppercase font-semibold text-brand hover:bg-brand-tint border-t border-border-subtle transition-colors duration-80"
      >
        + {filtered.length - DEFAULT_ROW_LIMIT} more rows · show all
      </button>
    )}
    {query && filtered.length === 0 && (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted border-t border-border-subtle">
        <div className="text-small">No rows match <code className="font-mono text-text-secondary">{query}</code>.</div>
        <button
          onClick={() => setQuery("")}
          className="text-caption tracking-chip uppercase text-brand hover:underline"
        >
          clear search
        </button>
      </div>
    )}
    </div>
  );
}

// ── Table filter bar — search input + matched/total count ─────────────
function TableFilterBar({
  query,
  onQuery,
  total,
  matched,
  onClear,
}: {
  query: string;
  onQuery: (v: string) => void;
  total: number;
  matched: number;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-canvas">
      <div className="flex items-center gap-2 flex-1 max-w-md">
        <Search size={13} className="text-text-muted shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="filter rows…"
          className="flex-1 h-7 bg-transparent text-small font-mono outline-none placeholder:text-text-muted/70"
        />
        {query && (
          <button
            onClick={onClear}
            className="kicker text-text-muted hover:text-text-secondary shrink-0"
            aria-label="clear search"
          >
            clear
          </button>
        )}
      </div>
      <span className="ml-auto text-caption tracking-chip uppercase text-text-muted tabular font-mono">
        {query ? `${matched} / ${total}` : `${total} rows`}
      </span>
    </div>
  );
}

// ── Row detail panel — expanded view shown when the user clicks a row ──
//
// Two jobs:
//   1. Dump the row's raw key-value pairs so the user can see everything
//      the table summarized away. Generic, no per-skill config.
//   2. Surface row_actions as full-width buttons rather than buried in an
//      ellipsis menu — once a user has drilled in, next-step actions are
//      the obvious next thing to see.
function RowDetail({
  row,
  columns,
  actions,
  onAction,
}: {
  row: unknown;
  columns: Column[];
  actions?: RowAction[];
  onAction?: (cmd: string) => void;
}) {
  const entries = useMemo(() => {
    if (row == null || typeof row !== "object") {
      return [{ key: "value", value: row }];
    }
    return Object.entries(row as Record<string, unknown>).map(([key, value]) => ({
      key,
      value,
    }));
  }, [row]);
  // Columns are already shown in the row's collapsed form, so emphasize
  // the *extra* fields in the detail view. Keep all fields visible
  // though — users often need the "hidden" ones.
  const primaryKeys = new Set(columns.map((c) => c.key.split(".")[0]));

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[140px_1fr] gap-x-5 gap-y-1.5 text-small">
        {entries.map(({ key, value }) => {
          const isPrimary = primaryKeys.has(key);
          return (
            <div key={key} className="contents">
              <dt
                className={cn(
                  "kicker text-right pt-0.5",
                  isPrimary ? "text-text-muted" : "text-text-secondary font-semibold",
                )}
              >
                {key}
              </dt>
              <dd className="font-mono text-text-primary break-words">
                <DetailValue v={value} />
              </dd>
            </div>
          );
        })}
      </dl>
      {actions && actions.length > 0 && onAction && (
        <div className="flex flex-wrap gap-2 pt-1.5 border-t border-border-subtle">
          {actions.map((a, idx) => {
            const resolved = a.command.replace(/\$\{([^}]+)\}/g, (m, p: string) => {
              const v = resolveKey(row, p);
              return v == null || v === "" ? m : String(v);
            });
            const broken = resolved.includes("${");
            return (
              <button
                key={idx}
                disabled={broken}
                onClick={() => onAction(resolved)}
                title={resolved}
                className={cn(
                  "inline-flex items-center h-7 px-3 rounded-full text-caption tracking-chip uppercase font-semibold",
                  "border transition-colors duration-80",
                  broken
                    ? "opacity-40 cursor-not-allowed border-border-subtle text-text-muted"
                    : "border-brand bg-brand text-white hover:bg-brand-strong",
                )}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailValue({ v }: { v: unknown }) {
  if (v == null) return <span className="text-text-muted">—</span>;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return <>{String(v)}</>;
  }
  // Objects & arrays: pretty-print but bounded height. Click to expand further.
  return (
    <pre className="whitespace-pre-wrap break-all text-[12px] text-text-secondary max-h-40 overflow-auto">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}

// ── Table summary strip — aggregate state breakdown for at-a-glance view ─

type StateBucket = "ok" | "warn" | "danger" | "neutral";

interface StateSummary {
  label: string;             // column label, e.g. "Phase"
  buckets: Map<string, { count: number; tone: StateBucket }>;
}

function buildStateSummary(
  rows: unknown[],
  columns: Column[],
): StateSummary | null {
  // Only meaningful with enough rows to warrant a rollup.
  if (rows.length < 3) return null;
  const stateCol = columns.find((c) => c.renderer === "state-badge");
  if (!stateCol) return null;
  const buckets = new Map<string, { count: number; tone: StateBucket }>();
  for (const row of rows) {
    const raw = resolveKey(row, stateCol.key);
    if (raw == null) continue;
    const v = String(raw);
    const tone = stateTone(v);
    const prev = buckets.get(v);
    if (prev) prev.count += 1;
    else buckets.set(v, { count: 1, tone });
  }
  if (buckets.size === 0) return null;
  // If everything is in one bucket AND it's OK, suppress the strip
  // (nothing to flag; the table header says enough).
  if (buckets.size === 1) {
    const only = [...buckets.values()][0];
    if (only.tone === "ok") return null;
  }
  return { label: stateCol.label, buckets };
}

function stateTone(value: string): StateBucket {
  const v = value.toLowerCase();
  if (v === "running" || v === "ready" || v === "ok" || v === "active" || v === "true" || v === "available" || v === "succeeded")
    return "ok";
  if (v === "pending" || v === "unknown" || v === "waiting" || v === "progressing" || v === "warn")
    return "warn";
  if (
    v === "failed" || v === "error" || v === "crashloopbackoff" ||
    v === "errimagepull" || v === "imagepullbackoff" || v === "oomkilled" ||
    v === "notready" || v === "unschedulable" || v === "false"
  )
    return "danger";
  return "neutral";
}

function TableSummaryStrip({
  total,
  label,
  buckets,
}: {
  total: number;
  label: string;
  buckets: StateSummary["buckets"];
}) {
  // Sort: danger → warn → ok → neutral so eyes land on problems first.
  const order: Record<StateBucket, number> = { danger: 0, warn: 1, ok: 2, neutral: 3 };
  const items = [...buckets.entries()]
    .sort(([, a], [, b]) => order[a.tone] - order[b.tone]);
  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-surface-sub/60 border-b border-border-subtle">
      <span className="text-caption tracking-chip uppercase text-text-muted shrink-0">
        {total} · {label}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {items.map(([value, { count, tone }]) => (
          <span
            key={value}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-caption",
              "tracking-chip uppercase font-semibold border",
              tone === "ok" && "bg-ok-soft text-ok border-ok/30",
              tone === "warn" && "bg-warn-soft text-warn border-warn/40",
              tone === "danger" && "bg-danger-soft text-danger border-danger/40",
              tone === "neutral" && "bg-surface text-text-muted border-border-subtle",
            )}
            title={`${count} × ${value}`}
          >
            <span className="tabular font-mono">{count}</span>
            <span className="font-mono normal-case">{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Row action menu ────────────────────────────────────────────────────
function RowActionMenu({
  open,
  onToggle,
  row,
  actions,
  onPick,
}: {
  open: boolean;
  onToggle: (next: boolean) => void;
  row: unknown;
  actions: RowAction[];
  onPick: (cmd: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Esc close. Registered while open so the cost is zero
  // for the overwhelming majority of rows (closed).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) onToggle(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onToggle]);

  const rendered = useMemo(
    () => actions.map((a) => ({ ...a, resolved: interpolateRow(a.command, row) })),
    [actions, row],
  );

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(!open); }}
        className={cn(
          "w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-80",
          open ? "bg-brand-tint text-brand" : "text-text-muted hover:bg-elevated hover:text-text-primary",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Act on this row"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full mt-1 z-30",
            "min-w-[320px] max-w-[520px]",
            "bg-surface border border-border rounded-xl shadow-palette",
            "animate-pop-in overflow-hidden",
          )}
        >
          <div className="px-4 h-9 flex items-center border-b border-border-subtle bg-surface-sub">
            <span className="kicker text-brand">Act on this row</span>
          </div>
          <ul>
            {rendered.map((a, idx) => {
              const broken = a.resolved.includes("${");
              return (
                <li key={idx}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={broken}
                    onClick={() => onPick(a.resolved)}
                    className={cn(
                      "w-full text-left px-4 py-2.5 flex flex-col gap-0.5",
                      "border-b border-border-subtle last:border-b-0",
                      broken
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-brand-tint transition-colors duration-80",
                    )}
                  >
                    <span className="font-display font-semibold text-[13px] text-text-primary">
                      {a.label}
                    </span>
                    <span className="font-mono text-[12px] text-text-secondary truncate">
                      {a.resolved}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-4 h-7 flex items-center border-t border-border-subtle bg-surface-sub text-caption tracking-chip text-text-muted">
            inserts into Command Bar · press ↵ to run
          </div>
        </div>
      )}
    </div>
  );
}

/** Interpolate `${dotted.path}` tokens in a template against a row object.
 *  Unresolved placeholders are left intact so the menu can gray out the
 *  action instead of silently emitting a broken command. */
function interpolateRow(template: string, row: unknown): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const v = resolveKey(row, path);
    if (v === undefined || v === null || v === "") return match;
    return String(v);
  });
}

function CellRenderer({ row, col }: { row: unknown; col: Column }) {
  const raw = resolveKey(row, col.key);
  const value = raw ?? col.fallback ?? "—";
  if (col.renderer === "state-badge" && typeof value === "string") {
    return <StateBadge value={value} />;
  }
  if (col.renderer === "relative-time" && (typeof value === "string" || value instanceof Date)) {
    return <span className="text-text-secondary">{formatRelativeTime(value)}</span>;
  }
  return <span className={typeof value === "string" && /^\d/.test(value) ? "tabular" : undefined}>{String(value)}</span>;
}

function StateBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  if (v === "running" || v === "ready" || v === "ok" || v === "active") return <Chip kind="ok">{value}</Chip>;
  if (v === "pending" || v === "unknown" || v === "waiting") return <Chip kind="await">{value}</Chip>;
  if (v === "stopped" || v === "terminated" || v === "rejected") return <Chip kind="rejected">{value}</Chip>;
  if (v === "failed" || v === "error" || v === "crashloopbackoff") return <Chip kind="fail">{value}</Chip>;
  if (v === "warn") return <Chip kind="warn">{value}</Chip>;
  if (v === "write") return <Chip kind="write">{value}</Chip>;
  if (v === "read") return <Chip kind="read">{value}</Chip>;
  return <Chip kind="rejected">{value}</Chip>;
}

function formatRelativeTime(ts: string | Date): string {
  const t = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(t.getTime())) return String(ts);
  const s = (Date.now() - t.getTime()) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function resolveKey(row: unknown, key: string): unknown {
  if (row == null) return undefined;
  let cur: unknown = row;
  for (const seg of key.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const kv = cur as Array<{ Key?: string; Value?: unknown }>;
      if (kv.every((x) => x && typeof x === "object" && "Key" in x && "Value" in x)) {
        const match = kv.find((x) => x.Key === seg);
        cur = match?.Value;
        continue;
      }
      return undefined;
    }
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ── Object ─────────────────────────────────────────────────────────────
function ObjectView({ value }: { value: unknown }) {
  const [showRaw, setShowRaw] = useState(false);
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);

  if (value == null) {
    return (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted">
        <Inbox size={22} strokeWidth={1.8} aria-hidden />
        <div className="text-small">No output.</div>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div className="p-5 space-y-2">
        <div className="kicker">{value.length} items</div>
        <pre className="font-mono text-small text-text-primary whitespace-pre overflow-x-auto bg-surface-sub rounded-lg p-4 border border-border-subtle">
          {json}
        </pre>
      </div>
    );
  }

  if (typeof value === "object") {
    // Shape-detect: anything that looks like a kubectl .status object
    // (array of {type, status} conditions + replica counts) gets a rich
    // card rendering instead of the key-value dump. This is deliberately
    // generic — /app status / /cluster get deploy / any future skill that
    // projects a Deployment's .status subtree picks it up automatically.
    if (looksLikeKubeStatus(value)) {
      return (
        <KubeStatusView
          status={value as Record<string, unknown>}
          json={json}
          showRaw={showRaw}
          onToggleRaw={() => setShowRaw((s) => !s)}
        />
      );
    }

    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="p-5">
        <div className="flex items-center justify-end mb-2">
          <button
            onClick={() => setShowRaw((s) => !s)}
            className="kicker text-text-muted hover:text-text-secondary"
          >
            {showRaw ? "hide raw" : "view raw"}
          </button>
        </div>
        {showRaw ? (
          <pre className="font-mono text-small text-text-primary whitespace-pre overflow-x-auto bg-surface-sub rounded-lg p-4 border border-border-subtle">
            {json}
          </pre>
        ) : (
          <dl className="grid grid-cols-[160px_1fr] gap-x-5 gap-y-2 text-small font-mono">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="kicker text-right pt-0.5">{k}</dt>
                <dd className="text-text-primary break-words">
                  <NestedValue v={v} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  return <div className="p-5 font-mono text-small">{String(value)}</div>;
}

function NestedValue({ v }: { v: unknown }) {
  // Primitive scalars — render verbatim.
  if (v === null || v === undefined) return <span className="text-text-muted">—</span>;
  if (typeof v !== "object") return <>{String(v)}</>;
  // Array of primitives — comma list.
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-text-muted">[]</span>;
    if (v.every((x) => typeof x !== "object")) {
      return <>{v.map(String).join(", ")}</>;
    }
    // Array of objects — compact line-per-item summary.
    return (
      <ul className="space-y-1">
        {v.map((item, i) => (
          <li key={i} className="text-text-secondary">
            <code className="text-[12px]">{summarizeObject(item)}</code>
          </li>
        ))}
      </ul>
    );
  }
  // Nested object — single-line summary.
  return <code className="text-[12px] text-text-secondary">{summarizeObject(v)}</code>;
}

function summarizeObject(o: unknown): string {
  if (o === null || typeof o !== "object") return String(o);
  const entries = Object.entries(o as Record<string, unknown>);
  // Keep it tight: first 4 keys, values truncated to 20 chars.
  const parts = entries.slice(0, 4).map(([k, v]) => {
    const s =
      v === null || v === undefined
        ? "—"
        : typeof v === "object"
          ? "{…}"
          : String(v);
    return `${k}=${s.length > 20 ? s.slice(0, 17) + "…" : s}`;
  });
  if (entries.length > 4) parts.push(`+${entries.length - 4}`);
  return `{ ${parts.join("  ")} }`;
}

// ── Kube .status — rich SRE-facing render ──────────────────────────────
//
// Detects a shape like:
//   { replicas, readyReplicas, availableReplicas, updatedReplicas,
//     observedGeneration, conditions: [{type, status, reason, message,
//     lastTransitionTime}] }
// and renders it as a healthy/degraded banner + 4 KPI tiles + a list of
// conditions with ✓/✗ glyphs and relative timestamps.

type KubeCondition = {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  lastUpdateTime?: string;
};

function looksLikeKubeStatus(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const conditions = s.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  const looksCondition = conditions.every(
    (c) =>
      c &&
      typeof c === "object" &&
      "type" in (c as object) &&
      "status" in (c as object),
  );
  if (!looksCondition) return false;
  // At least ONE replica-count key, or an observedGeneration, so we don't
  // accidentally catch a generic `conditions: [...]` object.
  return (
    "replicas" in s ||
    "readyReplicas" in s ||
    "availableReplicas" in s ||
    "observedGeneration" in s
  );
}

function KubeStatusView({
  status,
  json,
  showRaw,
  onToggleRaw,
}: {
  status: Record<string, unknown>;
  json: string;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const conditions = (status.conditions ?? []) as KubeCondition[];
  const available = conditions.find((c) => c.type === "Available");
  const progressing = conditions.find((c) => c.type === "Progressing");
  const replicaFailure = conditions.find((c) => c.type === "ReplicaFailure");

  const replicas = num(status.replicas);
  const ready = num(status.readyReplicas);
  const availCount = num(status.availableReplicas);
  const updated = num(status.updatedReplicas);
  const observed = num(status.observedGeneration);

  const healthy =
    available?.status === "True" &&
    !replicaFailure &&
    ready === replicas &&
    (progressing ? progressing.status === "True" : true);

  return (
    <div className="p-5 space-y-5">
      {/* top banner */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full font-semibold text-small",
                healthy
                  ? "bg-ok-soft text-ok"
                  : "bg-danger-soft text-danger",
              )}
            >
              <span aria-hidden>{healthy ? "✓" : "✕"}</span>
              {healthy ? "Healthy" : "Degraded"}
            </span>
            {observed !== null && (
              <span className="text-caption tracking-chip uppercase text-text-muted">
                generation · {observed}
              </span>
            )}
          </div>
          {!healthy && available?.message && (
            <p className="mt-2 text-small text-text-secondary max-w-prose">
              {available.message}
            </p>
          )}
        </div>
        <button
          onClick={onToggleRaw}
          className="kicker text-text-muted hover:text-text-secondary shrink-0"
        >
          {showRaw ? "hide raw" : "view raw"}
        </button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi
          label="Replicas"
          value={replicas === null ? "—" : `${ready ?? 0}/${replicas}`}
          hint="ready / desired"
          tone={ready === replicas ? "ok" : "warn"}
        />
        <Kpi
          label="Available"
          value={availCount ?? "—"}
          tone={availCount === replicas ? "ok" : "warn"}
        />
        <Kpi
          label="Updated"
          value={updated ?? "—"}
          tone={updated === replicas ? "ok" : "warn"}
        />
        <Kpi
          label="Terminating"
          value={num(status.terminatingReplicas) ?? 0}
          tone={(num(status.terminatingReplicas) ?? 0) > 0 ? "warn" : "muted"}
        />
      </div>

      {/* Conditions */}
      <div>
        <div className="kicker mb-2">Conditions</div>
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-sub">
          {conditions.map((c, i) => (
            <li key={i} className="px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <ConditionGlyph status={c.status} />
                <span className="font-semibold text-text-primary text-small">
                  {c.type ?? "—"}
                </span>
                {c.reason && (
                  <span className="text-caption tracking-chip uppercase text-text-muted">
                    {c.reason}
                  </span>
                )}
                <span className="ml-auto text-caption text-text-muted tabular">
                  {c.lastTransitionTime || c.lastUpdateTime
                    ? formatRelativeTime(c.lastTransitionTime || c.lastUpdateTime || "")
                    : "—"}
                </span>
              </div>
              {c.message && (
                <p className="mt-1 text-small text-text-secondary leading-snug">
                  {c.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {showRaw && (
        <pre className="font-mono text-[12px] text-text-secondary whitespace-pre overflow-x-auto bg-canvas rounded-lg p-3 border border-border-subtle">
          {json}
        </pre>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "ok" | "warn" | "muted";
}) {
  const toneCls =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : "text-text-primary";
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sub px-3 py-2.5">
      <div className="kicker text-text-muted">{label}</div>
      <div className={cn("mt-1 font-display text-[22px] font-bold tabular leading-none", toneCls)}>
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-caption text-text-muted">{hint}</div>
      )}
    </div>
  );
}

function ConditionGlyph({ status }: { status?: string }) {
  if (status === "True") {
    return <span aria-hidden className="text-ok">✓</span>;
  }
  if (status === "False") {
    return <span aria-hidden className="text-danger">✕</span>;
  }
  return <span aria-hidden className="text-text-muted">·</span>;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return null;
}

// ── Log ────────────────────────────────────────────────────────────────
function LogView({ text }: { text: string }) {
  // Empty or whitespace-only output is common ("no logs in window",
  // successful writes that emit nothing, etc.) and shouldn't render as
  // a blank grey rectangle — which looks like a UI bug.
  if (!text || !text.trim()) {
    return (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted">
        <Inbox size={22} strokeWidth={1.8} aria-hidden />
        <div className="text-small">No output.</div>
        <div className="text-caption text-text-muted/80">
          Command ran cleanly — but the process didn&apos;t print anything in the window.
        </div>
      </div>
    );
  }
  const lines = text.split("\n");
  return (
    <div className="bg-surface-sub p-4 font-mono text-[12.5px] leading-[1.6] max-h-[28rem] overflow-auto">
      {lines.map((line, i) => (
        <div key={i} className={highlightClass(line)}>{line || <>&nbsp;</>}</div>
      ))}
    </div>
  );
}

function highlightClass(line: string): string {
  if (/\bERROR\b|\bfatal\b/i.test(line)) return "text-danger";
  if (/\bWARN(?:ING)?\b/i.test(line)) return "text-warn";
  return "text-text-primary";
}

export { formatRelativeTime };


// ── Per-step (multi-step write skills) ────────────────────────────────
function PerStepPanel({ steps }: { steps: StepResult[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="border-t border-border-subtle bg-surface-sub">
      <div className="px-4 pt-3 pb-1 kicker text-text-muted">
        steps · {steps.length}
      </div>
      <ol className="px-2 pb-2">
        {steps.map((s, i) => {
          const tone = stepTone(s.state);
          const isOpen = expanded === s.id;
          return (
            <li key={s.id} className="rounded-md hover:bg-elevated transition-colors duration-80">
              <button
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="w-full text-left flex items-center gap-3 px-2 py-1.5"
              >
                <span className={cn("w-5 text-caption tabular text-text-muted")}>{i + 1}.</span>
                <span className={cn("inline-flex items-center gap-1.5 h-5 px-1.5 rounded-full text-caption tracking-chip uppercase", tone)}>
                  {s.state}
                </span>
                <span className="font-mono text-small text-text-primary truncate flex-1">
                  {s.id}
                </span>
                {s.exit_code !== null && (
                  <span className="text-caption tabular text-text-muted">exit {s.exit_code}</span>
                )}
                {s.duration_ms > 0 && (
                  <span className="text-caption tabular text-text-muted">{s.duration_ms}ms</span>
                )}
                <ChevronDown
                  size={13}
                  className={cn("text-text-muted transition-transform duration-160", isOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
              {isOpen && (
                <div className="pl-10 pr-4 pb-3 space-y-1.5">
                  <pre className="font-mono text-[12.5px] text-text-secondary whitespace-pre-wrap break-all bg-canvas border border-border-subtle rounded-md p-2">
                    {s.argv.join(" ")}
                  </pre>
                  {s.started_at && (
                    <div className="text-caption text-text-muted font-mono tabular">
                      {s.started_at} → {s.ended_at}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function stepTone(state: StepResult["state"]): string {
  if (state === "ok") return "bg-ok-soft text-ok";
  if (state === "error" || state === "timeout") return "bg-danger-soft text-danger";
  return "bg-surface border border-border-subtle text-text-muted";
}
