import type { Config } from "tailwindcss";

// SRE Copilot — 2026 Soft Glass Commerce (light only).
// Token names kept backwards-compatible so utility classes across cards
// (bg-canvas / text-text-primary / bg-elevated / border-subtle …) keep working.

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas:      "var(--canvas)",
        surface:     "var(--surface)",
        elevated:    "var(--elevated)",
        "surface-sub": "var(--surface-sub)",
        border: {
          subtle:    "var(--border-subtle)",
          DEFAULT:   "var(--border)",
        },
        text: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted:     "var(--text-muted)",
        },
        brand: {
          DEFAULT:   "var(--brand)",
          strong:    "var(--brand-strong)",
          soft:      "var(--brand-soft)",
          tint:      "var(--brand-tint)",
        },
        ok:      "var(--ok)",
        "ok-soft": "var(--ok-soft)",
        write:   "var(--write)",
        "write-soft": "var(--write-soft)",
        danger:  "var(--danger)",
        "danger-soft": "var(--danger-soft)",
        warn:    "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        pending: "var(--pending)",
        "pending-soft": "var(--pending-soft)",
        llm:     "var(--llm)",
        "llm-soft": "var(--llm-soft)",
        focus:   "var(--focus)",
        accent: {
          DEFAULT: "var(--accent)",
          deep:    "var(--accent-deep)",
          soft:    "var(--accent-soft)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans:    ["var(--font-body)",    "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)",    "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        // Compact utility scale (display uses the .display-* presets)
        caption: ["11px", { lineHeight: "14px", letterSpacing: "0.12em", fontWeight: "600" }],
        micro:   ["12px", { lineHeight: "16px" }],
        small:   ["13px", { lineHeight: "18px" }],
        body:    ["15px", { lineHeight: "22px" }],
        lead:    ["17px", { lineHeight: "26px", fontWeight: "500" }],
        "mono-body": ["13px", { lineHeight: "20px" }],
        "mono-bar":  ["15px", { lineHeight: "24px" }],
        section: ["20px", { lineHeight: "28px", fontWeight: "700", letterSpacing: "-0.02em" }],
        hero:    ["28px", { lineHeight: "34px", fontWeight: "800", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        sm:   "6px",
        md:   "10px",
        lg:   "14px",
        xl:   "20px",
        "2xl":"28px",
      },
      boxShadow: {
        xs:     "var(--shadow-xs)",
        sm:     "var(--shadow-sm)",
        md:     "var(--shadow-md)",
        lg:     "var(--shadow-lg)",
        brand:  "var(--shadow-brand)",
        palette:"var(--shadow-palette)",
      },
      letterSpacing: { kicker: "0.14em", chip: "0.12em" },
      transitionTimingFunction: {
        "m-instant": "cubic-bezier(0.2, 0, 0.2, 1)",
        "m-enter":   "cubic-bezier(0.22, 1, 0.36, 1)",
        "m-exit":    "cubic-bezier(0.5, 0, 0.9, 0.3)",
        "m-error":   "cubic-bezier(0.1, 0.6, 0.3, 1)",
      },
      transitionDuration: { 80: "80ms", 160: "160ms", 200: "200ms" },
      keyframes: {
        "stream-sweep": {
          "0%":   { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(120%)" },
        },
        "underline-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "pop-in": {
          "0%":   { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "stream-sweep": "stream-sweep 1200ms cubic-bezier(0.4,0,0.6,1) infinite",
        "underline-in": "underline-in 200ms cubic-bezier(0.1,0.6,0.3,1) both",
        "pop-in":       "pop-in 140ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
