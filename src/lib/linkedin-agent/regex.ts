/**
 * ── Regex helpers ─────────────────────────────────────────────────────────────
 * The upstream tools are Python. This module bridges the few differences that
 * matter: Python's `re.escape`, its `(?i)` inline flag, and its 8-digit `\U…`
 * escapes, none of which are valid JavaScript.
 */

/** Escape a literal string for use inside a `RegExp`. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the upstream `\b<phrase>\b` matcher, treating any run of whitespace in
 * the phrase as `\s+`. Mirrors `re.escape(find).replace(r"\ ", r"\s+")`.
 */
export function phrasePattern(find: string): RegExp {
  const parts = find
    .trim()
    .split(/\s+/)
    .map(escapeRegExp);
  return new RegExp("\\b" + parts.join("\\s+") + "\\b", "gi");
}

/**
 * Compile one of the Python-flavoured structure regexes from `slop.json` for
 * JavaScript:
 *   • strips an inline `(?i)` and adds the `i` flag it stood for;
 *   • rewrites 8-digit `\U0001F680` escapes to `\u{1F680}` and adds the `u` flag.
 * Returns null when the pattern cannot be compiled, matching the upstream
 * `except re.error: continue`.
 */
export function compileStructureRegex(pattern: string, extraFlags = ""): RegExp | null {
  let src = pattern;
  let flags = "g" + extraFlags;

  if (src.includes("(?i)")) {
    src = src.replace(/\(\?i\)/g, "");
    flags += "i";
  }
  if (/\\U[0-9A-Fa-f]{8}/.test(src)) {
    src = src.replace(/\\U([0-9A-Fa-f]{8})/g, (_match, hex: string) => `\\u{${hex}}`);
    flags += "u";
  }

  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}
