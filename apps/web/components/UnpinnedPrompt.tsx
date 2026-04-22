"use client";

import { useEffect, useState } from "react";
import { ArrowRight, PinOff } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Floating "pin first" prompt anchored at the top-center of the conversation
 * area. Renders only when no k8s/aws/gcp pin is set. Clicking the primary
 * CTA pre-fills the CommandBar with `/ctx list` and opens the palette.
 *
 * This is the cockpit's "you haven't configured anything yet" moment —
 * nothing works until a context is pinned, so we want the prompt to be
 * the visual focus, not a tiny corner badge.
 */
export function UnpinnedPrompt({
  onTypeCommand,
}: {
  onTypeCommand: (cmd: string) => void;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/context");
        if (!r.ok || !alive) return;
        const body = await r.json();
        const anyPinned = !!(body.selected_k8s || body.selected_aws || body.selected_gcp);
        setShow(!anyPinned);
      } catch { /* offline or starting */ }
    };
    void load();
    const id = window.setInterval(load, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  if (!show) return null;

  return (
    <div className="relative z-10 flex justify-center pt-6 pb-0 pointer-events-none">
      <div
        className={cn(
          "pointer-events-auto w-[min(720px,92%)]",
          "bg-warn-soft border border-warn/55 rounded-2xl",
          "shadow-lg",
          "animate-pop-in",
        )}
      >
        <div className="flex items-start gap-5 p-5">
          <div
            className={cn(
              "shrink-0 w-11 h-11 rounded-xl flex items-center justify-center",
              "bg-warn/20 border border-warn/40",
            )}
            aria-hidden
          >
            <PinOff size={20} className="text-warn" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display font-bold text-[18px] text-[oklch(26%_0.08_75)] tracking-tight">
                No contexts pinned.
              </h3>
              <span className="font-display text-[14px] text-[oklch(38%_0.08_75)]">
                Every cluster / cloud command needs a target.
              </span>
            </div>
            <p className="mt-1 text-small text-[oklch(42%_0.06_75)] leading-relaxed">
              Pin once per session — every command after inherits the pinned
              context. Use <span className="font-mono text-[oklch(32%_0.10_75)] font-semibold">/ctx list</span> to see what's available on this machine.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onTypeCommand("/ctx list")}
                className={cn(
                  "group inline-flex items-center gap-2 h-10 pl-4 pr-5 rounded-full",
                  "bg-warn text-[oklch(20%_0.05_75)] font-display font-semibold text-[13px]",
                  "hover:brightness-95 transition-all duration-160 shadow-xs",
                )}
              >
                <span className="font-mono">/ctx list</span>
                <ArrowRight size={14} className="transition-transform duration-160 group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => onTypeCommand("/ctx pin k8s ")}
                className={cn(
                  "inline-flex items-center gap-2 h-10 px-4 rounded-full",
                  "bg-white/70 border border-warn/40 text-[oklch(32%_0.10_75)] font-display font-semibold text-[13px]",
                  "hover:bg-white transition-colors duration-160",
                )}
              >
                <span className="font-mono">/ctx pin k8s</span>
                <span className="font-mono text-[oklch(60%_0.08_75)]">{"<name>"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
