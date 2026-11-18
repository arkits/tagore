/**
 * Character Card V2 (chara_card_v2) — the de-facto interchange format used by SillyTavern, Chub, etc.
 * We store the `data` object verbatim so imports/exports round-trip, and read V1 / V3 on import.
 */
export type LoreEntry = {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: "before_char" | "after_char";
};

export type CharacterBook = {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: LoreEntry[];
};

export type CardData = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book?: CharacterBook;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
  /** V3 */
  nickname?: string;
};

export type CardV2 = { spec: "chara_card_v2"; spec_version: "2.0"; data: CardData };

export function emptyCard(name = "New character"): CardData {
  return {
    name,
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "",
    character_version: "1.0",
    extensions: {},
  };
}

/** Normalize anything card-shaped (V1 flat, V2, V3) into CardData. */
export function normalizeCard(raw: any): CardData {
  const src = raw?.data && (raw.spec === "chara_card_v2" || raw.spec === "chara_card_v3") ? raw.data : raw ?? {};
  const base = emptyCard(String(src.name ?? src.char_name ?? "Unnamed"));
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const card: CardData = {
    ...base,
    description: str(src.description ?? src.char_persona),
    personality: str(src.personality),
    scenario: str(src.scenario ?? src.world_scenario),
    first_mes: str(src.first_mes ?? src.char_greeting),
    mes_example: str(src.mes_example ?? src.example_dialogue),
    creator_notes: str(src.creator_notes),
    system_prompt: str(src.system_prompt),
    post_history_instructions: str(src.post_history_instructions),
    alternate_greetings: Array.isArray(src.alternate_greetings) ? src.alternate_greetings.map(String) : [],
    tags: Array.isArray(src.tags) ? src.tags.map(String) : [],
    creator: str(src.creator),
    character_version: str(src.character_version) || "1.0",
    extensions: typeof src.extensions === "object" && src.extensions ? src.extensions : {},
    nickname: str(src.nickname) || undefined,
  };
  if (src.character_book?.entries) {
    card.character_book = {
      ...src.character_book,
      extensions: src.character_book.extensions ?? {},
      entries: src.character_book.entries.map((e: any, i: number) => ({
        keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
        content: str(e.content),
        extensions: e.extensions ?? {},
        enabled: e.enabled !== false,
        insertion_order: Number(e.insertion_order ?? i),
        name: e.name ?? e.comment,
        comment: e.comment,
        constant: !!e.constant,
        case_sensitive: !!e.case_sensitive,
        priority: e.priority,
        id: e.id ?? i,
        selective: e.selective,
        secondary_keys: e.secondary_keys,
        position: e.position,
      })),
    };
  }
  return card;
}

export function toCardV2(data: CardData): CardV2 {
  return { spec: "chara_card_v2", spec_version: "2.0", data };
}

/** Replace SillyTavern-style macros. In a story there is no "user", so {{user}} becomes "the narrator". */
export function expandMacros(s: string, charName: string): string {
  return s.replace(/\{\{char\}\}|<BOT>/gi, charName).replace(/\{\{user\}\}|<USER>/gi, "the narrator");
}
