/**
 * ── LinkedIn agent CLI ────────────────────────────────────────────────────────
 * Thin wrapper over `runTask`, so every action can be triggered locally:
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/linkedin-agent/cli.ts health
 *   echo "delve into the robust — seamless workflow…" \
 *     | node scripts/run-ts.mjs scripts/linkedin-agent/cli.ts humanize
 *   node scripts/run-ts.mjs scripts/linkedin-agent/cli.ts post --file draft.txt
 *   node scripts/run-ts.mjs scripts/linkedin-agent/cli.ts reply --json '{"comments":[{"text":"how did you do it?"}]}'
 *
 * Or through the npm script: `npm run linkedin -- hooks --text "..."`.
 *
 * Input resolution: `--json <payload>` wins, then `--file <path>` (read as the
 * `text` field), then `--text <string>`, then stdin.
 */
import { readFileSync } from "node:fs";
import { runTask, type LinkedInAction, type TaskRequest } from "@/lib/linkedin-agent";

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

const USAGE = `LinkedIn agent — local CLI

Usage: cli.ts <action> [--json <payload> | --file <path> | --text <string>]

Actions:
  ${ACTIONS.join(", ")}

Flags:
  --json <payload>   full task payload as JSON (required for reply/plan/profile)
  --file <path>      read the draft from a file (becomes { text })
  --text <string>    pass the draft inline (becomes { text })
  --help             show this message

Env: LINKEDIN_LI_AT_COOKIE, LINKEDIN_JSESSIONID, LINKEDIN_AGENT_ENABLE_HTTP,
     LINKEDIN_AGENT_WEBHOOK_SECRET, LINKEDIN_VOICE_PATH`;

const rawArgs = process.argv.slice(2);
// `scripts/run-ts.mjs` loads this file with jiti in-process, so the script path
// stays at argv[2]; drop it when it is the leading argument.
const args = rawArgs[0]?.endsWith("cli.ts") ? rawArgs.slice(1) : rawArgs;

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function buildPayload(): Record<string, unknown> {
  const json = flag("json");
  if (json) return JSON.parse(json) as Record<string, unknown>;

  const file = flag("file");
  if (file) return { text: readFileSync(file, "utf8") };

  const text = flag("text");
  if (text !== undefined) return { text };

  if (process.stdin.isTTY) return {};
  const piped = readFileSync(0, "utf8");
  return piped.trim() ? { text: piped } : {};
}

async function main(): Promise<void> {
  if (!args.length || args.includes("--help") || args[0] === "help") {
    console.log(USAGE);
    return;
  }

  const action = args[0] as LinkedInAction;
  if (!ACTIONS.includes(action)) {
    console.error(`Unknown action "${action}".\n\n${USAGE}`);
    process.exit(2);
  }

  const request: TaskRequest = { action, payload: buildPayload() };
  const result = await runTask(request);

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error("linkedin-agent CLI failed:", error);
  process.exit(1);
});
