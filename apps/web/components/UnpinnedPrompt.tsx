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
    <div className="relative z-10 flex justify-center pt-5 pb-0 pointer-events-none">
      <div
        className={cn(
          "pointer-events-auto w-[min(480px,92%)]",
          "bg-[oklch(91%_0.12_80)] border border-[oklch(72%_0.14_75)] rounded-xl",
          "shadow-md animate-pop-in",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <PinOff
            size={16}
            strokeWidth={2.4}
            className="shrink-0 text-[oklch(30%_0.12_70)]"
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-[14px] text-[oklch(22%_0.08_75)] tracking-tight leading-none">
              No context pinned.
            </h3>
            <p className="mt-0.5 text-[12px] text-[oklch(34%_0.06_75)] leading-tight">
              Pin one to run anything.
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onTypeCommand("/ctx list")}
              className={cn(
                "group inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-full",
                "bg-[oklch(58%_0.19_70)] text-white font-mono font-semibold text-[11px]",
                "hover:brightness-95 transition-all duration-160",
              )}
            >
              /ctx list
              <ArrowRight size={11} className="transition-transform duration-160 group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={() => onTypeCommand("/ctx pin k8s ")}
              className={cn(
                "inline-flex items-center h-7 px-2.5 rounded-full",
                "bg-white border border-[oklch(72%_0.14_75)] text-[oklch(26%_0.10_75)]",
                "font-mono font-semibold text-[11px]",
                "hover:bg-[oklch(98%_0.04_75)] transition-colors duration-160",
              )}
            >
              pin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
