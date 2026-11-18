import { Check, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeOp, plainText } from "@shared/doc";
import type { EditorSuggestion } from "../editor/suggestions";
import { cn } from "@/lib/utils";

export function ChangesPanel({
  list,
  stale,
  active,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onFocus,
}: {
  list: EditorSuggestion[];
  stale: Set<string>;
  active: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onFocus: (id: string) => void;
}) {
  if (!list.length)
    return (
      <div className="p-8 text-center font-book italic text-muted-foreground">No pending suggestions. The manuscript is all yours.</div>
    );
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <span className="text-sm">
          {list.length} pending
          {stale.size ? <span className="text-muted-foreground"> · {stale.size} outdated</span> : null}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onRejectAll}>
          <X className="size-3.5" /> Reject all
        </Button>
        <Button size="sm" onClick={onAcceptAll}>
          <CheckCheck className="size-3.5" /> Accept all
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-2">
        {list.map((s) => {
          const preview =
            s.op.op === "insert_after" || s.op.op === "replace_block"
              ? s.op.blocks.map((b) => plainText(b.text)).join(" ").slice(0, 220)
              : s.op.op === "replace_text"
                ? null
                : null;
          return (
            <div
              key={s.id}
              onClick={() => onFocus(s.id)}
              className={cn(
                "group rounded-md border bg-popover/60 px-3 py-2.5 cursor-pointer hover:border-ring/60 transition-colors",
                active === s.id && "border-ring ring-1 ring-ring/30",
                stale.has(s.id) && "opacity-55",
              )}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium">{describeOp(s.op)}</div>
                  {s.note && <div className="text-xs text-muted-foreground mt-0.5">{s.note}</div>}
                  {stale.has(s.id) && <div className="text-xs text-destructive mt-0.5">The text it targets has changed.</div>}
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <button
                    title="Accept"
                    disabled={stale.has(s.id)}
                    onClick={(e) => (e.stopPropagation(), onAccept(s.id))}
                    className="size-7 rounded-full grid place-items-center hover:bg-sage/15 text-sage disabled:opacity-30"
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    title="Reject"
                    onClick={(e) => (e.stopPropagation(), onReject(s.id))}
                    className="size-7 rounded-full grid place-items-center hover:bg-oxblood/10 text-oxblood"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              {preview && <p className="mt-1.5 font-book text-[14px] text-ink-soft line-clamp-3 leading-snug">{preview}</p>}
              {s.op.op === "replace_text" && (
                <p className="mt-1.5 font-book text-[14px] leading-snug">
                  <span className="sg-del">{s.op.find}</span> <span className="sg-ins">{plainText(s.op.replace)}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
