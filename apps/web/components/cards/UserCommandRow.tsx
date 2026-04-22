export function UserCommandRow({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] rounded-xl rounded-br-sm bg-brand-tint border border-brand-soft px-4 py-2.5 shadow-xs">
        <div className="kicker text-brand/80 mb-0.5">you ran</div>
        <code className="block font-mono text-[14px] text-text-primary leading-snug break-words">
          {text}
        </code>
      </div>
    </div>
  );
}
