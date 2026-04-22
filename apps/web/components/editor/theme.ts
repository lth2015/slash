import { EditorView } from "@codemirror/view";

// Minimal CM6 theme. Token colors come from CSS variables (see globals.css)
// so a single palette change flows through the editor as well.
export const commandTheme = EditorView.theme(
  {
    "&": {
      fontSize: "14px",
      fontFamily: "var(--font-geist-mono)",
      backgroundColor: "transparent",
      color: "var(--text-primary)",
    },
    ".cm-content": {
      padding: "10px 0",
      caretColor: "var(--accent)",
      lineHeight: "1.55",
    },
    ".cm-line": { padding: "0" },
    ".cm-cursor": { borderLeftWidth: "2px" },
    ".cm-scroller": { fontFamily: "inherit" },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      background: "color-mix(in oklab, var(--accent) 28%, transparent)",
    },
    ".cm-selectionMatch": { background: "transparent" },
    ".cm-tooltip": {
      background: "var(--elevated)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
    },
  },
  { dark: true }
);
