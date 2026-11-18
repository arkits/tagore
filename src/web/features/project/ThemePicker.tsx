import type { StoryFormat } from "@shared/doc";
import { themesFor, type StoryTheme } from "@/lib/themes";
import { cn } from "@/lib/utils";

/** A miniature of the theme: a page on its desk (books) or a few bubbles (chats). */
function Preview({ t }: { t: StoryTheme }) {
  const { desk, page, ink, accent, display, body } = t.swatch;
  if (t.format === "chat") {
    const square = t.id === "aim" || t.id === "yahoo";
    return (
      <div className="h-28 rounded-[3px] p-2.5 flex flex-col justify-end gap-1 overflow-hidden" style={{ background: desk }}>
        <div className={cn("flex-1 flex flex-col justify-end gap-1 p-1.5", square ? "rounded-none border border-black/30" : "rounded-md")} style={{ background: page }}>
          {square ? (
            <div className="text-[9px] leading-tight" style={{ fontFamily: body, color: ink }}>
              <div>
                <b style={{ color: "#c00" }}>mara1999</b>: u there?
              </div>
              <div>
                <b style={{ color: accent }}>jonah_x</b>: ya
              </div>
              <div>
                <b style={{ color: "#c00" }}>mara1999</b>: brb
              </div>
            </div>
          ) : (
            <>
              <span className="self-start rounded-full px-2 py-0.5 text-[9px]" style={{ background: t.id === "whatsapp" ? "#fff" : "#e9e9eb", color: "#111", fontFamily: body }}>
                you still up?
              </span>
              <span className="self-end rounded-full px-2 py-0.5 text-[9px] text-white" style={{ background: accent, color: t.id === "whatsapp" ? "#111" : "#fff", fontFamily: body, ...(t.id === "whatsapp" ? { background: "#d9fdd3" } : {}) }}>
                it's 2am 🙃
              </span>
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="h-28 rounded-[3px] p-3 flex items-stretch justify-center overflow-hidden" style={{ background: desk }}>
      <div
        className="w-[72%] px-2.5 pt-2 shadow-md overflow-hidden"
        style={{
          background: page,
          border: t.id === "manga" ? "2px solid #111" : t.id === "codex" ? `1px solid ${accent}` : undefined,
          boxShadow: t.id === "codex" ? `0 0 14px ${accent}55` : undefined,
          backgroundImage: t.id === "diary" ? "repeating-linear-gradient(transparent 0 9px,#9ec3ec 9px 10px)" : undefined,
        }}
      >
        <div className="text-[13px] leading-none truncate" style={{ fontFamily: display, color: t.id === "gothic" ? accent : ink }}>
          {t.id === "manga" ? "DOOM!!" : t.id === "codex" ? "ENTRY 01" : t.id === "diary" ? "dear diary" : t.id === "gothic" ? "Liber Primus" : "Chapter One"}
        </div>
        <div className="mt-1.5 text-[8.5px] leading-[1.35]" style={{ fontFamily: body, color: ink, opacity: 0.85 }}>
          The lighthouse had been dark for eleven years when she climbed its stairs.
        </div>
      </div>
    </div>
  );
}

export function ThemePicker({ format, value, onChange, compact }: { format: StoryFormat; value: string; onChange: (id: string) => void; compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
      {themesFor(format).map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={cn(
            "group rounded-[4px] border p-1.5 text-left transition-all hover:-translate-y-0.5",
            value === t.id ? "border-oxblood ring-1 ring-oxblood/40" : "hover:border-ring",
          )}
        >
          <Preview t={t} />
          <div className="px-1 pt-1.5 pb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-medium truncate">{t.name}</span>
              {value === t.id && <span className="ml-auto size-1.5 rounded-full bg-oxblood shrink-0" />}
            </div>
            {!compact && <p className="text-[12px] leading-snug text-muted-foreground mt-0.5 line-clamp-2">{t.tagline}</p>}
          </div>
        </button>
      ))}
    </div>
  );
}
