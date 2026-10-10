/**
 * ── Vendored skill data ───────────────────────────────────────────────────────
 * `slop.json` / `hooks.json` / `rubric.json` are copied verbatim from the
 * upstream skill (MIT). Importing them as modules lets Next.js bundle the data
 * into the serverless function, so the runtime never reads from `scripts/` on
 * disk. See `scripts/linkedin-agent/upstream/` for the canonical copies.
 */
import slopRaw from "./data/slop.json";
import hooksRaw from "./data/hooks.json";
import rubricRaw from "./data/rubric.json";
import type { HookFormula } from "./types";

export interface InvisibleEntry {
  cp: string;
  name: string;
  action: string;
}

export interface TypographicEntry {
  from: string;
  name: string;
  to: string;
}

export interface LexEntry {
  find: string;
  replace: string;
  family: string;
}

export interface StructureEntry {
  id: string;
  regex: string;
  name: string;
  fix: string;
}

export interface Lexicon {
  version: string;
  invisible: InvisibleEntry[];
  typographic: TypographicEntry[];
  words: LexEntry[];
  phrases: LexEntry[];
  structures: StructureEntry[];
}

export interface RubricItem {
  id: string;
  points: number;
  full_marks: string;
}

export interface Rubric {
  version: string;
  total: number;
  items: RubricItem[];
}

const rawLexicon = slopRaw as unknown as Lexicon;

/** The slop lexicon: invisible classes, typographic swaps, words, structures. */
export const lexicon: Lexicon = rawLexicon;

/** The 21 hook formulas from `li-post/hooks.json`. */
export const hookFormulas: HookFormula[] = (hooksRaw as unknown as { hooks: HookFormula[] })
  .hooks;

/** The five rules that sit above the hook list. */
export const hookRules: string[] = (hooksRaw as unknown as { rules: string[] }).rules;

/** The 12-item, 100-point profile rubric. */
export const rubric: Rubric = rubricRaw as unknown as Rubric;
