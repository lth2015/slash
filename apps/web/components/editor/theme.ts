import { EditorView } from "@codemirror/view";

// Minimal CM6 theme. Token colors are applied via Decoration classes; this file
// sets typography, caret, and selection only.
export const commandTheme = EditorView.theme(
  {
    "&": {
      fontSize: "14px",
      fontFamily: "var(--font-geist-mono)",
      backgroundColor: "transparent",
      color: "#E6EAF0",
    },
    ".cm-content": {
      padding: "10px 0",
      caretColor: "#6EA8FE",
      lineHeight: "1.55",
    },
    ".cm-line": { padding: "0" },
    ".cm-cursor": { borderLeftWidth: "2px" },
    ".cm-scroller": { fontFamily: "inherit" },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      background: "rgba(110, 168, 254, 0.25)",
    },
    ".cm-selectionMatch": { background: "transparent" },
    ".cm-tooltip": {
      background: "#171B21",
      border: "1px solid #2A313A",
      borderRadius: "4px",
    },
    // Tokenized class rules:
    ".tok-slash": { color: "#6B7280" },
    ".tok-namespace": { color: "rgba(110, 168, 254, 0.95)" },
    ".tok-target": { color: "#9BA3AF" },
    ".tok-noun": { color: "#E6EAF0" },
    ".tok-verb": { color: "#E6EAF0" },
    ".tok-verb-write": { color: "#A78BFA" },
    ".tok-verb-danger": { color: "#E5484D" },
    ".tok-flag": { color: "#6B7280" },
    ".tok-value": { color: "#E6EAF0", fontWeight: "500" },
    ".tok-duration": { color: "#9BA3AF", fontVariantNumeric: "tabular-nums" },
    ".tok-string": { color: "#E6EAF0" },
    ".tok-ref": {
      color: "#E6EAF0",
      textDecoration: "underline dotted #2A313A",
      textUnderlineOffset: "4px",
    },
    ".tok-unknown": { color: "#E5484D" },
  },
  { dark: true }
);
