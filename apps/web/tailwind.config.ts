import type { Config } from "tailwindcss";

// "Control Ledger" visual system — see docs/06b-visual-system.md.
// Tokens wire through CSS variables so the same class works in dark and light.

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        elevated: "var(--elevated)",
        border: {
          subtle: "var(--border-subtle)",
          DEFAULT: "var(--border)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        ok: "var(--ok)",
        write: "var(--write)",
        danger: "var(--danger)",
        warn: "var(--warn)",
        pending: "var(--pending)",
        llm: "var(--llm)",
        focus: "var(--focus)",
        accent: {
          DEFAULT: "var(--accent)",
          deep: "var(--accent-deep)",
          soft: "var(--accent-soft)",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        caption: ["11px", { lineHeight: "14px", letterSpacing: "0.08em", fontWeight: "500" }],
        small:   ["12px", { lineHeight: "16px" }],
        body:    ["13px", { lineHeight: "20px" }],
        lead:    ["15px", { lineHeight: "22px", fontWeight: "500" }],
        "mono-body": ["13px", { lineHeight: "20px" }],
        "mono-bar":  ["14px", { lineHeight: "22px" }],
        section: ["17px", { lineHeight: "24px", fontWeight: "600" }],
        hero:    ["20px", { lineHeight: "28px", fontWeight: "600" }],
      },
      borderRadius: { sm: "4px", md: "6px", lg: "10px" },
      letterSpacing: { kicker: "0.08em", chip: "0.12em" },
      transitionTimingFunction: {
        "m-instant":  "cubic-bezier(0.2, 0, 0.2, 1)",
        "m-enter":    "cubic-bezier(0.22, 1, 0.36, 1)",
        "m-exit":     "cubic-bezier(0.5, 0, 0.9, 0.3)",
        "m-error":    "cubic-bezier(0.1, 0.6, 0.3, 1)",
      },
      transitionDuration: {
        80: "80ms",
        160: "160ms",
        200: "200ms",
      },
      keyframes: {
        "stream-sweep": {
          "0%":   { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(120%)" },
        },
        "underline-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "stream-sweep": "stream-sweep 1200ms cubic-bezier(0.4,0,0.6,1) infinite",
        "underline-in": "underline-in 200ms cubic-bezier(0.1,0.6,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
