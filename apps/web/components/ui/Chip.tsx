import { cn } from "@/lib/cn";

type ChipKind =
  | "read" | "write" | "danger" | "await"
  | "ok" | "fail" | "warn" | "rejected" | "llm";

const MAP: Record<ChipKind, string> = {
  read:     "bg-ok/10 border-ok/40 text-ok",
  write:    "bg-write/10 border-write/40 text-write",
  danger:   "bg-danger/10 border-danger/60 text-danger",
  await:    "bg-pending/10 border-pending/40 text-pending",
  ok:       "bg-ok/10 border-ok/40 text-ok",
  fail:     "bg-danger/10 border-danger/40 text-danger",
  warn:     "bg-warn/10 border-warn/40 text-warn",
  rejected: "bg-transparent border-border text-text-muted",
  llm:      "bg-llm/10 border-llm/50 text-llm",
};

export function Chip({ kind, children }: { kind: ChipKind; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-[18px] px-1.5 rounded-sm border text-caption font-mono tracking-chip uppercase",
        MAP[kind]
      )}
    >
      {children}
    </span>
  );
}
