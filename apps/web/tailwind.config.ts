import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0B0D10",
        surface: "#111418",
        elevated: "#171B21",
        border: {
          subtle: "#1F242B",
          DEFAULT: "#2A313A",
        },
        text: {
          primary: "#E6EAF0",
          secondary: "#9BA3AF",
          muted: "#6B7280",
        },
        accent: {
          primary: "#6EA8FE",
          ok: "#5DC48A",
          warn: "#E6B450",
          danger: "#E5484D",
          write: "#A78BFA",
          pending: "#8FA3BF",
        },
      },
      fontFamily: {
        sans: [
          "Inter Variable",
          "-apple-system",
          "Segoe UI Variable",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
