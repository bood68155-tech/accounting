import { describe, expect, it } from "vitest";
import { runTask, buildDm, preparePost, suggestHooks, triageReplies } from "@/lib/linkedin-agent";
import type { LinkedInAgentConfig } from "@/lib/linkedin-agent";

/** HTTP off, no cookie — the safe default a fresh checkout runs with. */
const offlineConfig: LinkedInAgentConfig = {
  liAtCookie: null,
  jsessionId: null,
  httpEnabled: false,
  webhookSecret: null,
  voicePath: null,
};

describe("runTask", () => {
  it("humanizes text offline and reports what it stripped", async () => {
    const result = await runTask(
      { action: "humanize", payload: { text: "We leverage a robust — seamless system…" } },
      { config: offlineConfig },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { text: string };
    expect(data.text).not.toContain("\u2014");
    expect(data.text).not.toContain("\u2026");
    expect(data.text).toContain("use a solid");
  });

  it("rejects an empty payload without throwing", async () => {
    const result = await runTask({ action: "post", payload: {} }, { config: offlineConfig });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it("returns hook suggestions for an idea", async () => {
    const result = await runTask(
      { action: "hooks", payload: { idea: "we cut proposal time from 5 hours to 20 minutes" } },
      { config: offlineConfig },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { suggestions: unknown[] };
    expect(data.suggestions.length).toBeGreaterThan(0);
  });

  it("refuses leads and share while HTTP is disabled", async () => {
    const leads = await runTask(
      { action: "leads", payload: { keywords: "agency owners" } },
      { config: offlineConfig },
    );
    expect(leads.ok).toBe(false);
    expect(leads.error).toMatch(/disabled/i);

    const share = await runTask(
      { action: "share", payload: { text: "hello", authorUrn: "urn:li:fsd_profile:1" } },
      { config: offlineConfig },
    );
    expect(share.ok).toBe(false);
    expect(share.error).toMatch(/disabled/i);
  });

  it("reports health without leaking the cookie value", async () => {
    const result = await runTask(
      { action: "health" },
      {
        config: {
          ...offlineConfig,
          liAtCookie: "super-secret-cookie",
          webhookSecret: "s3cr3t",
        },
      },
    );
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain("super-secret-cookie");
    expect((result.data as { hasCookie: boolean }).hasCookie).toBe(true);
  });

  it("fails cleanly on an unknown action", async () => {
    const result = await runTask(
      { action: "nope" as never },
      { config: offlineConfig },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown action/i);
  });
});

describe("suggestHooks", () => {
  it("picks a formula for a numeric idea", () => {
    const result = suggestHooks("I sent 400 cold DMs in 30 days");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.recommended).not.toBeNull();
    expect(result.recommended?.id).toBeGreaterThan(0);
  });
});

describe("preparePost", () => {
  it("moves a link to the first comment and caps hashtags at three", () => {
    const result = preparePost({
      body: "Line one.\n\nSee https://example.com/deck for the full breakdown.\n\nMore words here.",
      hashtags: ["one", "#two", "three", "four"],
    });
    expect(result.copyReady).not.toContain("https://");
    expect(result.linkComment).toBe("https://example.com/deck");
    expect(result.warnings.some((w) => /hashtag/i.test(w))).toBe(true);
    expect(result.copyReady.match(/#/g)?.length).toBe(3);
  });

  it("flags an unresolved number placeholder instead of inventing one", () => {
    const result = preparePost({ body: "We saved {{your number}} on this." });
    expect(result.warnings.some((w) => /placeholder/i.test(w))).toBe(true);
  });
});

describe("triageReplies", () => {
  it("sorts comments into the five buckets", () => {
    const triaged = triageReplies([
      { text: "how did you do it?" },
      { text: "Great post!" },
      { text: "Check out my new course at example.com" },
      { text: "We disagree on cadence. Our data over 6 months says otherwise." },
    ]);
    const buckets = triaged.map((c) => c.bucket);
    expect(buckets[0]).toBe("LEAD");
    expect(buckets[1]).toBe("SUPPORT");
    expect(buckets[2]).toBe("NOISE");
    expect(buckets[3]).toBe("SUBSTANCE");
  });

  it('catches the "check my profile" pitch that never says "check out"', () => {
    const [triaged] = triageReplies([{ text: "Check my profile for free crypto" }]);
    expect(triaged.bucket).toBe("NOISE");
  });
});

describe("runTask · plan", () => {
  it("normalises a lowercase angle type instead of crashing", async () => {
    const result = await runTask(
      { action: "plan", payload: { angles: [{ type: "proof", angle: "a store that found $4,200" }] } },
      { config: offlineConfig },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { slots: Array<{ type: string }> };
    expect(data.slots[0].type).toBe("PROOF");
  });

  it("rejects an unknown angle type with a readable message", async () => {
    const result = await runTask(
      { action: "plan", payload: { angles: [{ type: "bogus", angle: "x" }] } },
      { config: offlineConfig },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown angle type/i);
    expect(result.error).toMatch(/PROOF/);
  });
});

describe("buildDm", () => {
  it("keeps the invite humanized and within the 200-character limit", () => {
    const dm = buildDm({
      name: "Sarah",
      reference: "your post on killing the discovery call",
      who: "I run ops at a 12-person studio",
      goal: "conversation",
    });
    expect(dm.inviteChars).toBeLessThanOrEqual(200);
    expect(dm.inviteOverLimit).toBe(false);
    expect(dm.inviteNote).not.toContain("\u2014");
    expect(dm.followUp4Days.length).toBeGreaterThan(0);
  });

  it("warns when the invite would exceed the limit", () => {
    const dm = buildDm({
      name: "Sarah",
      reference: "x".repeat(190),
      who: "me",
      goal: "conversation",
    });
    expect(dm.inviteOverLimit).toBe(true);
    expect(dm.warnings.some((w) => /200-character/.test(w))).toBe(true);
  });
});
