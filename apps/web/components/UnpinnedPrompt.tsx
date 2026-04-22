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
          "pointer-events-auto w-[min(760px,94%)]",
          // Amber card bumped up in saturation so text sits on a clearly
          // non-transparent field — readable first, atmospheric second.
          "bg-[oklch(91%_0.12_80)] border-2 border-[oklch(72%_0.14_75)] rounded-2xl",
          "shadow-lg",
          "animate-pop-in",
        )}
      >
        <div className="flex items-start gap-5 p-6">
          <div
            className={cn(
              "shrink-0 w-14 h-14 rounded-xl flex items-center justify-center",
              "bg-[oklch(82%_0.15_75)] border-2 border-[oklch(65%_0.16_70)]",
            )}
            aria-hidden
          >
            <PinOff size={24} strokeWidth={2.2} className="text-[oklch(30%_0.12_70)]" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-[22px] text-[oklch(22%_0.08_75)] tracking-tight leading-tight">
              No contexts pinned.
            </h3>
            <p className="mt-1 font-display text-[15px] text-[oklch(32%_0.08_75)]">
              Every cluster / cloud command needs a target.
            </p>
            <p className="mt-2.5 text-[15px] text-[oklch(32%_0.06_75)] leading-relaxed">
              Pin once per session — every command after inherits the pinned
              context. Use <span className="font-mono text-[oklch(26%_0.10_75)] font-semibold">/ctx list</span> to see what's available on this machine.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onTypeCommand("/ctx list")}
                className={cn(
                  "group inline-flex items-center gap-2 h-11 pl-4 pr-5 rounded-full",
                  "bg-[oklch(58%_0.19_70)] text-white font-display font-semibold text-[15px]",
                  "hover:brightness-95 transition-all duration-160 shadow-sm",
                )}
              >
                <span className="font-mono">/ctx list</span>
                <ArrowRight size={16} className="transition-transform duration-160 group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => onTypeCommand("/ctx pin k8s ")}
                className={cn(
                  "inline-flex items-center gap-2 h-11 px-4 rounded-full",
                  "bg-white border-2 border-[oklch(72%_0.14_75)] text-[oklch(26%_0.10_75)] font-display font-semibold text-[15px]",
                  "hover:bg-[oklch(98%_0.04_75)] transition-colors duration-160",
                )}
              >
                <span className="font-mono">/ctx pin k8s</span>
                <span className="font-mono text-[oklch(55%_0.08_75)]">{"<name>"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
