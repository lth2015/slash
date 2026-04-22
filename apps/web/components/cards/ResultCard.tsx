"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronsUpDown, MoreHorizontal, RotateCcw } from "lucide-react";

import { Card, CardMeta } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";

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
  kind?: "table" | "object" | "log" | "chart";
  parse?: "json" | "text" | "lines";
  path?: string;
  columns?: Column[];
  row_actions?: RowAction[];
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

  if (rows.length === 0) {
    return (
      <div className="h-12 flex items-center justify-center text-small text-text-muted">
        — no rows —
      </div>
    );
  }

  const hasActions = !!(rowActions && rowActions.length && onAction);

  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-small">
        <thead>
          <tr className="bg-surface-sub border-b border-border-subtle">
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
          {sorted.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border-subtle last:border-b-0 hover:bg-elevated transition-colors duration-80"
            >
              {columns.map((c) => (
                <td key={c.key} className="h-9 px-4 whitespace-nowrap">
                  <CellRenderer row={row} col={c} />
                </td>
              ))}
              {hasActions && (
                <td className="w-10 px-2 whitespace-nowrap relative">
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
          ))}
        </tbody>
      </table>
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
    return <div className="h-12 flex items-center justify-center text-small text-text-muted">— empty —</div>;
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
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
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

// ── Log ────────────────────────────────────────────────────────────────
function LogView({ text }: { text: string }) {
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
