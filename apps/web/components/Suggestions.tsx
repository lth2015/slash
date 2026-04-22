"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";

export interface SkillArg {
  name: string;
  flag: string | null;
  type: string;
  required: boolean;
  default: unknown;
  positional: boolean;
  repeatable: boolean;
  enum: string[] | null;
}

export interface Skill {
  id: string;
  name?: string;
  description?: string;
  namespace: string;
  target: string | null;        // for /infra: aws|gcp; for /cluster: _any
  noun: string[];
  verb: string;
  mode: "read" | "write";
  danger: boolean;
  args: SkillArg[];
}

export interface Suggestion {
  skill: Skill;
  /** canonical form for display: /infra aws vm list --region <r> */
  template: string;
  /** insertion form with <placeholders> */
  insert: string;
  /** index of first placeholder in `insert`, -1 if none */
  caretAt: number;
  /** "/ops · audit logs"-ish secondary label */
  sub: string;
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/skills")
      .then((r) => r.json())
      .then((body) => { if (alive) setSkills(body.items ?? []); })
      .catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, []);
  return skills;
}

/** Build the command template + insertion form for a skill.
 *
 * /cluster commands no longer carry a positional ctx — strict mode resolves
 * it from the session pin or a --ctx override at execute time. Templates
 * omit <ctx> so the palette inserts a clean, shorter command form. */
export function renderSkill(skill: Skill): { template: string; insert: string; caretAt: number } {
  const parts: string[] = ["/", skill.namespace];
  if (skill.target === "aws" || skill.target === "gcp") {
    parts.push(" ", skill.target);
  }
  for (const n of skill.noun) parts.push(" ", n);
  parts.push(" ", skill.verb);

  for (const a of skill.args.filter((x) => x.positional)) {
    parts.push(" ", `<${a.name}>`);
  }
  for (const a of skill.args) {
    if (a.positional || !a.flag) continue;
    if (!a.required && a.default == null) continue;
    const hint = hintForArg(a);
    parts.push(" ", `${a.flag}`, " ", hint);
  }
  const insert = parts.join("");
  const first = insert.indexOf("<");
  return { template: insert, insert, caretAt: first };
}

/** Find the next `<...>` placeholder at or after `from`. Returns the
 *  full range including the angle brackets so a selection replace wipes
 *  them cleanly. */
export function findNextPlaceholder(
  text: string,
  from: number,
): { from: number; to: number } | null {
  const open = text.indexOf("<", from);
  if (open === -1) return null;
  const close = text.indexOf(">", open);
  if (close === -1) return null;
  return { from: open, to: close + 1 };
}

/** Find the previous `<...>` placeholder ending before `before`. */
export function findPrevPlaceholder(
  text: string,
  before: number,
): { from: number; to: number } | null {
  const close = text.lastIndexOf(">", Math.max(0, before - 1));
  if (close === -1) return null;
  const open = text.lastIndexOf("<", Math.max(0, close - 1));
  if (open === -1) return null;
  return { from: open, to: close + 1 };
}

function hintForArg(a: SkillArg): string {
  if (a.enum && a.enum.length) return `<${a.enum.join("|")}>`;
  if (a.type === "int") return `<n>`;
  if (a.type === "duration") return `<1h>`;
  if (a.type === "bool") return `<true|false>`;
  if (a.type.startsWith("map<")) return `<k=v>`;
  if (a.name === "reason") return `"<text>"`;
  return `<${a.name}>`;
}

