/**
 * ── Service wrapper ───────────────────────────────────────────────────────────
 * One entry point (`runTask`) that every trigger shares: a local function call,
 * the CLI in `scripts/linkedin-agent/cli.ts`, or the webhook at
 * `/api/linkedin/webhook`. The deterministic content actions never touch the
 * network; `leads` and `share` do, and only when `LINKEDIN_AGENT_ENABLE_HTTP`
 * is on and a cookie is present.
 */
import { loadConfig } from "./env";
import { humanizeText } from "./humanize";
import { detectText } from "./detect";
import { LinkedInClient, LinkedInError, type LinkedInFetch } from "./client";
import {
  buildDm,
  buildPlan,
  preparePost,
  prepareComment,
  scoreProfile,
  suggestCommentTypes,
  suggestHooks,
  triageReplies,
  getHookRules,
  COMMENT_TYPES,
  REPLY_GUIDANCE,
  type DraftPostInput,
  type DmInput,
  type PlanInput,
  type PlanSlotType,
} from "./content";
import type { LinkedInAgentConfig, ReplyBucket } from "./types";

export type LinkedInAction =
  | "health"
  | "humanize"
  | "detect"
  | "analyze"
  | "hooks"
  | "post"
  | "comment"
  | "reply"
  | "dm"
  | "plan"
  | "profile"
  | "leads"
  | "share";

export interface TaskRequest {
  action: LinkedInAction;
  payload?: Record<string, unknown>;
}

export interface TaskResult {
  action: LinkedInAction;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface RunTaskOptions {
  config?: LinkedInAgentConfig;
  /** Inject a fetch for tests / a stubbed LinkedIn. */
  fetch?: LinkedInFetch;
}

// ── Payload readers (the webhook receives untrusted JSON) ──────────────────────

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function requireText(payload: Record<string, unknown>): string {
  const text = str(payload.text ?? payload.body).trim();
  if (!text) throw new Error("A non-empty `text` (or `body`) field is required.");
  return text;
}

/** Build an authenticated client, refusing unless HTTP is explicitly enabled. */
function buildClient(config: LinkedInAgentConfig, fetchImpl?: LinkedInFetch): LinkedInClient {
  if (!config.httpEnabled) {
    throw new LinkedInError(
      "LinkedIn HTTP is disabled. Set LINKEDIN_AGENT_ENABLE_HTTP=true to allow real " +
        "requests. Note: automating LinkedIn violates its User Agreement.",
    );
  }
  return new LinkedInClient({ config, fetch: fetchImpl });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Run one agent task. Never throws for a bad action or a failed network call —
 * the failure is returned as `{ ok: false, error }` so a webhook can always
 * answer with a structured body.
 */
export async function runTask(
  request: TaskRequest,
  options: RunTaskOptions = {},
): Promise<TaskResult> {
  const config = options.config ?? loadConfig();
  const payload = request.payload ?? {};

  try {
    switch (request.action) {
      case "health":
        return {
          action: "health",
          ok: true,
          data: {
            httpEnabled: config.httpEnabled,
            hasCookie: Boolean(config.liAtCookie),
            hasWebhookSecret: Boolean(config.webhookSecret),
            hookCount: suggestHooks("", 99).suggestions.length || undefined,
          },
        };

      case "humanize":
        return { action: "humanize", ok: true, data: humanizeText(requireText(payload)) };

      case "detect":
        return { action: "detect", ok: true, data: detectText(requireText(payload)) };

      case "analyze": {
        const text = requireText(payload);
        const humanized = humanizeText(text);
        return {
          action: "analyze",
          ok: true,
          data: { humanized, detection: detectText(text), cleanDetection: detectText(humanized.text) },
        };
      }

      case "hooks": {
        const idea = str(payload.idea) || str(payload.text) || str(payload.body);
        if (!idea.trim()) throw new Error("A non-empty `idea` field is required.");
        return {
          action: "hooks",
          ok: true,
          data: { ...suggestHooks(idea, num(payload.limit) ?? 3), rules: getHookRules() },
        };
      }

      case "post": {
        const input: DraftPostInput = {
          body: requireText(payload),
          idea: str(payload.idea) || undefined,
          hookId: num(payload.hookId),
          hashtags: arr<string>(payload.hashtags),
          link: str(payload.link) || undefined,
        };
        return { action: "post", ok: true, data: preparePost(input) };
      }

      case "comment": {
        const body = requireText(payload);
        const post = str(payload.post);
        const types = post ? suggestCommentTypes(post) : { types: COMMENT_TYPES.slice(0, 2), guidance: [] };
        return { action: "comment", ok: true, data: { ...prepareComment(body), ...types } };
      }

      case "reply": {
        const comments = arr<{ author?: string; text: string }>(payload.comments).filter(
          (c) => typeof c?.text === "string" && c.text.trim(),
        );
        const triaged = triageReplies(comments);
        const counts = triaged.reduce<Record<ReplyBucket, number>>(
          (acc, c) => ({ ...acc, [c.bucket]: (acc[c.bucket] ?? 0) + 1 }),
          { LEAD: 0, SUBSTANCE: 0, PEER: 0, SUPPORT: 0, NOISE: 0 },
        );
        return { action: "reply", ok: true, data: { triaged, counts, guidance: REPLY_GUIDANCE } };
      }

      case "dm": {
        const input: DmInput = {
          name: str(payload.name),
          reference: str(payload.reference) || "your recent post",
          who: str(payload.who) || "I work in this space",
          goal: (["conversation", "referral", "job", "sale"] as const).includes(
            str(payload.goal) as DmInput["goal"],
          )
            ? (str(payload.goal) as DmInput["goal"])
            : "conversation",
          give: str(payload.give) || undefined,
        };
        return { action: "dm", ok: true, data: buildDm(input) };
      }

      case "plan": {
        const angles = arr<{ type: PlanSlotType; angle: string; hookId?: number }>(payload.angles);
        if (!angles.length) throw new Error("`angles` must be a non-empty array of { type, angle }.");
        const input: PlanInput = {
          weekOf: str(payload.weekOf) || undefined,
          angles,
          audienceTimezone: str(payload.audienceTimezone) || undefined,
        };
        return { action: "plan", ok: true, data: buildPlan(input) };
      }

      case "profile": {
        const scores = obj(payload.scores) as Record<string, number>;
        if (!Object.keys(scores).length) throw new Error("`scores` must map rubric ids → points.");
        return { action: "profile", ok: true, data: scoreProfile({ scores }) };
      }

      case "leads": {
        const client = buildClient(config, options.fetch);
        const keywords = str(payload.keywords) || requireText(payload);
        const result = await client.searchPeople({
          keywords,
          count: num(payload.count) ?? 10,
          start: num(payload.start) ?? 0,
        });
        return { action: "leads", ok: true, data: { keywords, result } };
      }

      case "share": {
        const client = buildClient(config, options.fetch);
        const authorUrn = str(payload.authorUrn);
        if (!authorUrn) throw new Error("`authorUrn` (urn:li:fsd_profile:…) is required to share.");
        const result = await client.shareTextPost({
          text: requireText(payload),
          authorUrn,
          visibility: str(payload.visibility) === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
        });
        return { action: "share", ok: true, data: result };
      }

      default: {
        const exhaustive: never = request.action;
        throw new Error(`Unknown action: ${String(exhaustive)}`);
      }
    }
  } catch (error) {
    return {
      action: request.action,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
