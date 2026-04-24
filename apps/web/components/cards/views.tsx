"use client";

// Rich-view renderers dispatched by ResultCard.tsx on `output_spec.kind`.
// Each view expects a specific shape (see per-file comments); when the shape
// doesn't match, render a tight "unrecognized output" fallback rather than
// crashing so the tool is resilient to upstream format drift.

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, Cloud, GitBranch, Inbox, Pin, Server } from "lucide-react";

import { Chip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/components/cards/ResultCard";

// ══════════════════════════════════════════════════════════════════════
// Rollout banner — consumes kubectl rollout status text output
// ══════════════════════════════════════════════════════════════════════

export function RolloutBanner({ text }: { text: string }) {
  const parsed = useMemo(() => parseRolloutText(text), [text]);
  const tone =
    parsed.state === "rolled_out"
      ? "ok"
      : parsed.state === "timeout"
        ? "danger"
        : "warn";
  const label =
    parsed.state === "rolled_out"
      ? "Rolled out"
      : parsed.state === "timeout"
        ? "Timed out"
        : "Rolling…";
  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={cn(
            "inline-flex items-center gap-2 h-10 px-4 rounded-full font-display font-semibold text-[15px]",
            tone === "ok" && "bg-ok-soft text-ok",
            tone === "warn" && "bg-warn-soft text-warn",
            tone === "danger" && "bg-danger-soft text-danger",
          )}
        >
          <span aria-hidden>
            {tone === "ok" ? "✓" : tone === "danger" ? "✕" : "◐"}
          </span>
          {label}
        </div>
        {parsed.deployment && (
          <div className="flex flex-col">
            <div className="kicker text-text-muted">deployment</div>
            <div className="font-mono text-small text-text-primary">
              {parsed.deployment}
            </div>
          </div>
        )}
        {parsed.progress && (
          <div className="flex flex-col">
            <div className="kicker text-text-muted">progress</div>
            <div className="font-mono text-small text-text-primary tabular">
              {parsed.progress.ready} / {parsed.progress.total} replicas ready
            </div>
          </div>
        )}
      </div>
      <pre className="font-mono text-[12.5px] leading-[1.6] text-text-secondary whitespace-pre-wrap bg-surface-sub rounded-lg p-4 border border-border-subtle max-h-60 overflow-auto">
        {text.trim() || "(empty)"}
      </pre>
    </div>
  );
}

