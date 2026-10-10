import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runTask, type LinkedInAction, type TaskRequest } from "@/lib/linkedin-agent";

/**
 * POST /api/linkedin/webhook — trigger the LinkedIn agent service from outside
 * the process: a Vercel cron, a GitHub Action, Zapier/Make, or a manual curl.
 *
 * Body: `{ "action": "<humanize|detect|analyze|hooks|post|comment|reply|dm|
 * plan|profile|leads|share|health>", "payload": { ... } }`
 *
 * Auth: `Authorization: Bearer $LINKEDIN_WEBHOOK_SECRET` (or the
 * `x-webhook-secret` header). Without a configured secret the endpoint refuses
 * every request rather than exposing the content tools and, worse, the
 * `leads`/`share` actions to anonymous callers. Compared in constant time.
 *
 * The service is deterministic and offline for every action except `leads` and
 * `share`, and those additionally require LINKEDIN_AGENT_ENABLE_HTTP=true.
 */
export const dynamic = "force-dynamic";

const ACTIONS: LinkedInAction[] = [
  "health",
  "humanize",
  "detect",
  "analyze",
  "hooks",
  "post",
  "comment",
  "reply",
  "dm",
  "plan",
  "profile",
  "leads",
  "share",
];

/** Constant-time secret comparison — hash first so lengths never leak. */
function verifySecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = process.env.LINKEDIN_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "LINKEDIN_WEBHOOK_SECRET is not configured — refusing inbound requests." },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const provided = bearer ?? request.headers.get("x-webhook-secret");

  if (!verifySecret(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: TaskRequest;
  try {
    body = (await request.json()) as TaskRequest;
  } catch {
    return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  }

  if (!body || typeof body.action !== "string" || !ACTIONS.includes(body.action)) {
    return NextResponse.json(
      { error: `Invalid action. Expected one of: ${ACTIONS.join(", ")}.` },
      { status: 400 },
    );
  }

  const result = await runTask({ action: body.action, payload: body.payload });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
