"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { CornerDownLeft } from "lucide-react";

import {
  ErrorRange,
  ModeHint,
  highlightField,
  setErrorEffect,
  setModeEffect,
} from "@/components/editor/highlight";
import { commandTheme } from "@/components/editor/theme";
import {
  Suggestion,
  SuggestionsPanel,
  filterSkills,
  findNextPlaceholder,
  findPrevPlaceholder,
  useSkills,
} from "@/components/Suggestions";
import { cn } from "@/lib/cn";

export type ParseStatus =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "ok"; skillId: string; mode: "read" | "write"; danger: boolean }
  | { kind: "error"; code: string; message: string; offset: number; length: number; suggestions: string[] }
  // Client-side meta commands — view control or help, distinct from the
  // strict-DSL skills. Today:
  //   /clear         — wipe the conversation view
  //   /help [...]    — natural-language catalog assistant (LLM-backed,
  //                    read-only; the answer is suggestions, not execution)
  | { kind: "meta"; command: "clear" | "help"; hint: string; rest?: string };

export type MetaCommand =
  | { id: "clear"; rest: "" }
  | { id: "help"; rest: string };

/** Parse a CommandBar input for a recognized meta command. Returns null if
 *  the text is not a meta command. `rest` carries any payload after the
 *  command word (used by /help to pass the user's natural-language
 *  question through). */
export function isMetaCommand(text: string): MetaCommand | null {
  const t = text.trim();
  if (t === "/clear") return { id: "clear", rest: "" };
  if (t === "/help") return { id: "help", rest: "" };
  if (t.startsWith("/help ")) return { id: "help", rest: t.slice(6).trim() };
  return null;
}

const META_HINTS: Record<MetaCommand["id"], string> = {
  clear: "wipe the conversation view (audit keeps its receipts)",
  help: "ask Slash anything — catalog tour, command discovery",
};

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  onSubmit: (text: string) => void;
  statusRef?: (s: ParseStatus) => void;
  disabled?: boolean;
}

type Tier = "critical" | "staging" | "safe";

interface PinState {
  k8s: Tier;
  aws: Tier;
  gcp: Tier;
}

