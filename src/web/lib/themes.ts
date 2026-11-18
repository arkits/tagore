import type { StoryFormat } from "@shared/doc";

/**
 * Story themes. Each one restyles the whole workspace while that story is open (fonts, palette,
 * the page itself, motion). The CSS lives in src/web/themes.css keyed on
 * `html[data-story-theme="<id>"]`; this registry drives pickers, covers and previews.
 */
export type StoryTheme = {
  id: string;
  name: string;
  format: StoryFormat;
  tagline: string;
  /** Respects the app's Daylight/Lamplight toggle (others have one fixed mood). */
  hasDark?: boolean;
  /** For pickers and library covers. */
  swatch: { desk: string; page: string; ink: string; accent: string; display: string; body: string };
  cover: { bg: string; fg: string; font: string; kicker: string };
};

export const THEMES: StoryTheme[] = [
  /* --------------------------------------------------------------- books */
  {
    id: "folio",
    name: "Folio",
    format: "prose",
    tagline: "Sepia paper, Garamond, a drop cap. The quiet default.",
    hasDark: true,
    swatch: { desk: "#e9dfcb", page: "#fbf5e8", ink: "#2a2017", accent: "#8a3b22", display: "'Fraunces Variable', serif", body: "'EB Garamond', serif" },
    cover: { bg: "linear-gradient(160deg,#7a3520,#5a2414)", fg: "#f6e9d4", font: "'Fraunces Variable', serif", kicker: "A novel" },
  },
  {
    id: "manga",
    name: "Manga",
    format: "prose",
    tagline: "Ink-black panels, screentone, speech balloons and SFX.",
    swatch: { desk: "#e8e8e8", page: "#ffffff", ink: "#111111", accent: "#e60012", display: "'Bangers', sans-serif", body: "'Comic Neue', sans-serif" },
    cover: { bg: "radial-gradient(circle,rgba(255,255,255,.22) 1.2px,transparent 1.6px) 0 0/8px 8px,linear-gradient(160deg,#ff1a2d,#b8000e)", fg: "#fff", font: "'Bangers', sans-serif", kicker: "第一巻" },
  },
  {
    id: "gothic",
    name: "Gothic",
    format: "prose",
    tagline: "Candlelit vellum, blackletter rubrics, an illuminated initial.",
    swatch: { desk: "#120c08", page: "#e6d5ae", ink: "#2a1a10", accent: "#8b1a1a", display: "'UnifrakturMaguntia', serif", body: "'IM Fell English', serif" },
    cover: { bg: "linear-gradient(160deg,#2a1610,#0e0806)", fg: "#d9b45f", font: "'UnifrakturMaguntia', serif", kicker: "Liber" },
  },
  {
    id: "diary",
    name: "Diary",
    format: "prose",
    tagline: "Ruled notebook, blue ink handwriting, tape and a coffee ring.",
    swatch: { desk: "#8a5a36", page: "#fdfbf3", ink: "#1f3a8a", accent: "#d9455f", display: "'Kalam', cursive", body: "'Caveat Variable', cursive" },
    cover: { bg: "linear-gradient(160deg,#d9455f,#b8324a)", fg: "#fff6e8", font: "'Kalam', cursive", kicker: "dear diary" },
  },
  {
    id: "codex",
    name: "Holo Codex",
    format: "prose",
    tagline: "A glass data-slate in deep space. Scanlines, glow, shimmer.",
    swatch: { desk: "#05060f", page: "rgba(20,40,80,.6)", ink: "#d6f4ff", accent: "#ff3fd8", display: "'Orbitron Variable', sans-serif", body: "'Exo 2 Variable', sans-serif" },
    cover: { bg: "linear-gradient(135deg,#0a1030,#1b0b3a 60%,#04202e)", fg: "#7ef9ff", font: "'Orbitron Variable', sans-serif", kicker: "CODEX // 01" },
  },
  /* --------------------------------------------------------------- chats */
  {
    id: "imessage",
    name: "iMessage",
    format: "chat",
    tagline: "Blue and grey bubbles, tails, “Delivered”.",
    hasDark: true,
    swatch: { desk: "#f2f2f7", page: "#ffffff", ink: "#000000", accent: "#0a84ff", display: "-apple-system, 'Helvetica Neue', sans-serif", body: "-apple-system, 'Helvetica Neue', sans-serif" },
    cover: { bg: "linear-gradient(180deg,#5ac8fa,#0a84ff)", fg: "#fff", font: "-apple-system, 'Helvetica Neue', sans-serif", kicker: "Messages" },
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    format: "chat",
    tagline: "Doodle wallpaper, green bubbles, blue ticks.",
    hasDark: true,
    swatch: { desk: "#d1d7db", page: "#efeae2", ink: "#111b21", accent: "#00a884", display: "'Helvetica Neue', sans-serif", body: "'Helvetica Neue', sans-serif" },
    cover: { bg: "linear-gradient(180deg,#25d366,#008069)", fg: "#fff", font: "'Helvetica Neue', sans-serif", kicker: "Chat" },
  },
  {
    id: "aim",
    name: "AIM",
    format: "chat",
    tagline: "1999. Teal desktop, bevelled window, red and blue screen names.",
    swatch: { desk: "#008080", page: "#c0c0c0", ink: "#000000", accent: "#000080", display: "Tahoma, Verdana, sans-serif", body: "Arial, sans-serif" },
    cover: { bg: "linear-gradient(180deg,#000080,#1084d0)", fg: "#ffde00", font: "Tahoma, Verdana, sans-serif", kicker: "Instant Message" },
  },
  {
    id: "yahoo",
    name: "Yahoo! Messenger",
    format: "chat",
    tagline: "Purple chrome, a yellow smiley, and the BUZZ!!!",
    swatch: { desk: "#b9a3e8", page: "#ffffff", ink: "#222222", accent: "#5f01d1", display: "Verdana, sans-serif", body: "Verdana, sans-serif" },
    cover: { bg: "linear-gradient(160deg,#7b0099,#400090)", fg: "#ffd400", font: "Verdana, sans-serif", kicker: "Y! Messenger" },
  },
  {
    id: "skype",
    name: "Skype Classic",
    format: "chat",
    tagline: "Sky gradient, cloud-white panes, status dots, 2011.",
    swatch: { desk: "#bfe8fb", page: "#ffffff", ink: "#333333", accent: "#00aff0", display: "'Segoe UI', 'Helvetica Neue', sans-serif", body: "'Segoe UI', 'Helvetica Neue', sans-serif" },
    cover: { bg: "linear-gradient(180deg,#5fd0fb,#00aff0)", fg: "#fff", font: "'Segoe UI', 'Helvetica Neue', sans-serif", kicker: "Conversation" },
  },
];

export const DEFAULT_THEME: Record<StoryFormat, string> = { prose: "folio", chat: "imessage" };

export function getTheme(id: string | undefined | null, format: StoryFormat = "prose"): StoryTheme {
  const t = THEMES.find((x) => x.id === id);
  if (t && t.format === format) return t;
  return THEMES.find((x) => x.id === DEFAULT_THEME[format])!;
}

export function themesFor(format: StoryFormat) {
  return THEMES.filter((t) => t.format === format);
}

/** Stable hue per speaker name (group-chat name colours, avatar tints). */
export function speakerHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}
