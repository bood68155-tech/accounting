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
├── cli.ts          # local CLI → runTask
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
  -H "Authorization: Bearer $LINKEDIN_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"post","payload":{"text":"…","idea":"…"}}'
```

Without `LINKEDIN_WEBHOOK_SECRET` the endpoint refuses every request.

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
- `LINKEDIN_WEBHOOK_SECRET` — Bearer token for the webhook.
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
