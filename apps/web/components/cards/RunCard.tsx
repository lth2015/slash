import { Card } from "@/components/ui/Card";

export function RunCard({ streaming, message }: { streaming?: boolean; message?: string }) {
  return (
    <Card rail={streaming ? "streaming" : "ok"}>
      <div className="px-5 h-10 flex items-center gap-3 text-small font-mono">
        {streaming ? (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand animate-pulse" aria-hidden />
            <span className="text-text-secondary">running…</span>
            <div className="flex-1 h-[2px] bg-border-subtle overflow-hidden rounded-full">
              <div className="h-full w-1/3 bg-brand animate-stream-sweep" />
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