function parseRolloutText(raw: string): {
  state: "rolled_out" | "rolling" | "timeout";
  deployment: string | null;
  progress: { ready: number; total: number } | null;
} {
  const lower = raw.toLowerCase();
  const state: "rolled_out" | "rolling" | "timeout" =
    lower.includes("successfully rolled out") || /rollout (complete|succeeded)/i.test(raw)
      ? "rolled_out"
      : /timeout|timed out/i.test(raw)
        ? "timeout"
        : "rolling";

  const deployMatch = raw.match(/deployment(?:\.apps)?[ /"]+([^"\s]+)/i);
  const progressMatch = raw.match(/(\d+)\s+of\s+(\d+)\s+updated/i);
  return {
    state,
    deployment: deployMatch ? deployMatch[1] : null,
    progress: progressMatch
      ? { ready: Number(progressMatch[1]), total: Number(progressMatch[2]) }
      : null,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Event timeline — pod events / cluster events
// ══════════════════════════════════════════════════════════════════════

interface K8sEvent {
  lastTimestamp?: string;
  firstTimestamp?: string;
  eventTime?: string;
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  involvedObject?: { kind?: string; name?: string; namespace?: string };
  metadata?: { namespace?: string };
}

export function EventTimeline({
  rows,
  onAction,
  rowActions,
}: {
  rows: unknown[];
  onAction?: (cmd: string) => void;
  rowActions?: { label: string; command: string }[];
}) {
  const events = useMemo(() => (rows as K8sEvent[]).filter(Boolean), [rows]);
  const summary = useMemo(() => buildEventSummary(events), [events]);

  if (events.length === 0) {
    return (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted">
        <Inbox size={22} strokeWidth={1.8} aria-hidden />
        <div className="text-small">No events.</div>
        <div className="text-caption text-text-muted/80">
          Clean — nothing interesting happened in the selected window.
        </div>
      </div>
    );
  }

  return (
    <div>
      {summary && <EventSummaryStrip {...summary} total={events.length} />}
      <ol className="p-5 space-y-0">
        {events.map((ev, i) => (
          <EventRow
            key={i}
            event={ev}
            last={i === events.length - 1}
            onAction={onAction}
            rowActions={rowActions}
          />
        ))}
      </ol>
    </div>
  );
}

function EventRow({
  event,
  last,
  onAction,
  rowActions,
}: {
  event: K8sEvent;
  last: boolean;
  onAction?: (cmd: string) => void;
  rowActions?: { label: string; command: string }[];
}) {
  const warning = event.type === "Warning";
  const ts = event.lastTimestamp || event.eventTime || event.firstTimestamp || "";
  const objKind = event.involvedObject?.kind ?? "";
  const objName = event.involvedObject?.name ?? "";
  const count = event.count && event.count > 1 ? event.count : null;
  // Pod-specific row_actions are nonsensical for Node / Service / etc. events
  // — skip them there. Also hide actions on benign Normal events to cut
  // visual noise; the user wants to act on what looks broken. Hovering /
  // focusing the row reveals them either way (see `group` classes below).
  const podScoped = objKind === "Pod" || objKind === "";
  const hasActions =
    !!(rowActions && rowActions.length && onAction) && podScoped;

  return (
    <li className="group relative pl-7">
      {/* dot + line */}
      <span
        aria-hidden
        className={cn(
          "absolute left-[7px] top-2 w-2.5 h-2.5 rounded-full border-2",
          warning ? "bg-danger border-danger" : "bg-surface border-ok",
        )}
      />
      {!last && (
        <span
          aria-hidden
          className="absolute left-[12px] top-5 bottom-0 w-px bg-border-subtle"
        />
      )}
      <div className="pb-4">
        <div className="flex items-center gap-2 flex-wrap text-caption tracking-chip uppercase">
          <span className={cn("font-semibold", warning ? "text-danger" : "text-ok")}>
            {event.reason ?? "event"}
          </span>
          {(objKind || objName) && (
            <span className="font-mono normal-case tracking-normal text-text-secondary">
              {objKind}/{objName}
            </span>
          )}
          {count && (
            <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-warn-soft text-warn font-semibold tabular">
              ×{count}
            </span>
          )}
          <span className="ml-auto text-text-muted tabular normal-case tracking-normal">
            {ts ? formatRelativeTime(ts) : "—"}
          </span>
        </div>
        {event.message && (
          <p className="mt-1 text-small text-text-primary leading-snug">
            {event.message}
          </p>
        )}
        {hasActions && (
          // Reveal-on-hover: 63-event timelines get unbearable when every
          // row carries three always-on chips. Keep the chip row hidden by
          // default and fade it in only when the user shows intent (mouse
          // hover or keyboard focus). On touch devices without :hover we
          // fall back to always-visible via a media query override below.
          <div
            className={cn(
              "mt-1.5 flex flex-wrap gap-1.5",
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              "transition-opacity duration-160",
              // always visible on coarse pointers (touch) where hover doesn't apply
              "[@media(hover:none)]:opacity-100",
            )}
          >
            {rowActions!.map((a, idx) => {
              const resolved = interpolate(a.command, event);
              const broken = resolved.includes("${");
              if (broken) return null;
              return (
                <button
                  key={idx}
                  onClick={() => onAction!(resolved)}
                  className={cn(
                    "inline-flex items-center h-6 px-2.5 rounded-full text-caption tracking-chip",
                    "border bg-surface-sub transition-colors duration-80",
                    "border-border text-text-secondary",
                    "hover:bg-brand-tint hover:border-brand hover:text-brand",
                  )}
                  title={resolved}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
}

function buildEventSummary(events: K8sEvent[]): {
  warnings: number;
  byReason: { reason: string; count: number }[];
  windowLabel: string | null;
} | null {
  if (events.length < 2) return null;
  const warnings = events.filter((e) => e.type === "Warning").length;
  const byReason = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "Warning") continue;
    const key = e.reason || "unknown";
    byReason.set(key, (byReason.get(key) ?? 0) + (e.count ?? 1));
  }
  // Window: how recent is the freshest warning?
  const tops = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));
  if (warnings === 0 && tops.length === 0) return null;

  const mostRecent = events
    .map((e) => e.lastTimestamp || e.eventTime || e.firstTimestamp)
    .filter(Boolean)
    .map((t) => new Date(t as string).getTime())
    .sort((a, b) => b - a)[0];
  const windowLabel =
    Number.isFinite(mostRecent) && mostRecent
      ? `fresh ${formatRelativeTime(new Date(mostRecent))}`
      : null;

  return { warnings, byReason: tops, windowLabel };
}

function EventSummaryStrip({
  total,
  warnings,
  byReason,
  windowLabel,
}: {
  total: number;
  warnings: number;
  byReason: { reason: string; count: number }[];
  windowLabel: string | null;
}) {
  const tone: "ok" | "danger" | "warn" =
    warnings === 0 ? "ok" : warnings >= 3 ? "danger" : "warn";
  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-border-subtle",
        tone === "ok" && "bg-ok-soft/30",
        tone === "warn" && "bg-warn-soft/50",
        tone === "danger" && "bg-danger-soft/40",
      )}
    >
      {warnings > 0 && (
        <AlertTriangle
          size={14}
          className={tone === "danger" ? "text-danger" : "text-warn"}
        />
      )}
      <span className="text-caption tracking-chip uppercase font-semibold text-text-secondary">
        {total} events{warnings > 0 ? ` · ${warnings} warning` : ""}
        {warnings > 1 ? "s" : ""}
      </span>
      {byReason.length > 0 && <span className="text-border">·</span>}
      <div className="flex items-center gap-1.5 flex-wrap">
        {byReason.map((r) => (
          <span
            key={r.reason}
            className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-caption tracking-chip uppercase font-semibold border bg-surface text-danger border-danger/40"
            title={`${r.count} × ${r.reason}`}
          >
            <span className="tabular font-mono">{r.count}</span>
            <span className="font-mono normal-case">{r.reason}</span>
          </span>
        ))}
      </div>
      {windowLabel && (
        <span className="ml-auto text-caption text-text-muted tabular">
          {windowLabel}
        </span>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Metrics sparkline — CloudWatch get-metric-statistics
// ══════════════════════════════════════════════════════════════════════

interface CloudWatchPayload {
  Label?: string;
  Datapoints?: CWDatapoint[];
}
interface CWDatapoint {
  Timestamp: string;
  Average?: number;
  Maximum?: number;
  Minimum?: number;
  Unit?: string;
}

export function MetricsSparkline({ value }: { value: unknown }) {
  const payload = (value ?? {}) as CloudWatchPayload;
  const label = payload.Label ?? "metric";
  const unit = payload.Datapoints?.[0]?.Unit ?? "";
  const sorted = useMemo(
    () =>
      [...(payload.Datapoints ?? [])].sort(
        (a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime(),
      ),
    [payload.Datapoints],
  );

  if (sorted.length === 0) {
    return (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted">
        <Inbox size={22} strokeWidth={1.8} aria-hidden />
        <div className="text-small">No datapoints in window.</div>
      </div>
    );
  }

  const averages = sorted.map((d) => d.Average ?? 0);
  const maxes = sorted.map((d) => d.Maximum ?? d.Average ?? 0);
  const peak = Math.max(...maxes);
  const avg = averages.reduce((a, b) => a + b, 0) / averages.length;
  const latest = sorted[sorted.length - 1];
  const firstTs = sorted[0].Timestamp;
  const lastTs = latest.Timestamp;

  const unitSuffix = unit === "Percent" ? "%" : unit === "Bytes" ? " B" : ` ${unit}`.trimEnd();

  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <div className="kicker text-text-muted">{label}</div>
          <div className="font-display text-[28px] font-bold tabular leading-none text-text-primary">
            {fmt(averages[averages.length - 1])}
            <span className="text-[15px] font-normal text-text-muted ml-1">
              {unitSuffix}
            </span>
          </div>
          <div className="mt-1 text-caption text-text-muted">latest value</div>
        </div>
        <Kpi label="Peak" value={`${fmt(peak)}${unitSuffix}`} tone="warn" />
        <Kpi label="Average" value={`${fmt(avg)}${unitSuffix}`} />
        <Kpi label="Datapoints" value={String(sorted.length)} />
      </div>
      <Sparkline averages={averages} maxes={maxes} />
      <div className="flex justify-between text-caption text-text-muted tabular">
        <span>{formatRelativeTime(firstTs)}</span>
        <span>{formatRelativeTime(lastTs)}</span>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  const toneCls =
    tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-text-primary";
  return (
    <div>
      <div className="kicker text-text-muted">{label}</div>
      <div className={cn("font-display text-[20px] font-semibold tabular leading-none", toneCls)}>
        {value}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "G";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  if (n >= 10) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

function Sparkline({
  averages,
  maxes,
}: {
  averages: number[];
  maxes: number[];
}) {
  // SVG sparkline: filled area = avg; spike markers = max where max significantly exceeds avg.
  const w = 640;
  const h = 80;
  const pad = 4;
  const min = 0;
  const max = Math.max(...maxes, 1);
  const xStep = (w - pad * 2) / Math.max(averages.length - 1, 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const pts = averages.map((v, i) => [pad + i * xStep, y(v)] as const);
  const areaPath =
    `M ${pts[0][0]},${h - pad} ` +
    pts.map(([x, yy]) => `L ${x},${yy}`).join(" ") +
    ` L ${pts[pts.length - 1][0]},${h - pad} Z`;
  const linePath = pts.map(([x, yy], i) => (i === 0 ? `M ${x},${yy}` : `L ${x},${yy}`)).join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-20 overflow-visible"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand, #ff7a33)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--brand, #ff7a33)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--brand, #ff7a33)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Peak marker — highlight the single highest datapoint. */}
      {(() => {
        const peakIdx = maxes.reduce(
          (best, v, i) => (v > maxes[best] ? i : best),
          0,
        );
        const [px, py] = [pad + peakIdx * xStep, y(maxes[peakIdx])];
        return (
          <g>
            <circle cx={px} cy={py} r="3.5" fill="var(--warn, #e8a12a)" />
            <circle cx={px} cy={py} r="6" fill="var(--warn, #e8a12a)" opacity="0.25" />
          </g>
        );
      })()}
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Multi-metric chart — CloudWatch get-metric-data (multi-series, 24h)
// ══════════════════════════════════════════════════════════════════════

interface CWMulti {
  MetricDataResults?: CWSeries[];
}
interface CWSeries {
  Id?: string;
  Label?: string;
  StatusCode?: string;
  Timestamps?: string[];
  Values?: number[];
}

export function MultiMetricChart({ value }: { value: unknown }) {
  const series = useMemo(
    () => normalizeSeries((value ?? {}) as CWMulti),
    [value],
  );
  if (series.length === 0) {
    return (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted">
        <Inbox size={22} strokeWidth={1.8} aria-hidden />
        <div className="text-small">No datapoints in window.</div>
        <div className="text-caption text-text-muted/80">
          Either the instance hasn&apos;t been running, or the metric isn&apos;t published.
        </div>
      </div>
    );
  }

  const span = seriesTimeSpan(series);

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-baseline gap-6 flex-wrap">
        {series.map((s) => {
          const peak = Math.max(...s.values, 0);
          const avg = s.values.length
            ? s.values.reduce((a, b) => a + b, 0) / s.values.length
            : 0;
          return (
            <div key={s.id} className="flex items-center gap-3">
              <span
                aria-hidden
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ background: s.color }}
              />
              <div>
                <div className="kicker text-text-muted">{s.label}</div>
                <div className="font-display text-[18px] font-bold tabular leading-tight text-text-primary">
                  {formatValue(peak, s.unit)}
                  <span className="text-caption text-text-muted font-normal font-mono ml-1.5">
                    peak
                  </span>
                </div>
                <div className="text-caption text-text-muted font-mono tabular">
                  avg {formatValue(avg, s.unit)} · {s.values.length} pts
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="space-y-2.5">
        {series.map((s) => (
          <SeriesPanel key={s.id} series={s} />
        ))}
      </div>
      {span && (
        <div className="flex justify-between text-caption text-text-muted tabular font-mono">
          <span>{span.start}</span>
          <span className="text-text-secondary font-semibold">{span.label}</span>
          <span>{span.end}</span>
        </div>
      )}
    </div>
  );
}

interface NormSeries {
  id: string;
  label: string;
  unit: "percent" | "bytes" | "count";
  color: string;
  timestamps: number[]; // ms since epoch
  values: number[];
}

function normalizeSeries(payload: CWMulti): NormSeries[] {
  const raw = payload.MetricDataResults ?? [];
  // Palette: brand orange, cool blue, teal — distinct hues, readable on dark+light.
  const palette = ["var(--brand, #ff7a33)", "#3b82f6", "#14b8a6", "#8b5cf6"];
  const out: NormSeries[] = [];
  raw.forEach((s, idx) => {
    const timestamps = (s.Timestamps ?? []).map((t) => new Date(t).getTime());
    const values = s.Values ?? [];
    if (timestamps.length === 0 || values.length === 0) return;
    // CloudWatch returns arrays newest-first. Reverse so left→right is time-forward.
    const pairs = timestamps
      .map((t, i) => [t, values[i] ?? 0] as const)
      .sort((a, b) => a[0] - b[0]);
    out.push({
      id: s.Id ?? `m${idx}`,
      label: s.Label ?? s.Id ?? `series ${idx}`,
      unit: inferUnit(s.Label ?? s.Id ?? ""),
      color: palette[idx % palette.length],
      timestamps: pairs.map((p) => p[0]),
      values: pairs.map((p) => p[1]),
    });
  });
  return out;
}

function inferUnit(label: string): "percent" | "bytes" | "count" {
  const l = label.toLowerCase();
  if (l.includes("%") || l.includes("util") || l.includes("percent")) return "percent";
  if (l.includes("byte") || l.includes("b/s") || l.includes("netin") || l.includes("netout") || l.includes("disk")) return "bytes";
  return "count";
}

function formatValue(v: number, unit: "percent" | "bytes" | "count"): string {
  if (!Number.isFinite(v)) return "—";
  if (unit === "percent") return `${v.toFixed(1)}%`;
  if (unit === "bytes") {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB/s`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MB/s`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB/s`;
    return `${v.toFixed(0)} B/s`;
  }
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(v >= 10 ? 0 : 1);
}

function SeriesPanel({ series }: { series: NormSeries }) {
  const { values, color, label, unit } = series;
  if (values.length === 0) return null;
  const w = 720;
  const h = 70;
  const pad = 6;
  const min = Math.min(0, Math.min(...values));
  const max = Math.max(...values, min + 1);
  const xStep = (w - pad * 2) / Math.max(values.length - 1, 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const pts = values.map((v, i) => [pad + i * xStep, y(v)] as const);
  const areaPath =
    `M ${pts[0][0]},${h - pad} ` +
    pts.map(([x, yy]) => `L ${x},${yy}`).join(" ") +
    ` L ${pts[pts.length - 1][0]},${h - pad} Z`;
  const linePath = pts
    .map(([x, yy], i) => (i === 0 ? `M ${x},${yy}` : `L ${x},${yy}`))
    .join(" ");
  const peakIdx = values.reduce(
    (best, v, i) => (v > values[best] ? i : best),
    0,
  );
  const [px, py] = [pad + peakIdx * xStep, y(values[peakIdx])];
  const gradId = `grad-${series.id}`;

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0">
        <div className="kicker text-text-muted truncate">{label}</div>
        <div className="font-mono text-caption tabular text-text-secondary">
          max {formatValue(max, unit)}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="flex-1 h-16 overflow-visible"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={px} cy={py} r="3" fill={color} />
        <circle cx={px} cy={py} r="6" fill={color} opacity="0.20" />
      </svg>
    </div>
  );
}

function seriesTimeSpan(series: NormSeries[]): { start: string; end: string; label: string } | null {
  const all = series.flatMap((s) => s.timestamps);
  if (all.length === 0) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const hours = Math.round((max - min) / (3600 * 1000));
  return {
    start: new Date(min).toLocaleString([], { month: "short", day: "numeric", hour: "numeric" }),
    end: new Date(max).toLocaleString([], { month: "short", day: "numeric", hour: "numeric" }),
    label: `${hours}h window`,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Security group rules
// ══════════════════════════════════════════════════════════════════════

interface SgGroup {
  GroupId?: string;
  GroupName?: string;
  VpcId?: string;
  Description?: string;
  IpPermissions?: SgRule[];
  IpPermissionsEgress?: SgRule[];
}

interface SgRule {
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: { CidrIp?: string; Description?: string }[];
  Ipv6Ranges?: { CidrIpv6?: string; Description?: string }[];
  UserIdGroupPairs?: { GroupId?: string; Description?: string }[];
  PrefixListIds?: { PrefixListId?: string; Description?: string }[];
}

export function SecurityGroupRules({ rows }: { rows: unknown[] }) {
  const groups = (rows as SgGroup[]).filter(Boolean);

  if (groups.length === 0) {
    return (
      <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-text-muted">
        <Inbox size={22} strokeWidth={1.8} aria-hidden />
        <div className="text-small">No security group found.</div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      {groups.map((g, i) => (
        <SgGroupCard key={i} group={g} />
      ))}
    </div>
  );
}

function SgGroupCard({ group }: { group: SgGroup }) {
  const ingress = flattenRules(group.IpPermissions ?? []);
  const egress = flattenRules(group.IpPermissionsEgress ?? []);
  const worldOpen = ingress.filter((r) => r.source === "0.0.0.0/0").length;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-4 flex-wrap">
        <div>
          <div className="font-mono text-small font-semibold text-text-primary">
            {group.GroupId ?? "—"}
          </div>
          <div className="text-caption text-text-muted">
            {group.GroupName ?? ""} · {group.VpcId ?? "—"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="kicker text-text-muted">{ingress.length} in</span>
          <span className="text-border">·</span>
          <span className="kicker text-text-muted">{egress.length} out</span>
          {worldOpen > 0 && (
            <>
              <span className="text-border">·</span>
              <Chip kind="fail">{worldOpen} world-open</Chip>
            </>
          )}
        </div>
      </div>
      {group.Description && (
        <p className="text-small text-text-secondary">{group.Description}</p>
      )}

      <SgRuleSection title="Ingress" rules={ingress} />
      <SgRuleSection title="Egress" rules={egress} />
    </div>
  );
}

interface FlatRule {
  protocol: string;
  portLabel: string;
  source: string;
  sourceKind: "cidr" | "cidr6" | "sg" | "prefix" | "any";
  description: string;
}

function flattenRules(rules: SgRule[]): FlatRule[] {
  const out: FlatRule[] = [];
  for (const r of rules) {
    const protocol = normalizeProtocol(r.IpProtocol);
    const portLabel = portRange(r.FromPort, r.ToPort, r.IpProtocol);
    for (const range of r.IpRanges ?? []) {
      out.push({
        protocol,
        portLabel,
        source: range.CidrIp ?? "—",
        sourceKind: "cidr",
        description: range.Description ?? "",
      });
    }
    for (const range of r.Ipv6Ranges ?? []) {
      out.push({
        protocol,
        portLabel,
        source: range.CidrIpv6 ?? "—",
        sourceKind: "cidr6",
        description: range.Description ?? "",
      });
    }
    for (const pair of r.UserIdGroupPairs ?? []) {
      out.push({
        protocol,
        portLabel,
        source: pair.GroupId ?? "—",
        sourceKind: "sg",
        description: pair.Description ?? "",
      });
    }
    for (const pl of r.PrefixListIds ?? []) {
      out.push({
        protocol,
        portLabel,
        source: pl.PrefixListId ?? "—",
        sourceKind: "prefix",
        description: pl.Description ?? "",
      });
    }
    if (
      (r.IpRanges?.length ?? 0) +
        (r.Ipv6Ranges?.length ?? 0) +
        (r.UserIdGroupPairs?.length ?? 0) +
        (r.PrefixListIds?.length ?? 0) ===
      0
    ) {
      out.push({
        protocol,
        portLabel,
        source: "—",
        sourceKind: "any",
        description: "",
      });
    }
  }
  return out;
}

function normalizeProtocol(p?: string): string {
  if (!p || p === "-1") return "ALL";
  return p.toUpperCase();
}

function portRange(from?: number, to?: number, proto?: string): string {
  if (proto === "-1") return "all";
  if (from == null) return "all";
  if (to == null || to === from) return String(from);
  if (from === 0 && to === 65535) return "all";
  return `${from}-${to}`;
}

function SgRuleSection({ title, rules }: { title: string; rules: FlatRule[] }) {
  if (rules.length === 0) return null;
  return (
    <div>
      <div className="kicker text-text-muted mb-1.5">
        {title} · {rules.length}
      </div>
      <div className="rounded-lg border border-border-subtle overflow-hidden bg-surface-sub">
        <table className="w-full font-mono text-small">
          <thead>
            <tr className="border-b border-border-subtle bg-canvas">
              <th className="h-8 px-3 text-left kicker font-normal w-20">Proto</th>
              <th className="h-8 px-3 text-left kicker font-normal w-28">Port</th>
              <th className="h-8 px-3 text-left kicker font-normal">Source</th>
              <th className="h-8 px-3 text-left kicker font-normal">Note</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const worldOpen = r.source === "0.0.0.0/0" || r.source === "::/0";
              return (
                <Fragment key={i}>
                  <tr className="border-b border-border-subtle last:border-b-0">
                    <td className="h-9 px-3 text-text-secondary">{r.protocol}</td>
                    <td className="h-9 px-3 tabular text-text-primary">{r.portLabel}</td>
                    <td className="h-9 px-3">
                      <span
                        className={cn(
                          "inline-flex items-center h-5 px-2 rounded-full text-caption tracking-chip font-semibold",
                          worldOpen
                            ? "bg-danger-soft text-danger"
                            : r.sourceKind === "sg"
                              ? "bg-brand-tint text-brand"
                              : "bg-surface border border-border-subtle text-text-secondary",
                        )}
                      >
                        {r.source}
                      </span>
                    </td>
                    <td className="h-9 px-3 text-text-muted truncate max-w-[280px]">
                      {r.description || "—"}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Context inventory — /ctx list output
// ══════════════════════════════════════════════════════════════════════
//
// Expected shape (see runtime/builtins._ctx_list):
//   {
//     k8s_contexts: string[],
//     aws_profiles: string[],
//     gcp_configurations: string[],
//     gitlab_profiles: string[],
//     errors: string[],
//     current: { k8s?: {name, tier}, aws?: {...}, gcp?: {...}, gitlab?: {...} }
//   }
// A long EKS cluster ARN is opaque at a glance, so we render the final
// path segment as the primary label with the full ARN on hover/below.

interface CtxInventoryPayload {
  k8s_contexts?: string[];
  aws_profiles?: string[];
  gcp_configurations?: string[];
  gitlab_profiles?: string[];
  errors?: string[];
  current?: CtxCurrent;
}
interface CtxCurrent {
  k8s?: { name?: string; tier?: string | null } | null;
  aws?: { name?: string; tier?: string | null } | null;
  gcp?: { name?: string; tier?: string | null } | null;
  gitlab?: { name?: string; tier?: string | null } | null;
}

export function CtxInventory({
  value,
  onAction,
}: {
  value: unknown;
  onAction?: (cmd: string) => void;
}) {
  const payload = (value ?? {}) as CtxInventoryPayload;
  const sections: Array<{
    kind: "k8s" | "aws" | "gcp" | "gitlab";
    title: string;
    icon: typeof Cloud;
    items: string[];
    current: string | null;
    currentTier: string | null;
  }> = [
    {
      kind: "k8s",
      title: "Kubernetes",
      icon: Server,
      items: payload.k8s_contexts ?? [],
      current: payload.current?.k8s?.name ?? null,
      currentTier: payload.current?.k8s?.tier ?? null,
    },
    {
      kind: "aws",
      title: "AWS",
      icon: Cloud,
      items: payload.aws_profiles ?? [],
      current: payload.current?.aws?.name ?? null,
      currentTier: payload.current?.aws?.tier ?? null,
    },
    {
      kind: "gcp",
      title: "GCP",
      icon: Cloud,
      items: payload.gcp_configurations ?? [],
      current: payload.current?.gcp?.name ?? null,
      currentTier: payload.current?.gcp?.tier ?? null,
    },
    {
      kind: "gitlab",
      title: "GitLab",
      icon: GitBranch,
      items: payload.gitlab_profiles ?? [],
      current: payload.current?.gitlab?.name ?? null,
      currentTier: payload.current?.gitlab?.tier ?? null,
    },
  ];

  const anyPin = sections.some((s) => s.current);

  return (
    <div className="p-5 space-y-5">
      {anyPin ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="kicker text-text-muted">currently pinned</span>
          {sections
            .filter((s) => s.current)
            .map((s) => (
              <span
                key={s.kind}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-brand-soft border-2 border-brand/40 text-brand font-semibold text-small shadow-sm"
              >
                <Pin size={11} aria-hidden />
                <span className="font-mono normal-case tracking-normal">
                  {s.kind} · {trimCtxName(s.current!)}
                </span>
                {s.currentTier && (
                  <span className="kicker text-brand/80">· {s.currentTier}</span>
                )}
              </span>
            ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-warn-soft/70 border border-warn/30">
          <Pin size={15} className="text-warn shrink-0" aria-hidden />
          <div className="flex-1">
            <div className="font-display font-semibold text-text-primary">
              Nothing pinned yet
            </div>
            <div className="text-caption text-text-muted">
              Most skills need at least one pin — pick a row below to stage a{" "}
              <code className="font-mono">/ctx pin</code>.
            </div>
          </div>
        </div>
      )}

      {sections.map((s) => (
        <CtxSection
          key={s.kind}
          section={s}
          onAction={onAction}
        />
      ))}

      {(payload.errors ?? []).length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn-soft/30 p-3">
          <div className="kicker text-warn mb-1">discovery warnings</div>
          <ul className="text-caption text-text-secondary space-y-1 font-mono">
            {(payload.errors ?? []).map((e, i) => (
              <li key={i}>· {e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CtxSection({
  section,
  onAction,
}: {
  section: {
    kind: "k8s" | "aws" | "gcp" | "gitlab";
    title: string;
    icon: typeof Cloud;
    items: string[];
    current: string | null;
  };
  onAction?: (cmd: string) => void;
}) {
  const [query, setQuery] = useState("");
  const Icon = section.icon;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return section.items;
    return section.items.filter((x) => x.toLowerCase().includes(q));
  }, [section.items, query]);

  if (section.items.length === 0) {
    return (
      <div>
        <SectionHeader icon={Icon} title={section.title} count={0} />
        <div className="text-small text-text-muted pl-7 py-2">
          none detected
        </div>
      </div>
    );
  }

  const showSearch = section.items.length >= 8;

  return (
    <div>
      <SectionHeader
        icon={Icon}
        title={section.title}
        count={section.items.length}
      />
      {showSearch && (
        <div className="pl-7 mb-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter…"
            className="h-7 w-64 max-w-full bg-surface-sub rounded-md px-2.5 text-caption font-mono outline-none focus:ring-2 focus:ring-brand/30 placeholder:text-text-muted/60"
          />
          {query && (
            <span className="ml-2 text-caption text-text-muted tabular">
              {filtered.length} / {section.items.length}
            </span>
          )}
        </div>
      )}
      <div className="pl-7 flex flex-wrap gap-1.5">
        {filtered.map((name) => {
          const pinned = name === section.current;
          return (
            <button
              key={name}
              onClick={() =>
                onAction?.(`/ctx pin ${section.kind} ${name} --tier safe`)
              }
              title={name}
              className={cn(
                "inline-flex items-center h-7 px-2.5 rounded-full text-caption tracking-chip",
                "font-mono max-w-full transition-colors duration-80 border",
                pinned
                  ? "bg-brand text-white border-brand shadow-sm cursor-default"
                  : "bg-surface-sub border-border-subtle text-text-secondary hover:bg-brand-tint hover:border-brand hover:text-brand",
              )}
              disabled={pinned}
            >
              {pinned && <Pin size={10} className="mr-1" aria-hidden />}
              <span className="truncate">{trimCtxName(name)}</span>
              {isLongArn(name) && (
                <span className="ml-1.5 text-text-muted/70 kicker">
                  {ctxProvider(name)}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <span className="text-caption text-text-muted">no match</span>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Cloud;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-2">
      <Icon size={15} className="text-brand" aria-hidden />
      <span className="font-display font-semibold text-text-primary text-[15px]">
        {title}
      </span>
      <span className="kicker text-text-muted">· {count}</span>
      <span className="flex-1 h-px bg-border-subtle ml-2" aria-hidden />
    </div>
  );
}

function trimCtxName(name: string): string {
  // EKS ARN → cluster name: arn:aws:eks:region:acct:cluster/my-cluster → my-cluster
  if (name.startsWith("arn:")) {
    const slash = name.lastIndexOf("/");
    if (slash >= 0) return name.slice(slash + 1);
  }
  // GKE connection key: gke_project_region_cluster → cluster
  if (name.startsWith("gke_")) {
    const parts = name.split("_");
    if (parts.length >= 4) return parts[parts.length - 1];
  }
  return name;
}

function isLongArn(name: string): boolean {
  return name.startsWith("arn:") || name.startsWith("gke_");
}

function ctxProvider(name: string): string {
  if (name.startsWith("arn:aws:eks")) return "EKS";
  if (name.startsWith("gke_")) return "GKE";
  if (name.startsWith("arn:aws")) return "AWS";
  return "";
}

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

function interpolate(template: string, row: unknown): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path: string) => {
    let cur: unknown = row;
    for (const seg of path.split(".")) {
      if (cur == null || typeof cur !== "object") return match;
      cur = (cur as Record<string, unknown>)[seg];
    }
    if (cur === undefined || cur === null || cur === "") return match;
    return String(cur);
  });
}
