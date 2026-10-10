import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/linkedin/webhook/route";

/**
 * Drive /api/linkedin/webhook through its real interface — a POST with a
 * Bearer token and a JSON body — so the auth guard and the action dispatcher
 * are verified together. `LINKEDIN_AGENT_WEBHOOK_SECRET` is read per request,
 * so each test can own the environment.
 */
const SECRET = "n8n-secret-abc123";

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/linkedin/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function authed(body: unknown, secret = SECRET): Promise<Response> {
  return post(body, { authorization: `Bearer ${secret}` });
}

beforeEach(() => {
  process.env.LINKEDIN_AGENT_WEBHOOK_SECRET = SECRET;
  delete process.env.LINKEDIN_WEBHOOK_SECRET;
  delete process.env.LINKEDIN_AGENT_ENABLE_HTTP;
  delete process.env.LINKEDIN_LI_AT_COOKIE;
});

afterEach(() => {
  delete process.env.LINKEDIN_AGENT_WEBHOOK_SECRET;
  delete process.env.LINKEDIN_WEBHOOK_SECRET;
  delete process.env.LINKEDIN_AGENT_ENABLE_HTTP;
});

describe("POST /api/linkedin/webhook", () => {
  it("refuses every request when LINKEDIN_AGENT_WEBHOOK_SECRET is unset", async () => {
    delete process.env.LINKEDIN_AGENT_WEBHOOK_SECRET;
    const res = await authed({ action: "health" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/LINKEDIN_AGENT_WEBHOOK_SECRET is not configured/);
  });

  it("rejects a missing or wrong bearer token", async () => {
    expect((await post({ action: "health" })).status).toBe(401);
    expect((await post({ action: "health" }, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post({ action: "health" }, { authorization: "Basic abc" })).status).toBe(401);
  });

  it("accepts the x-webhook-secret header as an alternative", async () => {
    const res = await post({ action: "health" }, { "x-webhook-secret": SECRET });
    expect(res.status).toBe(200);
  });

  it("still honours the pre-rename LINKEDIN_WEBHOOK_SECRET alias", async () => {
    delete process.env.LINKEDIN_AGENT_WEBHOOK_SECRET;
    process.env.LINKEDIN_WEBHOOK_SECRET = SECRET;
    expect((await authed({ action: "health" })).status).toBe(200);
    expect((await authed({ action: "health" }, "wrong")).status).toBe(401);
  });

  it("rejects malformed JSON", async () => {
    // Auth is checked before the body, so this must be authenticated to reach
    // the parser at all.
    const res = await post("not json at all", { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown action", async () => {
    const res = await authed({ action: "bogus" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid action/);
  });

  it("handles the humanize action", async () => {
    const res = await authed({
      action: "humanize",
      payload: { text: "We leverage a robust system\u2026" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { text: string } };
    expect(body.ok).toBe(true);
    expect(body.data.text).toContain("use a solid");
    expect(body.data.text).not.toContain("\u2026");
  });

  it("handles the post action and scores the result", async () => {
    const res = await authed({
      action: "post",
      payload: { text: "Revenue went up 40%. Profit went down.", hashtags: ["ecommerce"] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { copyReady: string; detection: { verdict: string; humanScore: number } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.copyReady).toContain("Revenue went up 40%");
    expect(body.data.detection.verdict).toMatch(/PASS|REVIEW|FLAGGED/);
    expect(typeof body.data.detection.humanScore).toBe("number");
  });

  it("handles the leads action, answering 422 while HTTP stays disabled", async () => {
    const res = await authed({ action: "leads", payload: { keywords: "shopify founder" } });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/LINKEDIN_AGENT_ENABLE_HTTP/);
  });
});
