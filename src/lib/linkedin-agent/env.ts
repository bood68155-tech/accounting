/**
 * ── Environment configuration ─────────────────────────────────────────────────
 * Every value here is server-side only. The raw `li_at` cookie is a live
 * LinkedIn session credential — never expose it to the browser.
 */
import type { LinkedInAgentConfig } from "./types";

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Read the agent configuration. Always returns; missing values are `null`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LinkedInAgentConfig {
  return {
    liAtCookie: env.LINKEDIN_LI_AT_COOKIE?.trim() || null,
    jsessionId: env.LINKEDIN_JSESSIONID?.trim() || null,
    httpEnabled: isTruthy(env.LINKEDIN_AGENT_ENABLE_HTTP),
    // Canonical name first; `LINKEDIN_WEBHOOK_SECRET` is the pre-rename alias.
    webhookSecret: (env.LINKEDIN_AGENT_WEBHOOK_SECRET ?? env.LINKEDIN_WEBHOOK_SECRET)?.trim() || null,
    voicePath: env.LINKEDIN_VOICE_PATH?.trim() || null,
  };
}
