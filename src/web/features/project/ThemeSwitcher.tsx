import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryClient, trpc, type Project } from "@/lib/trpc";
import { getTheme } from "@/lib/themes";
import type { StoryFormat } from "@shared/doc";
import { ThemePicker } from "./ThemePicker";

export function ThemeSwitcher({ project }: { project: Project }) {
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
    <ThemePicker
      format={format}
      value={current.id}
      onChange={(theme) => theme !== current.id && update.mutate({ id: project.id, theme })}
    />
  );
}
