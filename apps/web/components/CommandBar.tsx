"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";

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
  useSkills,
} from "@/components/Suggestions";
import { cn } from "@/lib/cn";

export type ParseStatus =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "ok"; skillId: string; mode: "read" | "write"; danger: boolean }
  | { kind: "error"; code: string; message: string; offset: number; length: number; suggestions: string[] };

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
    v.dispatch({
      changes: { from: 0, to: currentLen, insert: s.insert },
      selection: { anchor: s.caretAt >= 0 ? s.caretAt : s.insert.length },
    });
    v.focus();
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
          if (!openRef.current) return false;
          return pickCurrent();
        },
      },
      {
        key: "Enter",
        preventDefault: true,
        run: (v) => {
          const text = v.state.doc.toString();
          // If palette is open AND current text is just a prefix with no placeholder
          // yet filled, treat Enter as "insert" — user is browsing.
          const canPick =
            openRef.current &&
            itemsRef.current.length > 0 &&
            // Only auto-pick when input is short / doesn't look like a full command.
            (text.trim().length === 0 ||
              text.trimEnd().split(/\s+/).length <= 2 ||
              text.includes("<"));
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
      onValRef.current(text);
      if (debounce) clearTimeout(debounce);
      if (!text.trim()) {
        setStatus({ kind: "idle" });
        u.view.dispatch({ effects: [setModeEffect.of({}), setErrorEffect.of(null)] });
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

  // Sync external value (e.g. suggestion click from empty state)
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
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
            <div className="hidden md:flex items-center gap-2 pr-4 text-caption tracking-chip text-text-muted select-none">
              <kbd className="px-2 py-0.5 rounded-md border border-border-subtle bg-surface-sub font-mono text-[11px]">↵</kbd>
              <span>run</span>
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
