import { Activity, FileCheck2, GitBranch, Home, ListChecks, Radio } from "lucide-react";

import { cn } from "@/lib/cn";

type Item = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
  active?: boolean;
};

const ITEMS: Item[] = [
  { key: "home", label: "Home", icon: Home, active: true },
  { key: "runs", label: "Runs", icon: Activity },
  { key: "approvals", label: "Approvals", icon: FileCheck2, badge: "0" },
  { key: "skills", label: "Skills", icon: GitBranch },
  { key: "audit", label: "Audit", icon: ListChecks },
  { key: "ops", label: "Ops", icon: Radio },
];

export function Sidebar() {
  return (
    <aside className="w-[240px] shrink-0 border-r border-border-subtle bg-surface flex flex-col">
      <div className="px-4 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-accent-primary/20 border border-accent-primary/40 grid place-items-center text-accent-primary font-mono text-sm">
            /
          </div>
          <span className="font-semibold tracking-tight">Slash</span>
          <span className="ml-auto text-[11px] text-text-muted font-mono">M0</span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {ITEMS.map(({ key, label, icon: Icon, badge, active }) => (
          <button
            key={key}
            disabled={!active}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 text-sm text-left",
              "hover:bg-elevated disabled:opacity-60 disabled:cursor-not-allowed",
              active && "bg-elevated text-text-primary"
            )}
          >
            <Icon size={16} className="text-text-secondary" />
            <span>{label}</span>
            {badge && (
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-border-subtle text-text-secondary">
                {badge}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-border-subtle text-xs text-text-muted">
        demo · local user
      </div>
    </aside>
  );
}
