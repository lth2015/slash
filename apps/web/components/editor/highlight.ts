// Decoration StateField that paints tokens + optional error range.
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

import { ColorToken, highlightTokens } from "./tokens";

export interface ModeHint {
  /** from the server: "read" | "write"; affects verb coloring */
  mode?: "read" | "write";
  /** from the server: danger skill; overrides verb color */
  danger?: boolean;
}

export interface ErrorRange {
  from: number;
  to: number;
  message: string;
}

export const setModeEffect = StateEffect.define<ModeHint>();
export const setErrorEffect = StateEffect.define<ErrorRange | null>();

interface FieldValue {
  deco: DecorationSet;
  mode: ModeHint;
  error: ErrorRange | null;
}

export const highlightField = StateField.define<FieldValue>({
  create(state) {
    return rebuild(state, { mode: {}, error: null });
  },
  update(value, tr) {
    let mode = value.mode;
    let error = value.error;
    for (const effect of tr.effects) {
      if (effect.is(setModeEffect)) mode = effect.value;
      if (effect.is(setErrorEffect)) error = effect.value;
    }
    if (tr.docChanged || mode !== value.mode || error !== value.error) {
      return rebuild(tr.state, { mode, error });
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function rebuild(state: EditorState, opts: { mode: ModeHint; error: ErrorRange | null }): FieldValue {
  const text = state.doc.toString();
  const tokens = highlightTokens(text);
  const marks = [];

  for (const t of tokens) {
    const cls = classFor(t, opts.mode);
    if (!cls || t.from >= t.to) continue;
    marks.push(Decoration.mark({ class: cls }).range(t.from, t.to));
  }

  if (opts.error && opts.error.from >= 0 && opts.error.from < text.length) {
    const to = Math.min(text.length, Math.max(opts.error.from + 1, opts.error.to || opts.error.from + 1));
    marks.push(
      Decoration.mark({ class: "tok-error" }).range(opts.error.from, to)
    );
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  return { deco: Decoration.set(marks, true), mode: opts.mode, error: opts.error };
}

function classFor(t: ColorToken, mode: ModeHint): string {
  switch (t.kind) {
    case "slash":
      return "tok-slash";
    case "namespace":
      return "tok-namespace";
    case "target":
      return "tok-target";
    case "noun":
      return "tok-noun";
    case "verb":
      if (mode.danger) return "tok-verb-danger";
      if (mode.mode === "write") return "tok-verb-write";
      return "tok-verb";
    case "flag":
      return "tok-flag";
    case "value":
      return "tok-value";
    case "duration":
      return "tok-duration";
    case "string":
      return "tok-string";
    case "ref":
      return "tok-ref";
    case "unknown":
      return "tok-unknown";
    default:
      return "";
  }
}
