import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc, type Project } from "@/lib/trpc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getTheme } from "@/lib/themes";
import type { StoryFormat } from "@shared/doc";
import { ThemePicker } from "./ThemePicker";

/** Header control: change this story's theme any time; the workspace re-skins immediately. */
export function ThemeSwitcher({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const format: StoryFormat = project.format === "chat" ? "chat" : "prose";
  const current = getTheme(project.theme, format);
  const key = trpc.projects.get.queryKey(project.id);

  const update = useMutation(
    trpc.projects.update.mutationOptions({
      onMutate: ({ theme }) => {
        const prev = queryClient.getQueryData<Project>(key);
        if (prev && theme) queryClient.setQueryData<Project>(key, { ...prev, theme });
        return { prev };
      },
      onError: (e, _v, ctx) => {
        if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
        toast.error(`Couldn't change theme: ${e.message}`);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: key });
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
      },
    }),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 rounded-full border bg-popover/70 px-3 h-8 text-sm hover:bg-accent transition-colors"
          title="Change this story's theme"
        >
          <Palette className="size-3.5 text-oxblood" />
          <span className="hidden sm:inline">{current.name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(560px,calc(100vw-24px))] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-display text-lg">Theme</h3>
          <span className="text-xs text-muted-foreground">{format === "chat" ? "Chat" : "Book"} themes · changes apply instantly</span>
        </div>
        <ThemePicker format={format} value={current.id} onChange={(theme) => theme !== current.id && update.mutate({ id: project.id, theme })} compact />
        <p className="mt-3 text-xs text-muted-foreground">To switch between Book and Chat, or to set whose screen a chat is on, open the Story bible.</p>
      </PopoverContent>
    </Popover>
  );
}
