"use client";

import { useCallback, useState } from "react";

import { CommandBar } from "@/components/CommandBar";
import { ContextBar } from "@/components/ContextBar";
import { Conversation, Turn } from "@/components/Conversation";
import type { ErrorPayload } from "@/components/cards/ErrorCard";
import type { LlmSummary } from "@/components/cards/LlmSummaryCard";
import type { ResultPayload } from "@/components/cards/ResultCard";

export default function Home() {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  const handleSuggestion = useCallback((cmd: string) => setText(cmd), []);

  const submit = useCallback(async (command: string) => {
    // Clear input for next turn
    setText("");

    try {
      const r = await fetch("/api/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: command }),
      });
      const body = await r.json();

      if (!r.ok) {
        const d = body?.detail ?? {};
        const err: ErrorPayload = {
          code: d.code ?? "Error",
          message: d.message ?? `HTTP ${r.status}`,
        };
        setTurns((t) => [...t, { kind: "error", command, error: err }]);
        return;
      }

      if (body.state === "awaiting_approval") {
        setTurns((t) => [
          ...t,
          {
            kind: "write",
            command,
            stage: "waiting",
            plan: {
              run_id: body.run_id,
              command,
              skill_id: body.skill_id,
              danger: body.danger,
              before: body.before,
              after: body.after,
              rollback_hint: null,
              reason: null,
              drift: body.drift ?? null,
            },
          },
        ]);
        return;
      }

      if (body.state === "ok") {
        const result: ResultPayload = {
          run_id: body.run_id,
          skill_id: body.skill_id,
          mode: body.mode,
          state: "ok",
          outputs: body.outputs,
          stdout_excerpt: body.stdout_excerpt,
          duration_ms: body.duration_ms,
          output_spec: body.output_spec,
          ts: new Date().toISOString(),
        };
        setTurns((t) => [...t, { kind: "read", command, result }]);
        // fire LLM in background (only when toggle is on; server also checks)
        void maybeExplain(command, body).then((llm) => {
          if (!llm) return;
          setTurns((list) => list.map((it, idx) => (
            idx === list.length - 1 && it.kind === "read" ? { ...it, llm } : it
          )));
        });
        return;
      }

      // error state returned 200
      setTurns((t) => [
        ...t,
        {
          kind: "error",
          command,
          error: {
            code: body.error_code ?? "Error",
            message: body.error_message ?? "unknown",
            stderr_excerpt: body.stderr_excerpt,
            skill_id: body.skill_id,
          },
        },
      ]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        {
          kind: "error",
          command,
          error: { code: "NetworkError", message: String(e instanceof Error ? e.message : e) },
        },
      ]);
    }
  }, []);

  const onApproved = useCallback((runId: string, payload: unknown) => {
    const p = payload as {
      state: string;
      exit_code?: number | null;
      duration_ms?: number | null;
      outputs?: unknown;
      stdout_excerpt?: string | null;
      stderr_excerpt?: string | null;
      error_code?: string | null;
      error_message?: string | null;
      output_spec?: ResultPayload["output_spec"];
      rollback_command?: string | null;
    };
    setTurns((list) =>
      list.map((t) => {
        if (t.kind !== "write" || t.plan.run_id !== runId) return t;
        if (p.state === "ok") {
          return {
            ...t,
            stage: "done",
            result: {
              run_id: runId,
              skill_id: t.plan.skill_id,
              mode: "write",
              state: "ok",
              outputs: p.outputs ?? {},
              stdout_excerpt: p.stdout_excerpt ?? null,
              duration_ms: p.duration_ms ?? null,
              output_spec: p.output_spec ?? null,
              ts: new Date().toISOString(),
              rollback_command: p.rollback_command || null,
            },
          };
        }
        return {
          ...t,
          stage: "rejected",
          rejection_reason: p.error_message ?? undefined,
        };
      })
    );
  }, []);

  const onRejected = useCallback((runId: string) => {
    setTurns((list) =>
      list.map((t) =>
        t.kind === "write" && t.plan.run_id === runId ? { ...t, stage: "rejected" } : t
      )
    );
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <ContextBar />
      <Conversation
        turns={turns}
        onApproved={onApproved}
        onRejected={onRejected}
        onSuggestionClick={handleSuggestion}
      />
      <CommandBar value={text} onValueChange={setText} onSubmit={submit} />
    </div>
  );
}

async function maybeExplain(command: string, body: {
  skill_id: string;
  mode: string;
  danger: boolean;
  state: string;
  outputs: unknown;
  stdout_excerpt?: string | null;
}): Promise<LlmSummary | null> {
  try {
    const r = await fetch("/api/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command,
        skill_id: body.skill_id,
        skill_mode: body.mode,
        skill_danger: body.danger,
        result_state: body.state,
        result_outputs: body.outputs,
        stdout_excerpt: body.stdout_excerpt ?? "",
      }),
    });
    if (!r.ok) return null;
    const out = await r.json();
    if (!out.available) return null;
    return {
      model: out.model,
      summary: out.summary,
      highlights: out.highlights,
      findings: out.findings,
      suggested_commands: out.suggested_commands,
      divergence_warnings: out.divergence_warnings,
    };
  } catch {
    return null;
  }
}
