import "./index.css";
import "./themes.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import { queryClient } from "./lib/trpc";
import { TooltipProvider } from "./components/ui/tooltip";
import { Library } from "./features/library/Library";
import { Workspace } from "./features/workspace/Workspace";
import { useTheme } from "./lib/theme";

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-left"
      toastOptions={{ style: { background: "var(--popover)", color: "var(--ink)", border: "1px solid var(--rule)", fontFamily: "var(--font-sans)" } }}
    />
  );
}

function App() {
  return (
    <Switch>
      <Route path="/">
        <Library />
      </Route>
      <Route path="/p/:projectId/characters">{(p) => <Workspace projectId={p.projectId} characters />}</Route>
      <Route path="/p/:projectId/:chapterId?">{(p) => <Workspace projectId={p.projectId} chapterId={p.chapterId} />}</Route>
      <Route>
        <Library />
      </Route>
    </Switch>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <App />
        <ThemedToaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
