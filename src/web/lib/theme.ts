import { useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "tagore.theme";
const listeners = new Set<() => void>();
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

let pref: ThemePref = read();

export function resolvedTheme(p: ThemePref = pref): "light" | "dark" {
  return p === "system" ? (media?.matches ? "dark" : "light") : p;
}

function apply(animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-transition");
    setTimeout(() => root.classList.remove("theme-transition"), 400);
  }
  root.classList.toggle("dark", resolvedTheme() === "dark");
  listeners.forEach((l) => l());
}

media?.addEventListener("change", () => pref === "system" && apply(true));

export function setTheme(p: ThemePref) {
  pref = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {}
  apply(true);
}

export function useTheme() {
  const value = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => `${pref}:${resolvedTheme()}`,
  );
  const [p, resolved] = value.split(":") as [ThemePref, "light" | "dark"];
  return { pref: p, resolved, setTheme };
}
