import { EditorView } from "@codemirror/view";

// Minimal CM6 theme. Token colors come from CSS variables (see globals.css)
// so a single palette change flows through the editor as well.
export const commandTheme = EditorView.theme(
  {
    "&": {
      fontSize: "17px",
      fontFamily: "var(--font-mono)",
      backgroundColor: "transparent",
      color: "var(--text-primary)",
    },
    ".cm-content": {
      padding: "14px 0",
      caretColor: "var(--brand)",
      lineHeight: "1.5",
    },
    ".cm-line": { padding: "0" },
    ".cm-cursor": { borderLeftWidth: "2px", borderLeftColor: "var(--brand)" },
    ".cm-scroller": { fontFamily: "inherit" },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      background: "oklch(58% 0.22 285 / 0.22)",
    },
    ".cm-selectionMatch": { background: "transparent" },
    ".cm-tooltip": {
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      boxShadow: "var(--shadow-md)",
    },
    ".cm-placeholder": {
      color: "var(--text-muted)",
      fontStyle: "normal",
    },
  },
  { dark: false },
);
