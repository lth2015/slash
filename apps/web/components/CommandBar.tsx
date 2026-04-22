"use client";

import { useState } from "react";

type ParseState =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "result"; ok: boolean; message: string; see?: string }
  | { kind: "error"; message: string };

export function CommandBar() {
  const [text, setText] = useState("/infra aws vm list --region us-east-1");
  const [state, setState] = useState<ParseState>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "parsing" });
    try {
      const r = await fetch("/api/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`api returned ${r.status}`);
      const body = await r.json();
      setState({
        kind: "result",
        ok: !!body.ok,
        message: body.message ?? "",
        see: body.see,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="border-b border-border-subtle bg-surface">
      <form onSubmit={onSubmit} className="px-6 py-4 flex items-center gap-3">
        <span className="text-text-muted font-mono text-sm select-none">&gt;</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Type a command, e.g. /infra aws vm list --region us-east-1"
          className="flex-1 bg-transparent outline-none border-none font-mono text-[14px] placeholder:text-text-muted"
        />
        <kbd className="text-[11px] text-text-muted font-mono px-1.5 py-0.5 rounded border border-border-subtle">
          Enter
        </kbd>
      </form>
      <StatusLine state={state} />
    </div>
  );
}

function StatusLine({ state }: { state: ParseState }) {
  if (state.kind === "idle")
    return (
      <div className="px-6 pb-3 text-xs text-text-muted">
        Parser lands in <span className="font-mono">M1</span>. This box currently round-trips to{" "}
        <span className="font-mono">POST /api/parse</span> and reports the stub response.
      </div>
    );
  if (state.kind === "parsing")
    return <div className="px-6 pb-3 text-xs text-text-secondary">parsing…</div>;
  if (state.kind === "error")
    return (
      <div className="px-6 pb-3 text-xs text-accent-danger">
        network error: {state.message}
      </div>
    );
  const cls = state.ok ? "text-accent-ok" : "text-accent-warn";
  return (
    <div className={`px-6 pb-3 text-xs font-mono ${cls}`}>
      {state.ok ? "● parsed" : "○ "}
      {state.message}
      {state.see && <span className="text-text-muted"> · see {state.see}</span>}
    </div>
  );
}
