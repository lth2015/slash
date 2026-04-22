"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronsUpDown, Copy, Download } from "lucide-react";

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

export interface OutputSpec {
  kind?: "table" | "object" | "log" | "chart";
  parse?: "json" | "text" | "lines";
  path?: string;
  columns?: Column[];
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
}

export function ResultCard({ result, attached }: { result: ResultPayload; attached?: boolean }) {
  const spec = result.output_spec ?? {};
  const kind = spec.kind ?? "object";
  return (
    <Card rail={result.state === "ok" ? "ok" : "error"} attached={attached}>
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
          />
        )}
        {kind === "object" && <ObjectView value={result.outputs} />}
        {kind === "log" && <LogView text={String(result.outputs ?? "")} />}
        {kind === "chart" && <ObjectView value={result.outputs} />}

        <footer className="h-6 px-4 flex items-center gap-3 text-caption tracking-kicker uppercase text-text-muted border-t border-border-subtle">
          <Chip kind={result.mode === "write" ? "write" : "read"}>{result.mode}</Chip>
          <span>{result.skill_id}</span>
          {typeof result.duration_ms === "number" && (
            <>
              <span className="text-border">·</span>
              <span className="tabular">{result.duration_ms} ms</span>
            </>
          )}
          <span className="text-border">·</span>
          <span className="tabular">{asArray(result.outputs).length} rows</span>
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

// ── Table variant ──────────────────────────────────────────────────────
function TableView({ rows, columns }: { rows: unknown[]; columns: Column[] }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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
      <div className="h-8 flex items-center justify-center text-small text-text-muted">
        — no rows —
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-mono-body">
        <thead>
          <tr className="bg-elevated border-b border-border-subtle">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "h-7 px-3 text-left text-caption tracking-kicker uppercase text-text-secondary",
                  "font-normal select-none cursor-pointer",
                )}
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
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border-subtle last:border-b-0 hover:bg-elevated transition-colors duration-80 ease-m-instant"
            >
              {columns.map((c) => (
                <td key={c.key} className="h-7 px-3 whitespace-nowrap">
                  <CellRenderer row={row} col={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

// ── Object variant ─────────────────────────────────────────────────────
function ObjectView({ value }: { value: unknown }) {
  const [showRaw, setShowRaw] = useState(false);
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);

  if (value == null) {
    return <div className="h-8 flex items-center justify-center text-small text-text-muted">— empty —</div>;
  }

  // Array → show a row-count + first-N-rows summary
  if (Array.isArray(value)) {
    return (
      <div className="p-4 space-y-2">
        <div className="text-caption tracking-kicker uppercase text-text-muted">{value.length} items</div>
        <pre className="font-mono text-mono-body text-text-primary whitespace-pre overflow-x-auto">{json}</pre>
      </div>
    );
  }

  // Object → key / value grid
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="p-4">
        <div className="flex items-center justify-end mb-1">
          <button
            onClick={() => setShowRaw((s) => !s)}
            className="text-caption tracking-kicker uppercase text-text-muted hover:text-text-secondary"
          >
            {showRaw ? "hide raw" : "view raw"}
          </button>
        </div>
        {showRaw ? (
          <pre className="font-mono text-mono-body text-text-primary whitespace-pre overflow-x-auto">{json}</pre>
        ) : (
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 text-mono-body font-mono">
            {entries.map(([k, v]) => (
              <>
                <dt key={`k-${k}`} className="text-caption tracking-kicker uppercase text-text-muted text-right pt-1">{k}</dt>
                <dd key={`v-${k}`} className="text-text-primary break-words">
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </dd>
              </>
            ))}
          </dl>
        )}
      </div>
    );
  }

  return <div className="p-4 font-mono text-mono-body">{String(value)}</div>;
}

// ── Log variant ────────────────────────────────────────────────────────
function LogView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="bg-canvas p-3 font-mono text-[12px] leading-[1.55] max-h-96 overflow-auto">
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

// helpers re-exported for external use
export { formatRelativeTime };