export function filterSkills(skills: Skill[], query: string): Suggestion[] {
  const q = query.trimStart();
  const rendered = skills.map((s) => {
    const r = renderSkill(s);
    return {
      skill: s,
      template: r.template,
      insert: r.insert,
      caretAt: r.caretAt,
      stem: stemOf(s),
      sub: subLabel(s),
    };
  });

  if (!q || q === "/") {
    const ordered = [...rendered].sort((a, b) => {
      if (a.skill.mode !== b.skill.mode) return a.skill.mode === "read" ? -1 : 1;
      return a.stem.localeCompare(b.stem);
    });
    return ordered.map(({ stem: _stem, ...rest }) => rest);
  }

  const ql = q.toLowerCase();
  const scored = rendered
    .map((r) => ({ r, score: scoreMatch(ql, r.stem, r.template, r.skill.id) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score);

  return scored.map(({ r }) => {
    const { stem: _stem, ...rest } = r;
    return rest;
  });
}

function stemOf(s: Skill): string {
  const parts: string[] = ["/", s.namespace];
  if (s.target === "aws" || s.target === "gcp") parts.push(" ", s.target);
  for (const n of s.noun) parts.push(" ", n);
  parts.push(" ", s.verb);
  return parts.join("");
}

function subLabel(s: Skill): string {
  const segs = s.id.split(".");
  const pretty = segs.map((seg) =>
    seg === "aws" || seg === "gcp" ? seg.toUpperCase() :
    seg.charAt(0).toUpperCase() + seg.slice(1),
  );
  return pretty.join(" · ");
}

function scoreMatch(q: string, stem: string, template: string, id: string): number {
  const s = stem.toLowerCase();
  const t = template.toLowerCase();
  const i = id.toLowerCase();
  if (s.startsWith(q)) return 0;
  if (t.startsWith(q)) return 1;
  if (s.includes(q)) return 2;
  if (i.includes(q.replace(/\s+/g, "."))) return 3;
  if (t.includes(q)) return 4;
  return -1;
}

// ── UI ──────────────────────────────────────────────────────────────────

interface SuggestionsProps {
  open: boolean;
  items: Suggestion[];
  highlight: number;
  onHover: (idx: number) => void;
  onPick: (s: Suggestion) => void;
  onClose: () => void;
}

export function SuggestionsPanel({
  open, items, highlight, onHover, onPick, onClose,
}: SuggestionsProps) {
  if (!open || items.length === 0) return null;

  const current = items[Math.min(Math.max(highlight, 0), items.length - 1)];

  return (
    <div
      role="listbox"
      aria-label="Command palette"
      className={cn(
        "absolute left-0 right-0 bottom-full mb-4",
        "bg-surface rounded-2xl shadow-palette overflow-hidden",
        "animate-pop-in",
      )}
    >
      {/* ── header ──────────────────────────────────────────────────── */}
      <header className="flex items-center h-14 px-6 border-b border-border-subtle bg-surface-sub">
        <span
          aria-hidden
          className="w-6 h-6 rounded-md bg-brand-tint text-brand flex items-center justify-center font-display font-bold text-[14px]"
        >
          ◈
        </span>
        <span className="ml-3 font-display font-semibold text-[17px] text-text-primary">
          Command palette
        </span>
        <span className="ml-3 kicker text-[12px] text-text-muted">
          {items.length} skill{items.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="kicker text-[12px] hidden sm:flex items-center gap-2 text-text-muted">
            <Kbd>esc</Kbd> to close
          </span>
          <button
            onClick={onClose}
            aria-label="Close command palette"
            className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-elevated transition-colors duration-80"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* ── body ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[minmax(420px,1.2fr)_minmax(420px,1fr)]">
        {/* left: command list */}
        <div className="max-h-[68vh] overflow-y-auto py-2 border-r border-border-subtle">
          {items.map((s, i) => (
            <button
              key={s.skill.id}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(s)}
              className={cn(
                "w-full flex items-center gap-4 px-6 h-[72px] text-left",
                "transition-colors duration-80 ease-m-instant",
                i === highlight
                  ? "bg-brand-tint"
                  : "hover:bg-elevated",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "w-1 h-10 rounded-full shrink-0 transition-colors duration-80",
                  i === highlight ? "bg-brand" : "bg-transparent",
                )}
              />
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-mono text-[16px] leading-tight truncate text-text-primary">
                  <span className="text-brand font-semibold">{segNs(s.template)}</span>
                  <span>{segRest(s.template)}</span>
                </span>
                <span className="font-display text-[13px] tracking-wide text-text-muted truncate">
                  {s.sub}
                </span>
              </div>
              <ModeBadge mode={s.skill.danger ? "danger" : s.skill.mode} />
            </button>
          ))}
        </div>

        {/* right: detail */}
        <aside className="p-7 bg-surface-sub/60 max-h-[68vh] overflow-y-auto">
          <div className="kicker text-[12px] text-brand">{current.sub}</div>
          <div className="mt-3 font-display text-[26px] leading-tight font-bold text-text-primary tracking-tight">
            {current.skill.name || current.skill.id}
          </div>
          {current.skill.description && (
            <p className="mt-3 text-[14px] leading-relaxed text-text-secondary">
              {current.skill.description}
            </p>
          )}

          <div className="mt-6 rounded-lg bg-surface border border-border-subtle p-5">
            <div className="kicker text-[12px] text-text-muted mb-2">template</div>
            <div className="font-mono text-[15px] text-text-primary leading-relaxed break-words">
              {current.template}
            </div>
          </div>

          {current.skill.args.length > 0 && (
            <div className="mt-7">
              <div className="kicker text-[12px] text-text-muted mb-3">arguments</div>
              <ul className="font-mono text-[15px] space-y-3">
                {current.skill.args.map((a) => (
                  <li key={a.name} className="flex items-baseline gap-3 flex-wrap">
                    <span
                      aria-hidden
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0 translate-y-0.5",
                        a.required ? "bg-brand" : "bg-border",
                      )}
                    />
                    <span className="text-text-primary font-semibold whitespace-nowrap">
                      {a.positional ? `<${a.name}>` : a.flag}
                    </span>
                    <span className="text-text-muted">{a.type}</span>
                    {a.required && (
                      <span className="kicker text-[11px] text-brand">required</span>
                    )}
                    {a.enum && (
                      <span className="text-text-secondary truncate">
                        one of {a.enum.join(" | ")}
                      </span>
                    )}
                    {a.default != null && (
                      <span className="text-text-muted">default: {String(a.default)}</span>
                    )}
                    {a.repeatable && (
                      <span className="kicker text-[11px] text-text-muted">repeatable</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* ── footer ──────────────────────────────────────────────────── */}
      <footer className="h-12 px-6 flex items-center gap-4 border-t border-border-subtle bg-surface-sub">
        <span className="kicker text-[12px] text-text-muted flex items-center gap-2">
          <Kbd>↑</Kbd><Kbd>↓</Kbd> navigate
        </span>
        <span className="text-border">·</span>
        <span className="kicker text-[12px] text-text-muted flex items-center gap-2">
          <Kbd>tab</Kbd> or <Kbd>↵</Kbd> insert
        </span>
        <span className="text-border">·</span>
        <span className="kicker text-[12px] text-text-muted flex items-center gap-2">
          <Kbd>esc</Kbd> dismiss
        </span>
        <span className="ml-auto kicker text-[12px] text-text-muted hidden md:inline-flex items-center gap-1.5">
          after insert, type to replace <span className="text-brand font-mono">&lt;ph&gt;</span>
          · <Kbd>tab</Kbd> next
          · <Kbd>↵</Kbd> run
        </span>
      </footer>
    </div>
  );
}

function segNs(template: string): string {
  const i = template.indexOf(" ");
  return i === -1 ? template : template.slice(0, i);
}
function segRest(template: string): string {
  const i = template.indexOf(" ");
  return i === -1 ? "" : template.slice(i);
}

function ModeBadge({ mode }: { mode: "read" | "write" | "danger" }) {
  const cls =
    mode === "danger" ? "bg-danger-soft text-danger" :
    mode === "write"  ? "bg-write-soft text-write" :
                        "bg-ok-soft text-ok";
  return (
    <span className={cn("shrink-0 h-6 px-2.5 inline-flex items-center rounded-full text-caption tracking-chip font-mono", cls)}>
      {mode}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-md border border-border-subtle bg-surface font-mono text-[12px] text-text-secondary">
      {children}
    </kbd>
  );
}
