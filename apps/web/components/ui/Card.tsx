import { cn } from "@/lib/cn";

type RailKind =
  | "user" | "ok" | "error" | "write" | "danger"
  | "pending" | "streaming" | "llm" | "rejected";

const RAIL_BG: Record<RailKind, string> = {
  user:      "bg-text-muted",
  ok:        "bg-ok",
  error:     "bg-danger",
  write:     "bg-write",
  danger:    "bg-danger",
  pending:   "bg-pending",
  streaming: "bg-ok",           // pulses via keyframes when streaming=true
  llm:       "bg-llm",
  rejected:  "bg-text-muted",
};

interface CardProps {
  rail: RailKind;
  children: React.ReactNode;
  className?: string;
  /** when true, add a top danger stripe (4px) — for ApprovalCard danger variant */
  danger?: boolean;
  /** attaches the card to the card directly above with no outer margin */
  attached?: boolean;
}

export function Card({ rail, children, className, danger, attached }: CardProps) {
  return (
    <div
      className={cn(
        "relative bg-surface border border-border-subtle rounded-md overflow-hidden",
        attached && "rounded-t-none border-t-0",
        className
      )}
    >
      {danger && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-danger" aria-hidden />
      )}
      <div
        className={cn("absolute top-0 bottom-0 left-0 w-0.5", RAIL_BG[rail])}
        aria-hidden
      />
      <div className={cn("pl-3", danger && "pt-1")}>{children}</div>
    </div>
  );
}

/** Git-log-style metadata header that sits above a card body. */
export function CardMeta({
  hash,
  ts,
  user,
  profile,
}: {
  hash?: string;
  ts?: string | number | Date;
  user?: string;
  profile?: string | null;
}) {
  const ts_fmt = ts ? formatTs(ts) : "";
  return (
    <div className="h-6 px-5 flex items-center gap-2 text-caption text-text-muted font-mono tabular">
      {hash && <span>{hash.slice(0, 7)}</span>}
      {ts_fmt && <><span className="text-border">·</span><span>{ts_fmt}</span></>}
      {user && <><span className="text-border">·</span><span>{user}</span></>}
      {profile && <><span className="text-border">·</span><span>{profile}</span></>}
    </div>
  );
}

function formatTs(ts: string | number | Date) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
