# LinkedIn agent

Integration of [Jakeschincariol/linkedin-agent-skill](https://github.com/Jakeschincariol/linkedin-agent-skill)
(MIT) into this repository.

The upstream project is eleven Claude skills plus two dependency-free Python
tools. Its deterministic half — the **humanizer** (`humanize.py`) and the
five-check **detector** (`detect.py`) — is ported to TypeScript under
`src/lib/linkedin-agent/` so it runs inside the Next.js runtime with no Python
and no extra dependencies. The prompt files, the lexicon (`slop.json`), the 21
hook formulas (`hooks.json`) and the profile rubric (`rubric.json`) are vendored
verbatim under `upstream/`.

```
scripts/linkedin-agent/
├── cli.ts                      # local CLI → runTask
├── n8n-linkedin-workflow.json  # importable n8n template (schedule → webhook)
├── README.md       # this file
└── upstream/       # verbatim copy of the upstream skill (MIT)
    ├── LICENSE
    ├── README.md
    ├── skills/     # 11 SKILL.md prompts + humanize.py / detect.py / *.json
    └── templates/voice.md
```

Runtime library:

```
src/lib/linkedin-agent/
├── data/           # slop.json · hooks.json · rubric.json (bundled by Next)
├── humanize.ts     # TS port of humanize.py
├── detect.ts       # TS port of detect.py
├── content.ts      # hooks · comments · reply triage · DM · plan · profile
├── client.ts       # opt-in Voyager client (li_at cookie)
├── service.ts      # runTask() dispatcher shared by every trigger
├── env.ts · regex.ts · lexicon.ts · types.ts · index.ts
```

## Three ways to trigger it

All three share `runTask()` from `src/lib/linkedin-agent`.

**1. Locally (function call)**

```ts
import { runTask } from "@/lib/linkedin-agent";

const { data } = await runTask({
  action: "humanize",
  payload: { text: "We leverage a robust — seamless system…" },
});
```

**2. CLI**

```bash
npm run linkedin -- health
echo "delve into the robust — seamless workflow…" | npm run linkedin -- humanize
npm run linkedin -- post --file draft.txt --json '{"text":"…","idea":"cut proposal time"}'
npm run linkedin -- hooks --text "I fired my biggest client in January"
npm run linkedin -- reply --json '{"comments":[{"text":"how did you do it?"}]}'
```

Equivalent raw form (no npm):

```bash
node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/linkedin-agent/cli.ts humanize --text "…"
```

**3. Webhook**

```bash
curl -X POST "$APP_URL/api/linkedin/webhook" \
  -H "Authorization: Bearer $LINKEDIN_AGENT_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"post","payload":{"text":"…","idea":"…"}}'
```

Without `LINKEDIN_AGENT_WEBHOOK_SECRET` the endpoint refuses every request
with a `500`; a wrong token answers `401`. The body's `action` field may be any
value in the Actions table below — `humanize`, `post` and `leads` are the three
the n8n template drives. (The pre-rename `LINKEDIN_WEBHOOK_SECRET` is still
accepted as an alias.)

## Running it from n8n

`n8n-linkedin-workflow.json` is a ready-made workflow that hits the webhook on
a schedule: it humanizes a draft and prepares a post, and separately pulls a
lead search, scores it, and pings Telegram above a threshold.

**1. Import the workflow**

n8n → **Workflows → ⋯ → Import from File** and select
`scripts/linkedin-agent/n8n-linkedin-workflow.json`. Or via the CLI:

```bash
n8n import:workflow --input=scripts/linkedin-agent/n8n-linkedin-workflow.json
```

**2. Set the variables n8n reads**

| variable | where | purpose |
| --- | --- | --- |
| `APP_URL` | n8n env | base URL of this app; falls back to `http://localhost:3000` |
| `LINKEDIN_AGENT_WEBHOOK_SECRET` | n8n env **and** this app's env | Bearer token both sides share |
| `TELEGRAM_CHAT_ID` | n8n env | chat/group that receives high-score leads |

n8n exposes `$env` to node expressions by default; if `LINKEDIN_AGENT_WEBHOOK_SECRET`
resolves to an empty Bearer header, check that `N8N_BLOCK_ENV_ACCESS_IN_NODE` is
not `true`.

**3. Attach the Telegram credential and activate**

Open **Telegram: High-Score Lead** → *Credential for Telegram API* → **Create
new** (see the next section), then toggle the workflow **Active**. It runs daily
at 09:00 UTC (`Every Morning`); change the cron in that node to taste.

The two HTTP nodes are configured with *Never Error* and 3 retries, so a `422`
from a still-disabled `leads` action stops nothing — the run just yields no
leads.

### Telegram: notifications for high-score leads

1. Talk to **@BotFather** → `/newbot` → copy the **bot token**.
2. Message your new bot once (otherwise it cannot DM you), then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `chat.id`. For a
group, add the bot to the group and read the negative `chat.id`.
3. In n8n: **Credentials → Telegram → New**, paste the token as
   `Telegram Bot` API, and select it on the Telegram node.
4. Set `TELEGRAM_CHAT_ID` in the n8n env to that `chat.id`.

**Lead scoring** happens in the `Score Leads` node (deterministic: keyword
overlap plus a seniority bump, capped at 99) and the `Score 70 or Higher` node
gates the notification. Both are ordinary n8n nodes — edit them on the canvas.
Remember `leads` is opt-in: it needs `LINKEDIN_AGENT_ENABLE_HTTP=true` and a
live `LINKEDIN_LI_AT_COOKIE` before it returns anything to score.

## Actions

| action | network? | what it does |
| --- | --- | --- |
| `health` | no | reports whether HTTP/cookie/webhook are configured (never echoes the cookie) |
| `humanize` | no | strips invisible chars, AI typography and slop; returns a report |
| `detect` | no | five-check panel → `humanScore` + `PASS`/`REVIEW`/`FLAGGED` |
| `analyze` | no | `humanize` + `detect` before and after |
| `hooks` | no | the 21 formulas ranked against an idea |
| `post` | no | cleans a draft, applies the pack's rules (no links, ≤3 hashtags, no invented numbers), scores it |
| `comment` | no | picks two of the nine comment types + humanizes/scoring |
| `reply` | no | triages comments into LEAD / SUBSTANCE / PEER / SUPPORT / NOISE |
| `dm` | no | invite note (with 200-char count) + first message + two follow-ups, humanized |
| `plan` | no | the week: Proof / Opinion / Teach (+ Story / Offer), each with a hook formula |
| `profile` | no | scores a profile against the 12-item, 100-point rubric |
| `leads` | **yes** | people search via the Voyager API |
| `share` | **yes** | publishes a text post to the connected profile |

## Environment

See the **LinkedIn agent** block in `.env.example`. Server-side only:

- `LINKEDIN_LI_AT_COOKIE` — a live `li_at` session cookie. Treat it like a password.
- `LINKEDIN_JSESSIONID` — the `JSESSIONID` value, reused as the Voyager `csrf-token`.
- `LINKEDIN_AGENT_ENABLE_HTTP` — master switch for `leads`/`share` (default off).
- `LINKEDIN_AGENT_WEBHOOK_SECRET` — Bearer token for the webhook. (The older
  `LINKEDIN_WEBHOOK_SECRET` still works as an alias.)
- `LINKEDIN_VOICE_PATH` — optional path to a filled-in `voice.md`.

## ⚠️ Before you enable HTTP

LinkedIn has no public API for posting to a personal profile. The `leads` and
`share` actions use the **undocumented** Voyager endpoints via a session cookie;
doing so violates LinkedIn's User Agreement and can get the account restricted.
The upstream skill deliberately never posts for exactly this reason: it writes,
and the human posts. That is also the default here — everything except `leads`
and `share` runs offline, and those two stay off until
`LINKEDIN_AGENT_ENABLE_HTTP=true` is set on purpose. The Voyager paths are
best-effort and may need adjusting as LinkedIn changes them.

## Credit & license

The skill content under `upstream/` is by Jake Schincariol
([opusjake.ai](https://opusjake.ai/r/linkedin-agent)), licensed MIT. The
TypeScript port and wrapper keep the same MIT terms; see `upstream/LICENSE`.
