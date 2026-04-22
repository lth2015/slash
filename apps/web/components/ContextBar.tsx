"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/cn";

interface ContextState {
  llm_enabled: boolean;
  llm_configured: boolean;
}

export function ContextBar() {
  const [state, setState] = useState<ContextState | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const r = await fetch("/api/context");
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
    <header className="h-14 flex items-center px-8 border-b border-border-subtle bg-surface/70 backdrop-blur-md">
      <div className="flex items-center gap-3 select-none">
        <span
          aria-hidden
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[15px] font-display font-bold brand-grad border border-brand-soft bg-brand-tint"
        >
          ◈
        </span>
        <span className="font-display font-bold text-[17px] tracking-tight text-text-primary">
          SRE Copilot
        </span>
        <span
          className="ml-2 inline-flex items-center gap-1.5 h-5 px-2 rounded-full bg-ok-soft text-ok text-caption tracking-chip"
          title="cockpit online"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-ok" aria-hidden />
          online
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <LlmToggle
          configured={!!state?.llm_configured}
          enabled={!!state?.llm_enabled}
          onChange={setLlm}
        />
      </div>
    </header>
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
        "group inline-flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-full border transition-all duration-160 ease-m-instant",
        configured
          ? enabled
            ? "bg-brand-tint border-brand/40 text-brand-strong shadow-xs"
            : "bg-surface border-border-subtle text-text-secondary hover:border-border hover:bg-elevated"
          : "bg-surface border-border-subtle text-text-muted/70 cursor-not-allowed",
      )}
      title={
        !configured
          ? "GEMINI_API_KEY not set — LLM summary unavailable"
          : enabled
            ? "LLM explain: on"
            : "LLM explain: off"
      }
    >
      <Sparkles
        size={13}
        className={cn(
          configured && enabled ? "text-brand" : "text-text-muted",
        )}
      />
      <span className="text-caption font-mono tracking-chip">
        llm · {enabled ? "on" : "off"}
      </span>
    </button>
  );
}
