import { describe, expect, it } from "vitest";
import { detectText, humanizeText, scanStructures } from "@/lib/linkedin-agent";

describe("humanizeText", () => {
  it("deletes invisible characters a keyboard never produces", () => {
    const { text, report } = humanizeText("hello\u200bworld\u2060!");
    expect(text).toBe("helloworld!\n");
    expect(report.invisible.length).toBeGreaterThan(0);
    expect(report.invisible.reduce((a, h) => a + h.count, 0)).toBe(2);
  });

  it("normalises non-breaking spaces to plain spaces", () => {
    const { text } = humanizeText("50\u00a0words\u202fon a line");
    expect(text).toBe("50 words on a line\n");
  });

  it("collapses em dashes to commas and fixes the punctuation they leave", () => {
    const { text, report } = humanizeText("Fast — reliable — shipped.");
    expect(text).toBe("Fast, reliable, shipped.\n");
    expect(report.typographic.some((h) => h.name.includes("EM DASH"))).toBe(true);
  });

  it("converts en-dash number ranges to hyphens and curly quotes to straight", () => {
    const { text } = humanizeText("pages 5–10, \u2018quoted\u2019 \u201Ctext\u201D");
    expect(text).toBe("pages 5-10, 'quoted' \"text\"\n");
  });

  it("replaces slop lexicon words with plain ones, preserving case", () => {
    expect(humanizeText("We leverage this to delve into the robust system.").text).toBe(
      "We use this to look at the solid system.\n",
    );
    expect(humanizeText("Leverage it.").text).toBe("Use it.\n");
    expect(humanizeText("In today's fast-paced world we move the needle.").text).toBe(
      "Right now we make a difference.\n",
    );
  });

  it("never rewrites inside a URL", () => {
    const { text } = humanizeText("Docs: https://example.com/leverage—now");
    expect(text).toBe("Docs: https://example.com/leverage—now\n");
  });

  it("reports structural tells instead of rewriting them", () => {
    const flags = scanStructures("It's not just a tool, it's a movement.");
    expect(flags.some((f) => f.name.includes("not just"))).toBe(true);
  });

  it("reports rule-of-three triads and uniform sentence length", () => {
    const flags = scanStructures("We shipped, tested, and learned.\nAll good.");
    expect(flags.length).toBeGreaterThan(0);
  });

  it("returns counting receipts for the lexical pass", () => {
    const { report } = humanizeText("leverage leverage seamless");
    const leverage = report.lexical.find((h) => h.find === "leverage");
    expect(leverage?.count).toBe(2);
    expect(leverage?.replace).toBe("use");
    expect(leverage?.family).toBe("verbs");
  });
});

describe("detectText", () => {
  it("returns the five named checks and a bounded score", () => {
    const result = detectText(
      "I shipped the rebuild on Tuesday. It took two hours, not the two days I budgeted. " +
        "The culprit was a stale index, and clearing it before every deploy dropped our " +
        "build time from 12 minutes to 40 seconds. We have not missed a release since.",
    );
    expect(Object.keys(result.checks)).toEqual([
      "BURSTINESS",
      "SPECIFICITY",
      "SLOP DENSITY",
      "FINGERPRINT",
      "VOICE",
    ]);
    expect(result.humanScore).toBeGreaterThanOrEqual(0);
    expect(result.humanScore).toBeLessThanOrEqual(100);
    expect(["PASS", "REVIEW", "FLAGGED"]).toContain(result.verdict);
  });

  it("scores an em-dash-and-slop draft lower than a concrete one", () => {
    const sloppy = detectText(
      "In today's fast-paced world we leverage robust, seamless, crucial solutions — " +
        "a testament to our holistic, transformative journey…",
    );
    const concrete = detectText(
      "We cut proposal time from 5 hours to 20 minutes. 3 clients noticed in the first week. " +
        "The template was 4 lines long and nobody asked for the old one back.",
    );
    expect(sloppy.humanScore).toBeLessThan(concrete.humanScore);
    expect(sloppy.checks.FINGERPRINT.score).toBeLessThan(concrete.checks.FINGERPRINT.score);
  });

  it("marks very short input as too short to judge", () => {
    const result = detectText("Short. Very short.");
    expect(result.checks.BURSTINESS.detail).toBe("too short to judge");
  });
});
