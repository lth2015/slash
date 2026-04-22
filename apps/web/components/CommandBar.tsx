"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

export function CommandBar({ value, onValueChange, onSubmit, statusRef, disabled }: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<ParseStatus>({ kind: "idle" });
  const theme = useMemo(() => commandTheme, []);

  const onSubmitRef = useRef(onSubmit);
  const onValRef = useRef(onValueChange);
  onSubmitRef.current = onSubmit;
  onValRef.current = onValueChange;

  useEffect(() => { statusRef?.(status); }, [status, statusRef]);

  useEffect(() => {
    if (!parentRef.current) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let inFlight: AbortController | null = null;

    const submitKm = keymap.of([{
      key: "Enter",
      preventDefault: true,
      run: (v) => {
        const text = v.state.doc.toString();
        if (text.trim()) onSubmitRef.current(text);
        return true;
      },
    }]);

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
        keymap.of([...defaultKeymap, ...historyKeymap]),
        submitKm,
        highlightField,
        theme,
        placeholder("Type a command, e.g. /ops audit logs --since 1d"),
        listener,
        EditorView.domEventHandlers({
          focus: () => { setFocused(true); return false; },
          blur: () => { setFocused(false); return false; },
        }),
        EditorView.contentAttributes.of({
          "aria-label": "Slash command input",
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

  // Sync external value (e.g. suggestion click)
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return (
    <div className="border-t border-border bg-surface/80 backdrop-blur-sm">
      <div
        className={cn(
          "flex items-stretch transition-shadow duration-160 ease-m-instant",
          focused &&
            "shadow-[inset_0_1px_0_0_var(--accent),0_-8px_24px_-12px_color-mix(in_oklab,var(--accent)_55%,transparent)]",
          disabled && "opacity-60 pointer-events-none",
        )}
      >
        <div
          aria-hidden
          className="w-10 bg-canvas border-r border-border-subtle flex items-start justify-center pt-2 text-caption font-mono text-text-muted select-none tabular"
        >
          1
        </div>
        <div ref={parentRef} className="flex-1 min-w-0 px-4" />
        <div className="hidden md:flex items-center gap-2 pr-4 text-caption tracking-kicker uppercase text-text-muted select-none">
          <kbd className="px-1.5 py-0.5 rounded-sm border border-border-subtle bg-canvas font-mono">↵</kbd>
          <span>run</span>
        </div>
      </div>
      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status }: { status: ParseStatus }) {
  return (
    <div className="h-7 px-5 flex items-center text-mono-body font-mono border-t border-border-subtle">
      {status.kind === "idle" && (
        <span className="text-text-muted">
          — ready — <span className="text-border">·</span> type a command starting with <span className="text-text-secondary">/</span>
        </span>
      )}
      {status.kind === "parsing" && (
        <span className="text-text-secondary">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-secondary mr-2 align-middle animate-pulse" />
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
              "text-caption tracking-chip uppercase rounded-sm border px-1.5 py-[1px]",
              status.danger
                ? "bg-danger/10 border-danger/50 text-danger"
                : status.mode === "write"
                  ? "bg-write/10 border-write/40 text-write"
                  : "bg-ok/10 border-ok/40 text-ok",
            )}
          >
            {status.danger ? "DANGER" : status.mode.toUpperCase()}
          </span>
          <span className="text-border">·</span>
          <span>{status.skillId}</span>
        </span>
      )}
      {status.kind === "error" && (
        <span className="flex items-center gap-2 text-text-primary flex-wrap">
          <span className="text-danger">✕</span>
          <span className="text-danger">{status.code}</span>
          <span className="text-text-muted">at col {status.offset + 1}</span>
          <span className="text-border">·</span>
          <span className="text-text-secondary truncate">{status.message}</span>
          {status.suggestions.length > 0 && (
            <>
              <span className="text-border">·</span>
              <span className="text-text-muted">try:</span>
              <span className="flex gap-2">
                {status.suggestions.slice(0, 3).map((s) => <span key={s} className="text-text-secondary font-mono">{s}</span>)}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