export function CommandBar({ value, onValueChange, onSubmit, statusRef, disabled }: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<ParseStatus>({ kind: "idle" });
  const [pins, setPins] = useState<PinState>({ k8s: "safe", aws: "safe", gcp: "safe" });
  const theme = useMemo(() => commandTheme, []);

  const skills = useSkills();
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => filterSkills(skills, value), [skills, value]);

  // Derive which tier color should saturate the focus ring: peek at the first
  // ~2 tokens of the input; if it's /cluster... → k8s tier, /infra aws → aws,
  // /infra gcp → gcp. Anything else → safe (no special tint).
  const activeTier = useMemo<Tier>(() => {
    const head = value.trimStart();
    if (head.startsWith("/cluster")) return pins.k8s;
    if (head.startsWith("/infra aws")) return pins.aws;
    if (head.startsWith("/infra gcp")) return pins.gcp;
    return "safe";
  }, [value, pins]);

  // Poll /context for the pin state — same interval as ContextBar so they
  // stay in sync without a global store.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/context");
        if (!r.ok || !alive) return;
        const body = await r.json();
        setPins({
          k8s: body.selected_k8s_tier ?? "safe",
          aws: body.selected_aws_tier ?? "safe",
          gcp: body.selected_gcp_tier ?? "safe",
        });
      } catch { /* offline or starting up */ }
    };
    void load();
    const id = window.setInterval(load, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // Open if input starts with '/' and has suggestions, and current text doesn't
  // already match a fully-resolved stem (avoid popping over a parsed command).
  const open = useMemo(() => {
    if (!value || !value.startsWith("/")) return false;
    if (suggestions.length === 0) return false;
    if (status.kind === "ok" && !value.trim().endsWith(" ") === false) {
      // parsed successfully AND user has moved on — still show if user keeps typing
    }
    return true;
  }, [value, suggestions.length, status.kind]);

  // Clamp highlight when list changes
  useEffect(() => {
    setHighlight((h) => Math.min(Math.max(0, h), Math.max(0, suggestions.length - 1)));
  }, [suggestions.length]);

  const onSubmitRef = useRef(onSubmit);
  const onValRef = useRef(onValueChange);
  onSubmitRef.current = onSubmit;
  onValRef.current = onValueChange;

  // Track the last text we reported up to the parent AND whether the parent
  // has acknowledged it (by sending it back as a value prop). The sync
  // effect uses this pair to distinguish three scenarios:
  //   A. fast typing — parent's value prop is lagging behind our latest
  //      listener report. Any intermediate prop is an echo in transit; do
  //      NOT overwrite the editor with it (would drop characters).
  //   B. parent has caught up — value prop equals our last report. Mark the
  //      channel "in sync" so subsequent mismatches count as genuine
  //      external updates.
  //   C. external update (suggestion click, submit clears via setText(""),
  //      meta-command fill) — value prop differs from our last report AND
  //      the channel is in sync. Sync the new value into the editor.
  // Without this, `/ctx list` becomes `/ list` under fast typing.
  const lastReportedRef = useRef(value);
  const parentCaughtUpRef = useRef(true);

  // Latest copies for key handlers that live inside the one-time effect.
  const openRef = useRef(open);
  const hlRef = useRef(highlight);
  const itemsRef = useRef<Suggestion[]>(suggestions);
  openRef.current = open;
  hlRef.current = highlight;
  itemsRef.current = suggestions;

  useEffect(() => { statusRef?.(status); }, [status, statusRef]);

  const pick = useCallback((s: Suggestion) => {
    const v = viewRef.current;
    if (!v) return;
    const currentLen = v.state.doc.length;
    // Snippet-mode insertion: replace the full doc, then select the first
    // <placeholder> so the user's very next keystroke wipes the brackets
    // and their value takes its place. Tab / Shift+Tab navigate subsequent
    // placeholders — no manual delete needed.
    const span = findNextPlaceholder(s.insert, 0);
    v.dispatch({
      changes: { from: 0, to: currentLen, insert: s.insert },
      selection: span
        ? { anchor: span.from, head: span.to }
        : { anchor: s.insert.length },
    });
    v.focus();
    // Briefly flash the newly-selected placeholder so the eye lands on it.
    if (span) {
      const el = v.contentDOM;
      el.classList.remove("snippet-flash");
      // force reflow so the animation restarts on back-to-back picks
      void el.offsetWidth;
      el.classList.add("snippet-flash");
      window.setTimeout(() => el.classList.remove("snippet-flash"), 520);
    }
  }, []);

  const jumpPlaceholder = useCallback((backward: boolean) => {
    const v = viewRef.current;
    if (!v) return false;
    const sel = v.state.selection.main;
    const doc = v.state.doc.toString();
    const span = backward
      ? findPrevPlaceholder(doc, sel.from)
      : findNextPlaceholder(doc, sel.head);
    if (!span) return false;
    v.dispatch({ selection: { anchor: span.from, head: span.to } });
    const el = v.contentDOM;
    el.classList.remove("snippet-flash");
    void el.offsetWidth;
    el.classList.add("snippet-flash");
    window.setTimeout(() => el.classList.remove("snippet-flash"), 520);
    return true;
  }, []);

  const closePalette = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    if (v.state.doc.length > 0) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "" } });
    }
    v.contentDOM.blur();
  }, []);

  const pickCurrent = useCallback(() => {
    const items = itemsRef.current;
    if (!items.length) return false;
    const i = Math.min(Math.max(hlRef.current, 0), items.length - 1);
    pick(items[i]);
    return true;
  }, [pick]);

  useEffect(() => {
    if (!parentRef.current) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let inFlight: AbortController | null = null;

    const submitOrPick = keymap.of([
      {
        key: "ArrowDown",
        preventDefault: true,
        run: () => {
          if (!openRef.current) return false;
          setHighlight((h) => Math.min(itemsRef.current.length - 1, h + 1));
          return true;
        },
      },
      {
        key: "ArrowUp",
        preventDefault: true,
        run: () => {
          if (!openRef.current) return false;
          setHighlight((h) => Math.max(0, h - 1));
          return true;
        },
      },
      {
        key: "Tab",
        preventDefault: true,
        run: () => {
          if (openRef.current) return pickCurrent();
          return jumpPlaceholder(false);
        },
      },
      {
        key: "Shift-Tab",
        preventDefault: true,
        run: () => {
          if (openRef.current) return false;
          return jumpPlaceholder(true);
        },
      },
      {
        key: "Enter",
        preventDefault: true,
        run: (v) => {
          const text = v.state.doc.toString();
          // Enter always submits intent-complete input. Palette still helps via
          // Tab (insert highlighted) and arrow keys (change highlight); Enter
          // only short-circuits into the palette when the user has typed
          // nothing yet (empty bar) or still has a `<placeholder>` to fill —
          // both cases where submitting would error on the server anyway.
          const canPick =
            openRef.current &&
            itemsRef.current.length > 0 &&
            (text.trim().length === 0 || text.includes("<"));
          if (canPick) return pickCurrent();
          if (text.trim()) onSubmitRef.current(text);
          return true;
        },
      },
      {
        key: "Escape",
        run: () => {
          // Clear the input — this also closes the palette since it reacts to value.
          const v = viewRef.current;
          if (!v) return false;
          if (!v.state.doc.length) return false;
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "" } });
          return true;
        },
      },
    ]);

    const listener = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      const text = u.state.doc.toString();
      lastReportedRef.current = text;
      parentCaughtUpRef.current = false;
      onValRef.current(text);
      if (debounce) clearTimeout(debounce);
      if (!text.trim()) {
        setStatus({ kind: "idle" });
        u.view.dispatch({ effects: [setModeEffect.of({}), setErrorEffect.of(null)] });
        return;
      }
      // Meta commands short-circuit the parser: no red wavy underline for
      // "UnknownNamespace", just a soft hint in the status line.
      const meta = isMetaCommand(text);
      if (meta) {
        u.view.dispatch({ effects: [setModeEffect.of({}), setErrorEffect.of(null)] });
        setStatus({
          kind: "meta",
          command: meta.id,
          hint: META_HINTS[meta.id],
          rest: meta.rest,
        });
        return;
      }
      setStatus({ kind: "parsing" });
      debounce = setTimeout(() => {
        if (inFlight) inFlight.abort();
        inFlight = new AbortController();
        fetch("/api/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: inFlight.signal,
        })
          .then((r) => r.json())
          .then((body) => {
            if (body.ok) {
              const mh: ModeHint = { mode: body.mode, danger: !!body.danger };
              u.view.dispatch({ effects: [setModeEffect.of(mh), setErrorEffect.of(null)] });
              setStatus({
                kind: "ok",
                skillId: body.skill_id,
                mode: body.mode,
                danger: body.danger,
              });
            } else {
              const err: ErrorRange = {
                from: body.offset ?? 0,
                to: (body.offset ?? 0) + Math.max(1, body.length ?? 1),
                message: body.message ?? "",
              };
              u.view.dispatch({ effects: [setModeEffect.of({}), setErrorEffect.of(err)] });
              setStatus({
                kind: "error",
                code: body.code,
                message: body.message,
                offset: body.offset ?? 0,
                length: body.length ?? 1,
                suggestions: body.suggestions ?? [],
              });
            }
          })
          .catch(() => { /* abort / net err */ });
      }, 120);
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        // Put our overrides FIRST so they beat the default Enter behavior.
        submitOrPick,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlightField,
        theme,
        placeholder("Type / to discover commands…"),
        listener,
        EditorView.domEventHandlers({
          focus: () => { setFocused(true); return false; },
          blur: () => { setFocused(false); return false; },
        }),
        EditorView.contentAttributes.of({
          "aria-label": "SRE Copilot command input",
          role: "textbox",
          spellcheck: "false",
          autocorrect: "off",
          autocapitalize: "off",
        }),
      ],
    });
    const view = new EditorView({ state, parent: parentRef.current });
    viewRef.current = view;
    return () => {
      if (debounce) clearTimeout(debounce);
      if (inFlight) inFlight.abort();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync *external* value changes into the editor (suggestion clicks,
  // /clear via props, meta-command fills, submit clearing to ""). We
  // classify each incoming prop against our report/ack channel state —
  // see lastReportedRef / parentCaughtUpRef above for the scenarios.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) {
      parentCaughtUpRef.current = true;
      return;
    }
    if (value === lastReportedRef.current) {
      // B: parent has caught up to what we reported. Flag the channel as
      // synced so subsequent mismatches are genuine external updates.
      parentCaughtUpRef.current = true;
      return;
    }
    if (!parentCaughtUpRef.current) {
      // A: parent-side lag — skip until it catches up.
      return;
    }
    // C: genuine external update. Sync into the editor, pull focus back
    // (suggestion / chip clicks otherwise leave focus on the source
    // button so Enter re-clicks it instead of running the command), and
    // if the filled text has a `<placeholder>`, select it so the user's
    // next keystroke replaces the bracketed span — same snippet-mode UX
    // the in-bar palette pick already gives.
    lastReportedRef.current = value;
    const placeholder = findNextPlaceholder(value, 0);
    v.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: placeholder
        ? { anchor: placeholder.from, head: placeholder.to }
        : { anchor: value.length },
    });
    if (placeholder) {
      const el = v.contentDOM;
      el.classList.remove("snippet-flash");
      void el.offsetWidth;
      el.classList.add("snippet-flash");
      window.setTimeout(() => el.classList.remove("snippet-flash"), 520);
    }
    // dispatch fired our own listener synchronously, which flipped
    // parentCaughtUpRef to false. But this update ORIGINATED from a value
    // we just received from the parent — the channel is in sync by
    // construction. Restore the flag so the NEXT parent update (e.g.
    // submit-clearing to "") won't be mistaken for lag and ignored.
    parentCaughtUpRef.current = true;
    if (value) v.focus();
  }, [value]);

  return (
    <>
      {/* Focus scrim — fades out everything behind the open palette. */}
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 z-10 transition-opacity duration-200 ease-m-enter",
          "bg-canvas/70 backdrop-blur-[3px]",
          open ? "opacity-100 pointer-events-none" : "opacity-0 pointer-events-none",
        )}
      />

      <div className="relative z-20 border-t border-border-subtle bg-surface/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 pt-4 pb-3 relative">
          <SuggestionsPanel
            open={open}
            items={suggestions}
            highlight={highlight}
            onHover={setHighlight}
            onPick={pick}
            onClose={closePalette}
          />

          <div
            className={cn(
              "flex items-stretch rounded-xl border bg-surface transition-all duration-160 ease-m-instant",
              focused
                ? tierBorderClass(activeTier)
                : "border-border-subtle shadow-xs",
              disabled && "opacity-60 pointer-events-none",
            )}
          >
            <div ref={parentRef} className="flex-1 min-w-0 px-5 py-1" />
            <div className="flex items-center pr-2 py-2">
              <button
                type="button"
                onClick={() => {
                  const v = viewRef.current;
                  if (!v) return;
                  const text = v.state.doc.toString();
                  if (text.trim()) onSubmitRef.current(text);
                }}
                disabled={!value.trim()}
                className={cn(
                  "group inline-flex items-center gap-2 h-11 pl-5 pr-4 rounded-lg",
                  "bg-ok text-white font-display font-semibold text-[14px] tracking-[0.02em]",
                  "shadow-[0_1px_0_0_oklch(38%_0.14_155_/_0.3)_inset,0_2px_8px_-2px_oklch(62%_0.16_155_/_0.45)]",
                  "hover:brightness-105 active:brightness-95 transition-all duration-160",
                  "disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none disabled:brightness-100",
                )}
                title="Run the command (Enter)"
              >
                <span>Run</span>
                <kbd className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/20 font-mono text-[12px]">
                  <CornerDownLeft size={12} />
                </kbd>
              </button>
            </div>
          </div>
          <StatusLine status={status} />
        </div>
      </div>
    </>
  );
}

