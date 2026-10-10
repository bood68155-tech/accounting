/**
 * ── detect — a five-check panel that scores how machine-written a draft looks ──
 * TypeScript port of `skills/li-human/detect.py` (MIT, Jakeschincariol).
 *
 * Five LOCAL heuristics modelled on the signals public AI detectors measure:
 * sentence-length variation, concreteness, stock vocabulary, typographic
 * fingerprint and voice. Everything runs on this machine from the text alone;
 * nothing is uploaded. These are NOT GPTZero / Originality / Copyleaks /
 * Turnitin and they cannot promise those verdicts.
 *
 * Each check returns a HUMAN score 0–100, higher is better.
 */
import { lexicon } from "./lexicon";
import { compileStructureRegex, phrasePattern } from "./regex";
import type { DetectionResult, ScoreCheck, ScoreName, Verdict } from "./types";
import { SCORE_NAMES } from "./types";

const SENT_RE = /[^.!?\n]+[.!?]*/g;
const WORD_RE = /[A-Za-z']+/g;
const CONTRACTIONS = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;
const PRONOUNS = /\b(i|me|my|mine|we|us|our|you|your)\b/gi;
const NUMBERS = /\b\d[\d,.]*%?\b|\$\d/g;
const PROPER = /\b[A-Z][a-z]{2,}\b/g;
const BULLET = /^\s*[-*•]\s+(.+)$/gm;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Map `value` onto 0–100 where `human` → 100 and `machine` → 0. */
function scale(value: number, human: number, machine: number): number {
  if (human === machine) return 50;
  return clamp(((value - machine) / (human - machine)) * 100);
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation — Python's `statistics.pstdev`. */
function pstdev(values: number[]): number {
  if (!values.length) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length);
}

function sentenceLengths(text: string): number[] {
  return (text.match(SENT_RE) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length > 2)
    .map((s) => s.split(/\s+/).filter(Boolean).length);
}

function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/**
 * Unique capitalised "proper noun" candidates, excluding line starts and words
 * that follow sentence-ending punctuation — the `(?<![.!?]\s)(?<!^)` guards.
 */
function properNouns(text: string): Set<string> {
  const seen = new Set<string>();
  for (const match of text.matchAll(PROPER)) {
    const index = match.index ?? 0;
    if (index === 0) continue;
    const prev = text.slice(Math.max(0, index - 2), index);
    if (prev.endsWith("\n")) continue;
    if (/[.!?]\s$/.test(prev)) continue;
    seen.add(match[0]);
  }
  return seen;
}

/** Humans vary sentence length hard. Models write even. */
function checkBurstiness(text: string): ScoreCheck {
  const lens = sentenceLengths(text);
  if (lens.length < 4) return { score: 50, detail: "too short to judge" };
  const cv = mean(lens) ? pstdev(lens) / mean(lens) : 0;
  return {
    score: scale(cv, 0.7, 0.22),
    detail: `variation ${cv.toFixed(2)} across ${lens.length} sentences (want 0.55+)`,
  };
}

/** Numbers, names and concrete nouns. Slop is abstract. */
function checkSpecificity(text: string): ScoreCheck {
  const w = words(text);
  if (w.length < 25) return { score: 50, detail: "too short to judge" };
  const per100 = 100 / w.length;
  const hits = (text.match(NUMBERS) ?? []).length + properNouns(text).size;
  const density = hits * per100;
  return {
    score: scale(density, 6, 0.5),
    detail: `${hits} concrete markers, ${density.toFixed(1)} per 100 words (want 4+)`,
  };
}

/** Stock vocabulary density against the lexicon. */
function checkSlop(text: string): ScoreCheck {
  const w = words(text);
  if (!w.length) return { score: 50, detail: "empty" };

  let hits = 0;
  const found: string[] = [];
  for (const entry of [...lexicon.words, ...lexicon.phrases]) {
    const n = (text.match(phrasePattern(entry.find)) ?? []).length;
    if (n) {
      hits += n;
      found.push(entry.find);
    }
  }

  const density = (hits * 100) / w.length;
  const score = scale(density, 0, 4);
  let detail = `${hits} stock terms, ${density.toFixed(1)} per 100 words`;
  if (found.length) {
    const listed = [...found].sort().slice(0, 4).join(", ");
    detail += " (" + listed + (found.length > 4 ? ", ..." : "") + ")";
  }
  return { score, detail };
}

/** Characters a phone keyboard does not produce. */
function checkFingerprint(text: string): ScoreCheck {
  const invisible = (text.match(/\p{Cf}/gu) ?? []).length;
  const em = text.split("\u2014").length - 1;
  const curly = countAny(text, "\u2018\u2019\u201C\u201D");
  const ellip = text.split("\u2026").length - 1;
  const nbsp = countAny(text, "\u00A0\u202F\u2009");
  const total = invisible * 4 + em * 2 + curly + ellip + nbsp;
  const per1k = (total * 1000) / Math.max(text.length, 1);
  return {
    score: scale(per1k, 0, 12),
    detail:
      `${invisible} invisible, ${em} em dash, ${curly} curly quote, ` +
      `${ellip} ellipsis, ${nbsp} hard space`,
  };
}

function countAny(text: string, chars: string): number {
  let total = 0;
  for (const ch of chars) total += text.split(ch).length - 1;
  return total;
}

/** Contractions, person, and the shapes models default to. */
function checkVoice(text: string): ScoreCheck {
  const w = words(text);
  if (w.length < 25) return { score: 50, detail: "too short to judge" };

  const per100 = 100 / w.length;
  const contractions = (text.match(CONTRACTIONS) ?? []).length * per100;
  const person = (text.match(PRONOUNS) ?? []).length * per100;

  let tells = 0;
  const names: string[] = [];
  for (const structure of lexicon.structures) {
    const pattern = compileStructureRegex(structure.regex, "m");
    if (!pattern) continue;
    const n = (text.match(pattern) ?? []).length;
    if (n) {
      tells += n;
      names.push(structure.id);
    }
  }

  const bullets = (text.match(BULLET) ?? []).map((line) => line.split(/\s+/).length);
  const uniform = bullets.length >= 3 && pstdev(bullets) < 1.6;

  let score =
    scale(contractions, 3, 0) * 0.35 +
    scale(person, 8, 1) * 0.35 +
    clamp(100 - tells * 22) * 0.3;
  if (uniform) {
    score -= 12;
    names.push("uniform-bullets");
  }

  let detail =
    `${contractions.toFixed(1)} contractions, ${person.toFixed(1)} personal ` +
    `pronouns per 100 words, ${tells} structural tell(s)`;
  if (names.length) detail += " [" + names.slice(0, 4).join(", ") + "]";

  return { score: clamp(score), detail };
}

/** Run the five checks and compute the weighted verdict. */
export function detectText(text: string): DetectionResult {
  const checks: Record<ScoreName, ScoreCheck> = {
    BURSTINESS: checkBurstiness(text),
    SPECIFICITY: checkSpecificity(text),
    "SLOP DENSITY": checkSlop(text),
    FINGERPRINT: checkFingerprint(text),
    VOICE: checkVoice(text),
  };

  const scores = SCORE_NAMES.map((name) => checks[name].score);
  // The weakest check drags the verdict: a detector only needs one signal.
  const humanScore = mean(scores) * 0.6 + Math.min(...scores) * 0.4;
  const weakest = SCORE_NAMES.reduce((a, b) => (checks[a].score <= checks[b].score ? a : b));

  const verdict: Verdict =
    humanScore >= 70 && Math.min(...scores) >= 55
      ? "PASS"
      : humanScore >= 50
        ? "REVIEW"
        : "FLAGGED";

  return { checks, humanScore, verdict, weakest };
}
