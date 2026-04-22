import { ChevronRightSquare } from "lucide-react";

import { Card } from "@/components/ui/Card";

export function UserCommandRow({ text }: { text: string }) {
  return (
    <Card rail="user">
      <div className="h-7 flex items-center gap-2 px-4 text-mono-body font-mono">
        <ChevronRightSquare size={13} className="text-text-muted" />
        <span className="text-text-primary truncate">{text}</span>
      </div>
    </Card>
  );
}