function StatusLine({ status }: { status: ParseStatus }) {
  return (
    <div className="h-7 mt-2 px-1 flex items-center text-small font-mono">
      {status.kind === "idle" && (
        <span className="text-text-muted">
          Ready. Press <span className="text-brand font-medium">/</span> to browse commands, type to filter.
        </span>
      )}
      {status.kind === "parsing" && (
        <span className="text-text-secondary flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
          parsing…
        </span>
      )}
      {status.kind === "ok" && (
        <span className="flex items-center gap-2 text-text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-ok" aria-hidden />
          <span className="text-text-secondary">parsed</span>
          <span className="text-border">·</span>
          <span
            className={cn(
              "text-caption tracking-chip rounded-full px-2 py-0.5",
              status.danger
                ? "bg-danger-soft text-danger"
                : status.mode === "write"
                  ? "bg-write-soft text-write"
                  : "bg-ok-soft text-ok",
            )}
          >
            {status.danger ? "DANGER" : status.mode.toUpperCase()}
          </span>
          <span className="text-border">·</span>
          <span className="text-text-secondary">{status.skillId}</span>
        </span>
      )}
      {status.kind === "meta" && (
        <span className="flex items-center gap-2 text-text-primary flex-wrap">
          <span
            className="inline-flex items-center h-5 px-2 rounded-full text-caption tracking-chip uppercase font-semibold bg-brand-soft text-brand-strong"
          >
            {status.command === "help" ? "help · llm" : "meta"}
          </span>
          <span className="text-text-secondary">press</span>
          <kbd className="px-1.5 h-5 inline-flex items-center rounded border border-border-subtle bg-surface-sub font-mono text-caption">↵</kbd>
          <span className="text-text-secondary">to {status.hint}</span>
          {status.command === "help" && status.rest && (
            <>
              <span className="text-border">·</span>
              <span className="text-text-secondary italic">question: &ldquo;{status.rest.slice(0, 60)}{status.rest.length > 60 ? "…" : ""}&rdquo;</span>
            </>
          )}
        </span>
      )}
      {status.kind === "error" && (
        <span className="flex items-center gap-2 text-text-primary flex-wrap">
          <span className="text-danger font-semibold">✕</span>
          <span className="text-danger">{status.code}</span>
          <span className="text-text-muted">at col {status.offset + 1}</span>
          <span className="text-border">·</span>
          <span className="text-text-secondary truncate">{status.message}</span>
          {status.suggestions.length > 0 && (
            <>
              <span className="text-border">·</span>
              <span className="text-text-muted">try:</span>
              <span className="flex gap-2">
                {status.suggestions.slice(0, 3).map((s) => (
                  <span key={s} className="text-text-secondary font-mono">{s}</span>
                ))}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

// Focus-ring color driven by the current session pin tier for the namespace
// under the caret. This is the Environment Aura's single peripheral-vision
// channel — type in prod, you type against a warm saturated ring.
function tierBorderClass(tier: "critical" | "staging" | "safe"): string {
  if (tier === "critical") return "border-tier-critical shadow-[0_0_0_3px_oklch(62%_0.20_30/0.18)]";
  if (tier === "staging") return "border-tier-staging shadow-[0_0_0_3px_oklch(70%_0.14_75/0.18)]";
  return "border-brand shadow-brand";
}
