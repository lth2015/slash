import { Terminal } from "lucide-react";

export function EmptyOutput() {
  const examples = [
    "/infra aws vm list --region us-east-1",
    "/cluster kind-sre list pod --ns api",
    "/ops audit logs --since 1d",
  ];
  return (
    <div className="flex-1 grid place-items-center">
      <div className="max-w-md text-center">
        <Terminal size={28} className="mx-auto text-text-muted" />
        <h2 className="mt-4 text-base font-medium text-text-primary">No runs yet.</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Slash is a strict command language — no natural-language input.
          Examples you&apos;ll be able to run in <span className="font-mono">M1</span>:
        </p>
        <ul className="mt-4 space-y-1 text-left">
          {examples.map((cmd) => (
            <li
              key={cmd}
              className="font-mono text-[13px] text-text-secondary px-3 py-1.5 rounded border border-border-subtle bg-elevated"
            >
              {cmd}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
