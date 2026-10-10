/**
 * ── LinkedIn agent skill — shared types ───────────────────────────────────────
 * Ported from Jakeschincariol/linkedin-agent-skill (MIT). The upstream skill is
 * a set of Claude prompt files plus two Python tools (humanize.py / detect.py).
 * This library is a dependency-free TypeScript port of the deterministic half of
 * that pack, so the same checks run inside the Next.js runtime.
 */

/** One hit from the `pass_invisible` phase. */
export interface InvisibleHit {
  name: string;
  count: number;
  action: string;
}

/** One hit from the `pass_typographic` phase. */
export interface TypographicHit {
  name: string;
  count: number;
  to: string;
}

/** One hit from the `pass_lexical` phase. */
export interface LexicalHit {
  find: string;
  replace: string;
  count: number;
  family: string;
}

/** A structural tell the humanizer reports but deliberately never rewrites. */
export interface StructureFlag {
  name: string;
  count: number;
  fix: string;
}

/** Everything stripped or flagged by {@link humanizeText}. */
export interface HumanizeReport {
  invisible: InvisibleHit[];
  typographic: TypographicHit[];
  lexical: LexicalHit[];
  structures: StructureFlag[];
}

/** Result of a humanize run. */
export interface HumanizeResult {
  text: string;
  report: HumanizeReport;
  /** Total artefacts removed across the three auto-fix passes. */
  removed: number;
}

export type ScoreName =
  | "BURSTINESS"
  | "SPECIFICITY"
  | "SLOP DENSITY"
  | "FINGERPRINT"
  | "VOICE";

export const SCORE_NAMES: ScoreName[] = [
  "BURSTINESS",
  "SPECIFICITY",
  "SLOP DENSITY",
  "FINGERPRINT",
  "VOICE",
];

export interface ScoreCheck {
  score: number;
  detail: string;
}

export type Verdict = "PASS" | "REVIEW" | "FLAGGED";

/** Result of the five-check detection panel. */
export interface DetectionResult {
  checks: Record<ScoreName, ScoreCheck>;
  humanScore: number;
  verdict: Verdict;
  weakest: ScoreName;
}

/** A hook formula from `li-post/hooks.json`. */
export interface HookFormula {
  id: number;
  name: string;
  template: string;
  example: string;
  best_for: string;
  trap: string;
}

export interface HookSuggestions {
  idea: string;
  suggestions: Array<{
    hook: HookFormula;
    score: number;
    reason: string;
  }>;
  /** The formula to ship, if any matched. */
  recommended: HookFormula | null;
}

/** A copy-ready draft plus its humanizer/detector receipts. */
export interface DraftResult {
  body: string;
  humanized: HumanizeResult;
  detection: DetectionResult;
  /** One-line receipt, mirroring the upstream `POST READY` block. */
  receipt: string;
}

/** Comment buckets used by the reply triage. */
export type ReplyBucket = "LEAD" | "SUBSTANCE" | "PEER" | "SUPPORT" | "NOISE";

export interface TriagedComment {
  author?: string;
  text: string;
  bucket: ReplyBucket;
  reason: string;
}

/** Env-backed configuration for the service. */
export interface LinkedInAgentConfig {
  /** `li_at` session cookie used to authenticate Voyager requests. */
  liAtCookie: string | null;
  /** `JSESSIONID` cookie; its value is reused as the `csrf-token` header. */
  jsessionId: string | null;
  /** Master switch for any real HTTP call to LinkedIn. Defaults to off. */
  httpEnabled: boolean;
  /** Shared secret for POST /api/linkedin/webhook. */
  webhookSecret: string | null;
  /** Optional per-repo voice profile path (defaults to the vendored template). */
  voicePath: string | null;
}
