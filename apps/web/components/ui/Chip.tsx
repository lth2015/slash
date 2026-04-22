import { cn } from "@/lib/cn";

type ChipKind =
  | "read" | "write" | "danger" | "await"
  | "ok" | "fail" | "warn" | "rejected" | "llm";

const MAP: Record<ChipKind, string> = {
  read:     "bg-ok-soft text-ok",
  write:    "bg-write-soft text-write",
  danger:   "bg-danger-soft text-danger",
  await:    "bg-pending-soft text-pending",
  ok:       "bg-ok-soft text-ok",
  fail:     "bg-danger-soft text-danger",
  warn:     "bg-warn-soft text-warn",
  rejected: "bg-surface-sub text-text-muted border border-border-subtle",
  llm:      "bg-llm-soft text-llm",
};

export function Chip({ kind, children }: { kind: ChipKind; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-[20px] px-2 rounded-full text-caption font-mono tracking-chip",
        MAP[kind],
      )}
    >
      {children}
    </span>
  );
}
