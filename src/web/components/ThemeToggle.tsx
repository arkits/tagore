import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** One-click switch between daylight and lamplight sepia. (System-follow lives in Settings.) */
export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => setTheme(next)}
          className="relative size-8 rounded-full grid place-items-center text-ink-soft hover:bg-accent hover:text-ink transition-colors"
          aria-label={`Switch to ${next} theme`}
        >
          <Sun className="size-4 absolute transition-all duration-500 rotate-0 scale-100 dark:-rotate-90 dark:scale-0" />
          <Moon className="size-4 absolute transition-all duration-500 rotate-90 scale-0 dark:rotate-0 dark:scale-100" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{resolved === "dark" ? "Daylight" : "Lamplight"}</TooltipContent>
    </Tooltip>
  );
}
