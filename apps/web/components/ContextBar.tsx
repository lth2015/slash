"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Box, Boxes, Cloud, Pin, PinOff } from "lucide-react";

import { cn } from "@/lib/cn";

type Tier = "critical" | "staging" | "safe";

interface ContextState {
  selected_k8s: string | null;
  selected_k8s_tier: Tier;
  selected_aws: string | null;
  selected_aws_tier: Tier;
  selected_gcp: string | null;
  selected_gcp_tier: Tier;
  drift_k8s: number | null;
  drift_aws: number | null;
  drift_gcp: number | null;
  llm_enabled: boolean;
  llm_configured: boolean;
}

type ContextKind = "k8s" | "aws" | "gcp";

interface ContextBarProps {
  /** Called when user clicks the "Set up pins" CTA — pre-fills the
   *  CommandBar with a starter command so they can tab through. */
  onTypeCommand?: (cmd: string) => void;
}

export function ContextBar({ onTypeCommand }: ContextBarProps = {}) {
  const [state, setState] = useState<ContextState | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/context");
    if (r.ok) setState(await r.json());
  }, []);

  useEffect(() => {
    void refresh();
    // Poll every 3s so pin changes made via `/ctx pin` in the CommandBar
    // show up in the top bar without a manual reload.
    const id = window.setInterval(refresh, 3000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const pins: { kind: ContextKind; name: string | null; tier: Tier }[] = state
    ? [
        { kind: "k8s", name: state.selected_k8s, tier: state.selected_k8s_tier },
        { kind: "aws", name: state.selected_aws, tier: state.selected_aws_tier },
        { kind: "gcp", name: state.selected_gcp, tier: state.selected_gcp_tier },
      ]
    : [];
  const anyPinned = pins.some((p) => p.name);

  return (
    <header className="h-14 flex items-center px-8 border-b border-border-subtle bg-surface/75 backdrop-blur-md">
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
          className="ml-1 inline-flex items-center gap-1.5 h-5 px-2 rounded-full bg-ok-soft text-ok text-caption tracking-chip"
          title="cockpit online"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-ok" aria-hidden />
          online
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {!anyPinned && (
          <button
            type="button"
            onClick={() => onTypeCommand?.("/ctx list")}
            className={cn(
              "group inline-flex items-center gap-2 h-9 pl-3 pr-4 rounded-full",
              "bg-warn-soft border border-warn/45 text-[oklch(32%_0.10_75)]",
              "hover:bg-warn/20 hover:border-warn/70 transition-all duration-160",
              "shadow-xs",
            )}
            title="Type /ctx list to see available contexts, then /ctx pin <kind> <name>."
          >
            <PinOff size={14} className="text-warn" aria-hidden />
            <span className="font-display font-semibold text-[13px]">
              No contexts pinned
            </span>
            <span className="text-border">·</span>
            <span className="font-mono text-[13px] text-warn font-semibold">
              /ctx list
            </span>
            <ArrowRight
              size={13}
              className="text-warn transition-transform duration-160 group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
        )}
        {pins.map((p) =>
          p.name ? (
            <PinPill key={p.kind} kind={p.kind} name={p.name} tier={p.tier} />
          ) : null,
        )}
      </div>
    </header>
  );
}

// ── PinPill ────────────────────────────────────────────────────────────

const KIND_ICON: Record<ContextKind, React.ComponentType<{ size?: number; className?: string }>> = {
  k8s: Boxes,
  aws: Box,
  gcp: Cloud,
};

const KIND_LABEL: Record<ContextKind, string> = {
  k8s: "k8s",
  aws: "aws",
  gcp: "gcp",
};

function PinPill({
  kind,
  name,
  tier,
}: {
  kind: ContextKind;
  name: string;
  tier: Tier;
}) {
  const Icon = KIND_ICON[kind];
  const classes = tierClasses(tier);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 h-8 px-3 rounded-full font-mono text-[13px] border",
        classes.bg,
        classes.border,
        classes.text,
      )}
      title={`${KIND_LABEL[kind]} · ${name} · tier: ${tier}`}
    >
      <Pin size={11} className={classes.icon} aria-hidden />
      <Icon size={13} className={classes.icon} aria-hidden />
      <span className={cn("text-caption tracking-chip uppercase opacity-75", classes.meta)}>
        {KIND_LABEL[kind]}
      </span>
      <span className="text-border" aria-hidden>·</span>
      <span className="font-semibold">{name}</span>
      {tier !== "safe" && (
        <span
          className={cn(
            "ml-0.5 text-[10px] px-1.5 h-4 rounded-full flex items-center font-semibold tracking-chip uppercase",
            classes.badge,
          )}
        >
          {tier}
        </span>
      )}
    </div>
  );
}

function tierClasses(tier: Tier) {
  if (tier === "critical")
    return {
      bg: "bg-tier-critical-bg",
      border: "border-tier-critical/40",
      text: "text-tier-critical",
      icon: "text-tier-critical",
      meta: "text-tier-critical/80",
      badge: "bg-tier-critical text-white",
    };
  if (tier === "staging")
    return {
      bg: "bg-tier-staging-bg",
      border: "border-tier-staging/50",
      text: "text-[oklch(35%_0.10_70)]",
      icon: "text-tier-staging",
      meta: "text-tier-staging/80",
      badge: "bg-tier-staging text-[oklch(25%_0.08_70)]",
    };
  return {
    bg: "bg-brand-tint",
    border: "border-brand-soft",
    text: "text-brand-strong",
    icon: "text-brand",
    meta: "text-brand/80",
    badge: "bg-brand text-white",
  };
}
