import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@server/router";
import type { inferRouterOutputs } from "@trpc/server";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } },
});

export const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({ client, queryClient });

export type Outputs = inferRouterOutputs<AppRouter>;
export type Suggestion = Outputs["suggestions"]["pending"][number];
export type Chapter = Outputs["chapters"]["get"];
export type Project = Outputs["projects"]["get"];
export type Character = Outputs["characters"]["get"];
