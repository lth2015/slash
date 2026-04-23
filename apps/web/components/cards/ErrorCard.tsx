"use client";

import { useState } from "react";
import { AlertCircle, ChevronRight, Terminal } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

export interface ErrorPayload {
  code: string;
  message: string;
  hint?: string;
  stderr_excerpt?: string | null;
  skill_id?: string | null;
  /** Suggested commands the user might run to recover. Each is a parse-ready
   *  slash string — clicking fills the CommandBar, never auto-runs. */
  suggestions?: string[];
}

/**
 * Three-panel structured error — WHAT / WHY / HOW.
 * Replaces the earlier code+message+stderr layout so the reader can scan
 * each facet independently: the terminal symbol (code), the human
 * explanation (message+hint), and an actionable next step (suggestions
 * or raw stderr toggle). Props unchanged — `suggestions` is additive.
 */
export function ErrorCard({
  error,
  onSuggestionClick,
}: {
  error: ErrorPayload;
  attached?: boolean;
  onSuggestionClick?: (cmd: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const recovery = recoveryFor(error);

  return (
    <Card rail="error">
      <div className="p-5 space-y-4">
        <header className="flex items-center gap-2 flex-wrap">
          <AlertCircle size={18} className="text-danger" />
          <span className="display-lg text-text-primary">{error.code}</span>
          {error.skill_id && (
            <span className="text-small text-text-muted font-mono">· {error.skill_id}</span>
          )}
        </header>

        <Section label="what">
          <p className="text-body text-text-primary leading-relaxed break-words">
            {recovery.title}
          </p>
        </Section>

        <Section label="why">
          <p className="text-body text-text-primary leading-relaxed break-words">
            {error.message}
          </p>
          {error.hint && (
            <p className="text-small text-text-secondary leading-relaxed break-words">
              {error.hint}
            </p>
          )}
        </Section>

        <Section label="how">
          {recovery.tips.length > 0 && (
            <ul className="text-small text-text-secondary space-y-1.5">
              {recovery.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <ChevronRight size={13} className="mt-0.5 text-text-muted shrink-0" aria-hidden />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          )}
          {(error.suggestions ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {(error.suggestions ?? []).slice(0, 4).map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => onSuggestionClick?.(cmd)}
                  disabled={!onSuggestionClick}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full",
                    "text-small font-mono bg-surface-sub border border-border-subtle",
                    "text-text-secondary hover:text-text-primary hover:border-border transition-colors duration-80",
                    "disabled:cursor-default",
                  )}
                  title="fill the command bar (does NOT auto-run)"
                >
                  <Terminal size={11} className="text-text-muted" aria-hidden />
                  {cmd}
                </button>
              ))}
            </div>
          )}
          {error.stderr_excerpt && (
            <div className="pt-1">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="kicker text-text-muted hover:text-text-secondary"
              >
                {showRaw ? "hide raw stderr" : "show raw stderr"}
              </button>
              {showRaw && (
                <pre className="mt-2 bg-surface-sub border border-border-subtle rounded-lg p-3 text-[12.5px] font-mono text-text-secondary whitespace-pre-wrap max-h-48 overflow-auto">
                  {error.stderr_excerpt}
                </pre>
              )}
            </div>
          )}
          {recovery.tips.length === 0 &&
            (error.suggestions ?? []).length === 0 &&
            !error.stderr_excerpt && (
              <p className="text-small text-text-muted italic">no automatic recovery available · re-check the command and try again</p>
            )}
        </Section>
      </div>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="kicker text-text-muted">{label}</div>
      {children}
    </div>
  );
}

/**
 * Light canned knowledge for common codes — keeps WHY narrow (just echo the
 * server `message`) and HOW actionable (2-3 bullets). Purely client-side,
 * no LLM involved; the server can still override via `error.hint`.
 */
function recoveryFor(e: ErrorPayload): { title: string; tips: string[] } {
  const code = e.code || "Error";
  switch (code) {
    case "MissingContext":
      return {
        title: "No cluster / cloud context is pinned for this command.",
        tips: [
          "Pin a context, e.g. `/ctx pin k8s prod` or `/ctx pin aws default`.",
          "Or override for one command with `--ctx <name>` / `--profile <name>`.",
        ],
      };
    case "PreflightFailed":
      return {
        title: "The skill's pre-execution check failed — the runtime refused to apply.",
        tips: [
          "Inspect the resource referenced in the error to confirm it exists and is in the expected state.",
          "If the resource was deleted since the plan was staged, cancel this plan and re-issue the command.",
        ],
      };
    case "DangerConfirmRequired":
      return {
        title: "This is a danger-level skill — type the environment name to unlock the Approve button.",
        tips: ["The card's input box expects the resolved profile name verbatim."],
      };
    case "ForbiddenActor":
      return {
        title: "The approval endpoint rejected this call.",
        tips: ["Approval requires an X-Slash-Actor: human-* header; the LLM must never call it."],
      };
    case "NotFound":
      return {
        title: "The plan this call referenced is gone (decided or expired).",
        tips: [
          "Each plan can be decided at most once — resubmit the original command to get a fresh plan.",
        ],
      };
    case "AlreadyDecided":
      return {
        title: "This plan has already been decided.",
        tips: ["Resubmit the original command if you want a fresh plan."],
      };
    case "ParseError":
    case "InvalidToken":
    case "UnknownNamespace":
    case "UnknownCommand":
    case "UnknownFlag":
    case "Validation":
    case "DuplicateFlag":
    case "MissingTarget":
      return {
        title: "Slash only accepts strict DSL — the input didn't match the grammar.",
        tips: [
          "Check the reported column; the CommandBar highlights the offending span.",
          "See docs/02-commands.md for the namespaces and allowed forms.",
        ],
      };
    case "Timeout":
      return {
        title: "The subprocess ran longer than the skill's declared timeout.",
        tips: [
          "Raise the window with `--timeout <duration>` if the skill allows it.",
          "Large result sets: narrow with `--ns` / `--region` filters.",
        ],
      };
    case "ExecutionError":
      return {
        title: "The subprocess exited with a non-zero code.",
        tips: ["See the raw stderr below for the terminal's explanation."],
      };
    case "OutputParseError":
      return {
        title: "The skill ran, but its stdout didn't match the shape the manifest declared.",
        tips: [
          "This usually indicates a CLI version mismatch. See the raw stderr below.",
        ],
      };
    case "Rejected":
      return {
        title: "Plan was rejected. No command was executed.",
        tips: ["Re-issue the command when you're ready to approve; rejected plans can't be resurrected."],
      };
    case "NetworkError":
      return {
        title: "The browser couldn't reach the local API.",
        tips: [
          "Check that `make dev` is running and the API is on :4456.",
          "If you restarted the API, reload this page so the client reconnects.",
        ],
      };
    default:
      return {
        title: e.hint ? e.hint : `${code}: ${e.message.split(".")[0]}.`,
        tips: [],
      };
  }
}
