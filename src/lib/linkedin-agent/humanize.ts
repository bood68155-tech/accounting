/**
 * ── humanize — strip the machine fingerprint out of a draft ───────────────────
 * TypeScript port of `skills/li-human/humanize.py` (MIT, Jakeschincariol).
 *
 * Three passes, in this order:
 *   1. INVISIBLE   delete or space-normalise characters a phone keyboard never
 *                  produces (zero-width joiners, BOMs, tag characters, …).
 *   2. TYPOGRAPHIC em dash → comma, en dash → hyphen, curly quotes → straight,
 *                  ellipsis → three dots, bullet → hyphen.
 *   3. LEXICAL     replace the slop lexicon with plain words, preserving
 *                  capitalisation and leaving URLs untouched.
 *
 * Structural tells are REPORTED, never auto-rewritten — changing a sentence's
 * shape needs judgement, so that stays a human (or model) job.
 */
import { lexicon } from "./lexicon";
import { countOccurrences, phrasePattern, compileStructureRegex } from "./regex";
import type {
  HumanizeReport,
  HumanizeResult,
  LexicalHit,
  StructureFlag,
  TypographicHit,
  InvisibleHit,
} from "./types";

const URL_RE = /https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g;
const SENT_RE = /[^.!?\n]+[.!?]*/g;

/** `'U+200B'` → `0x200b`; `'U+E0000-U+E007F'` → `[0xe0000, 0xe007f]`. */
function parseCodePoint(spec: string): number | [number, number] {
  if (spec.includes("-")) {
    const [a, b] = spec.split("-");
    return [Number.parseInt(a.slice(2), 16), Number.parseInt(b.slice(2), 16)];
  }
  return Number.parseInt(spec.slice(2), 16);
}

/** Swap URLs for placeholders so no pass rewrites inside a link. */
function protectUrls(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  const out = text.replace(URL_RE, (match) => {
    found.push(match);
    return `\x00URL${found.length - 1}\x00`;
  });
  return { text: out, found };
}

function restoreUrls(text: string, found: string[]): string {
  let out = text;
  found.forEach((url, i) => {
    out = out.split(`\x00URL${i}\x00`).join(url);
  });
  return out;
}

/** 1. Delete or space-normalise invisible characters. */
function passInvisible(text: string): { text: string; hits: InvisibleHit[] } {
  const hits: InvisibleHit[] = [];
  let out = text;

  for (const entry of lexicon.invisible) {
    const cp = parseCodePoint(entry.cp);
    const pattern = Array.isArray(cp)
      ? new RegExp(`[\\u{${cp[0].toString(16)}}-\\u{${cp[1].toString(16)}}]`, "gu")
      : new RegExp(`\\u{${cp.toString(16)}}`, "gu");

    const count = (out.match(pattern) ?? []).length;
    if (count) {
      hits.push({ name: `${entry.cp} ${entry.name}`, count, action: entry.action });
      out = out.replace(pattern, entry.action === "delete" ? "" : " ");
    }
  }

  // Any remaining Cf (format) character is invisible by definition.
  const stray = (out.match(/\p{Cf}/gu) ?? []).length;
  if (stray) {
    hits.push({ name: "other invisible format chars", count: stray, action: "delete" });
    out = out.replace(/\p{Cf}/gu, "");
  }

  return { text: out, hits };
}

/** 2. Normalise AI-typical typography. */
function passTypographic(text: string): { text: string; hits: TypographicHit[] } {
  const hits: TypographicHit[] = [];
  let out = text;

  for (const entry of lexicon.typographic) {
    const ch = entry.from;
    const count = countOccurrences(out, ch);
    if (!count) continue;

    hits.push({ name: `${ch} ${entry.name}`, count, to: entry.to.trim() || "(space)" });

    if (ch === "\u2014") {
      // " word — word " and "word—word" both collapse to a comma + space.
      out = out.replace(/\s*\u2014\s*/g, ", ");
    } else if (ch === "\u2013") {
      out = out.replace(/\s*\u2013\s*(?=\d)/g, "-"); // 5–10 -> 5-10
      out = out.replace(/\s+\u2013\s+/g, ", "); // used as an em dash
      out = out.split("\u2013").join("-");
    } else {
      out = out.split(ch).join(entry.to);
    }
  }

  // A comma inserted before existing punctuation reads wrong.
  out = out.replace(/,\s*([,.;:!?])/g, "$1");
  out = out.replace(/,\s*\n/g, "\n");
  return { text: out, hits };
}

/** Preserve the case pattern of the matched source word. */
function matchCase(source: string, replacement: string): string {
  if (!replacement) return replacement;
  if (source === source.toUpperCase() && source.length > 1) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** 3. Replace slop words and phrases (longest first so phrases win). */
function passLexical(text: string): { text: string; hits: LexicalHit[] } {
  const hits: LexicalHit[] = [];
  let out = text;

  const entries = [...lexicon.phrases, ...lexicon.words].sort(
    (a, b) => b.find.length - a.find.length,
  );

  for (const entry of entries) {
    const pattern = phrasePattern(entry.find);
    const found = out.match(pattern);
    if (!found) continue;

    hits.push({
      find: entry.find,
      replace: entry.replace || "(deleted)",
      count: found.length,
      family: entry.family,
    });
    out = out.replace(pattern, (match) => matchCase(match, entry.replace));
  }

  // Clean up after deletions.
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/^[ \t]*([,.;:])\s*/gm, "");
  out = out.replace(/\s+([,.;:!?])/g, "$1");
  out = out.replace(/^[ \t]+$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  // An em dash that became a comma, then a connective, leaves a splice.
  out = out.replace(
    /,\s*(also|so|still|basically|in the end)\s*,\s*/g,
    (_match, word: string) => ". " + word[0].toUpperCase() + word.slice(1) + ", ",
  );

  return { text: out, hits };
}

/** Report (never rewrite) the structural tells the detectors key on. */
export function scanStructures(text: string): StructureFlag[] {
  const flags: StructureFlag[] = [];

  for (const structure of lexicon.structures) {
    const pattern = compileStructureRegex(structure.regex, "m");
    if (!pattern) continue;
    const found = text.match(pattern);
    if (found && found.length) {
      flags.push({ name: structure.name, count: found.length, fix: structure.fix });
    }
  }

  // Sentence-length uniformity is structural too.
  const lens = (text.match(SENT_RE) ?? [])
    .map((sentence) => sentence.split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 2);

  if (lens.length >= 4) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, n) => a + (n - mean) ** 2, 0) / lens.length;
    const cv = mean ? Math.sqrt(variance) / mean : 0;
    if (cv < 0.35) {
      flags.push({
        name: `Uniform sentence length (variation ${cv.toFixed(2)})`,
        count: lens.length,
        fix: "Break one sentence in half. Let another run long. Machines write even.",
      });
    }
  }

  return flags;
}

/** Run all three cleaning passes and report what changed. */
export function humanizeText(input: string): HumanizeResult {
  const protectedInput = protectUrls(input);
  const invisible = passInvisible(protectedInput.text);
  const typographic = passTypographic(invisible.text);
  const lexical = passLexical(typographic.text);
  const text = restoreUrls(lexical.text, protectedInput.found);

  const report: HumanizeReport = {
    invisible: invisible.hits,
    typographic: typographic.hits,
    lexical: lexical.hits,
    structures: scanStructures(text),
  };

  const removed =
    report.invisible.reduce((a, h) => a + h.count, 0) +
    report.typographic.reduce((a, h) => a + h.count, 0) +
    report.lexical.reduce((a, h) => a + h.count, 0);

  return { text: text.trim() + "\n", report, removed };
}
