"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Moon, Sparkles, Sun } from "lucide-react";

import { cn } from "@/lib/cn";

interface ContextState {
  aws_profiles: string[];
  gcp_configurations: string[];
  k8s_contexts: string[];
  selected_aws: string | null;
  selected_gcp: string | null;
  selected_k8s: string | null;
  llm_enabled: boolean;
  llm_configured: boolean;
}

export function ContextBar() {
  const [state, setState] = useState<ContextState | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  async function refresh() {
    const r = await fetch("/api/context");
    if (r.ok) setState(await r.json());
  }

  async function setField(key: "aws" | "gcp" | "k8s", value: string) {
    const r = await fetch("/api/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (r.ok) setState(await r.json());
  }

  async function setLlm(enabled: boolean) {
    const r = await fetch("/api/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llm_enabled: enabled }),
    });
    if (r.ok) setState(await r.json());
  }

  return (
    <div className="h-12 flex items-center px-5 gap-6 border-b border-border bg-surface/80 backdrop-blur-sm">
      <div className="flex items-center gap-2 select-none">
        <span className="font-mono brand-grad font-bold text-[18px] leading-none">/</span>
        <span className="font-semibold tracking-tight text-[14px] text-text-primary">Slash</span>
      </div>

      <div className="h-4 w-px bg-border-subtle" aria-hidden />

      <Selector
        label="aws"
        value={state?.selected_aws}
        options={state?.aws_profiles ?? []}
        onChange={(v) => setField("aws", v)}
      />
      <Selector
        label="gcp"
        value={state?.selected_gcp}
        options={state?.gcp_configurations ?? []}
        onChange={(v) => setField("gcp", v)}
      />
      <Selector
        label="k8s"
        value={state?.selected_k8s}
        options={state?.k8s_contexts ?? []}
        onChange={(v) => setField("k8s", v)}
      />

      <div className="ml-auto flex items-center gap-4">
        <LlmToggle
          configured={!!state?.llm_configured}
          enabled={!!state?.llm_enabled}
          onChange={setLlm}
        />
        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="p-1.5 rounded-sm text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors duration-80 ease-m-instant"
          aria-label={`switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title="toggle theme"
        >
          {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>
    </div>
  );
}

function Selector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="relative flex items-center gap-2 text-caption font-mono tracking-kicker uppercase text-text-muted">
      <span>{label}</span>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "appearance-none bg-canvas border border-border-subtle rounded-sm",
            "pl-2 pr-6 h-6 text-small font-mono text-text-primary",
            "hover:border-border transition-colors duration-80 ease-m-instant",
            "min-w-[120px] max-w-[240px] truncate",
          )}
        >
          <option value="" disabled>
            —
          </option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted"
        />
      </div>
    </label>
  );
}

function LlmToggle({
  configured,
  enabled,
  onChange,
}: {
  configured: boolean;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      disabled={!configured}
      onClick={() => onChange(!enabled)}
      className={cn(
        "flex items-center gap-2 h-6 px-2 rounded-sm border transition-colors duration-80 ease-m-instant",
        configured
          ? enabled
            ? "bg-llm/10 border-llm/50 text-llm"
            : "border-border-subtle text-text-muted hover:text-text-secondary"
          : "border-border-subtle text-text-muted/60 cursor-not-allowed",
      )}
      title={
        !configured
          ? "GEMINI_API_KEY not set — LLM summary unavailable"
          : enabled
            ? "Disable LLM summary"
            : "Enable LLM summary (Gemini 2.5 Flash)"
      }
    >
      <Sparkles size={12} />
      <span className="text-caption font-mono tracking-kicker uppercase">
        llm · {enabled ? "on" : "off"}
      </span>
    </button>
  );
}
