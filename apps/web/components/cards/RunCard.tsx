import { Card } from "@/components/ui/Card";

export function RunCard({ streaming, message }: { streaming?: boolean; message?: string }) {
  return (
    <Card rail={streaming ? "streaming" : "ok"} attached>
      <div className="px-4 h-8 flex items-center gap-3 text-small font-mono">
        {streaming ? (
          <>
            <Dot />
            <span className="text-text-secondary">running… </span>
            <div className="flex-1 h-[2px] bg-border-subtle overflow-hidden">
              <div className="h-full w-1/3 bg-pending animate-stream-sweep" />
            </div>
          </>
        ) : (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" aria-hidden />
            <span className="text-text-secondary">{message ?? "done"}</span>
          </>
        )}
      </div>
    </Card>
  );
}

function Dot() {
  return (
    <span className="relative inline-block w-1.5 h-1.5" aria-hidden>
      <span className="absolute inset-0 rounded-full bg-pending" />
    </span>
  );
}
