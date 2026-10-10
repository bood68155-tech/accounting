/**
 * ── LinkedIn agent skill (MIT) — public surface ───────────────────────────────
 * TypeScript port of the deterministic half of
 * https://github.com/Jakeschincariol/linkedin-agent-skill — the humanizer, the
 * five-check detector, the 21 hook formulas, comment/reply/DM/plan helpers and
 * the profile rubric — plus an opt-in transport client and a task dispatcher.
 *
 * The vendored upstream files live in `scripts/linkedin-agent/upstream/`.
 */
export * from "./types";
export * from "./lexicon";
export * from "./regex";
export * from "./humanize";
export * from "./detect";
export * from "./env";
export * from "./client";
export * from "./content";
export * from "./service";
