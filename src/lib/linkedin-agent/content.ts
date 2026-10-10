/**
 * ── Content helpers ───────────────────────────────────────────────────────────
 * Deterministic building blocks distilled from the upstream skill's prompt
 * files (li-post, li-comment, li-reply, li-dm, li-plan, li-profile). They do
 * not write prose for you — the skill's whole thesis is that a model (or a
 * person) writes and the humanizer cleans — but they pick hooks, enforce the
 * pack's rules, triage comments and lay out the week, so a caller only has to
 * supply the specific, true details.
 */
import { hookFormulas, hookRules, rubric, type RubricItem } from "./lexicon";
import { humanizeText } from "./humanize";
import { detectText } from "./detect";
import type {
  DraftResult,
  HookFormula,
  HookSuggestions,
  ReplyBucket,
  TriagedComment,
} from "./types";
import type { HumanizeResult } from "./types";

// ── Small text utilities ──────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with",
  "is", "are", "was", "were", "i", "we", "you", "it", "this", "that", "my",
  "our", "your", "about", "how", "what", "why", "when", "who", "as", "at",
  "from", "by", "be", "been", "has", "have", "had", "do", "does", "did", "so",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (token) => token.length > 2 && !STOP_WORDS.has(token),
  );
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// ── li-post: hook selection ───────────────────────────────────────────────────

/**
 * Score the 21 hook formulas against a raw idea and return the best fits.
 *
 * Different formulas, not three variations of one — the pack's first rule.
 */
export function suggestHooks(idea: string, limit = 3): HookSuggestions {
  const ideaTokens = tokenize(idea);
  const ideaSet = new Set(ideaTokens);

  const scored = hookFormulas.map((hook) => {
    const haystack = `${hook.name} ${hook.template} ${hook.example} ${hook.best_for}`
      .toLowerCase();
    const haystackTokens = new Set(tokenize(haystack));
    let score = 0;
    for (const token of ideaSet) if (haystackTokens.has(token)) score += 2;
    // Reward formulas whose *name* names the shape the idea already has.
    const nameTokens = tokenize(hook.name);
    for (const token of nameTokens) if (ideaSet.has(token)) score += 3;
    // Numbers, mistakes and results map to specific formulas.
    if (/\d/.test(idea) && [2, 3, 10, 17, 20].includes(hook.id)) score += 1;
    if (/\b(mistake|cost|failed|lost|fired|quit)\b/i.test(idea) && [3, 20].includes(hook.id)) {
      score += 1;
    }
    if (/\b(how|system|template|process)\b/i.test(idea) && [17, 21].includes(hook.id)) {
      score += 1;
    }
    return { hook, score };
  });

  const ranked = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.hook.id - b.hook.id)
    .slice(0, limit);

  const suggestions = ranked.map(({ hook, score }) => ({
    hook,
    score,
    reason: `Best for: ${hook.best_for} Watch out: ${hook.trap}`,
  }));

  return {
    idea,
    suggestions,
    recommended: suggestions.length ? suggestions[0].hook : null,
  };
}

/** Copy of the pack's five hook rules, for callers that surface them. */
export function getHookRules(): string[] {
  return [...hookRules];
}

// ── li-post: enforce the rules and produce a humanized, scored draft ───────────

export interface DraftPostInput {
  /** The raw draft (already written by a person or model). */
  body: string;
  idea?: string;
  hookId?: number;
  /** Max three are kept, per the skill's rule. */
  hashtags?: string[];
  /** A link to move out of the body (LinkedIn suppresses posts with links). */
  link?: string;
}

export interface DraftPostResult {
  body: string;
  /** Concatenated with hashtags — what the user actually pastes. */
  copyReady: string;
  hook: HookFormula | null;
  hookOptions: HookSuggestions;
  humanized: HumanizeResult;
  detection: DraftResult["detection"];
  chars: number;
  linkComment: string | null;
  warnings: string[];
}

/**
 * Clean and score a post draft and enforce the pack's mechanical rules:
 * no links in the body, three hashtags maximum, flag `{{your number}}`
 * placeholders rather than invent a number.
 */
export function preparePost(input: DraftPostInput): DraftPostResult {
  const warnings: string[] = [];

  let body = input.body;
  let linkComment: string | null = null;

  // Rule: no links in the post body.
  const urlMatch = body.match(/https?:\/\/\S+/);
  if (urlMatch) {
    linkComment = urlMatch[0];
    body = body.replace(urlMatch[0], "").replace(/[ \t]+\n/g, "\n").trim();
    warnings.push("A link was moved to the first comment — LinkedIn suppresses posts with outbound links.");
  } else if (input.link) {
    linkComment = input.link;
  }

  // Rule: never fabricate a number.
  if (/\{\{.*?\}\}/.test(body)) {
    warnings.push("Unresolved placeholder found — fill it with a real number or cut the claim.");
  }

  const hashtags = (input.hashtags ?? []).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  if (hashtags.length > 3) {
    warnings.push(`Kept the first three hashtags; ${hashtags.length} were supplied.`);
  }
  const keptHashtags = hashtags.slice(0, 3);

  const humanized = humanizeText(body);
  const detection = detectText(humanized.text);

  const hook =
    (input.hookId != null ? hookFormulas.find((h) => h.id === input.hookId) : undefined) ??
    (input.idea ? suggestHooks(input.idea, 1).recommended : null) ??
    null;

  const trimmed = humanized.text.trim();
  const withTags = keptHashtags.length ? `${trimmed}\n\n${keptHashtags.join(" ")}` : trimmed;

  return {
    body: trimmed,
    copyReady: withTags,
    hook,
    hookOptions: input.idea ? suggestHooks(input.idea) : { idea: "", suggestions: [], recommended: null },
    humanized,
    detection,
    chars: withTags.length,
    linkComment,
    warnings,
  };
}

// ── li-comment: the nine types ────────────────────────────────────────────────

export interface CommentType {
  id: number;
  name: string;
  when: string;
  shape: string;
}

export const COMMENT_TYPES: CommentType[] = [
  { id: 1, name: "Add a datum", when: "the post makes a claim you can support with a number", shape: "\"We saw the same thing: 40% of our…\"" },
  { id: 2, name: "Add the missing case", when: "the post is right but incomplete", shape: "\"This holds until {condition}. Then…\"" },
  { id: 3, name: "Respectful disagree", when: "you genuinely think it is wrong", shape: "name the agreement first, then the fork" },
  { id: 4, name: "Extend one line", when: "one sentence in the post is the good one", shape: "quote it, then build on it" },
  { id: 5, name: "Ask the real question", when: "the post skipped the hard part", shape: "one specific question, no \"curious to hear\"" },
  { id: 6, name: "The receipt", when: "you have done the thing they described", shape: "what happened, in two sentences" },
  { id: 7, name: "The correction", when: "there is a factual error", shape: "be right, be brief, be kind, be sure" },
  { id: 8, name: "The reframe", when: "the post has the right facts and the wrong frame", shape: "\"Another way to read this:\"" },
  { id: 9, name: "The one-liner", when: "the post needs nothing, you want presence", shape: "under 12 words, funny or true" },
];

/**
 * Pick two comment types that fit a pasted post. Never defaults to a generic
 * "Great post" — the whole point of the type list.
 */
export function suggestCommentTypes(post: string): { types: CommentType[]; guidance: string[] } {
  const hasNumber = /\d/.test(post);
  const hasClaim = /\b(always|never|everyone|most people|the best|the worst)\b/i.test(post);
  const hasQuestion = /\?/.test(post);
  const isLong = wordCount(post) > 120;

  const picks: number[] = [];
  if (hasNumber) picks.push(6, 1);
  if (hasClaim) picks.push(3, 8);
  if (isLong) picks.push(4, 5);
  if (hasQuestion) picks.push(5, 2);
  if (!picks.length) picks.push(4, 5, 9);

  const unique = [...new Set(picks)].slice(0, 2);
  const types = unique
    .map((id) => COMMENT_TYPES.find((t) => t.id === id))
    .filter((t): t is CommentType => Boolean(t));

  return {
    types,
    guidance: [
      "2 to 4 sentences. Longer reads as a hijack.",
      "Never open with \"Great post\", \"Love this\", \"So true\" or an emoji.",
      "One idea. Never restate the post.",
      "Humanize before posting — a short comment shows an em dash instantly.",
    ],
  };
}

/** Clean and score a comment draft (2–4 sentences). Returns a receipt too. */
export function prepareComment(body: string): DraftPostResult["detection"] & {
  text: string;
  report: HumanizeResult["report"];
  words: number;
} {
  const humanized = humanizeText(body);
  const detection = detectText(humanized.text);
  return { ...detection, text: humanized.text.trim(), report: humanized.report, words: wordCount(humanized.text) };
}

// ── li-reply: triage ──────────────────────────────────────────────────────────

const LEAD_SIGNALS = [
  /\bsame (problem|issue|thing)\b/i,
  /\bhow (did|do) you\b/i,
  /\b(we'?re|i'?m) struggling\b/i,
  /\bneed help\b/i,
  /\blooking for\b/i,
  /\binterested in\b/i,
  /\bcan you help\b/i,
  /\bwhat would you\b/i,
  /\bwe have the same\b/i,
];

const NOISE_SIGNALS = [
  /\bcheck (out|this out)\b.*\b(my|our|new)\b/i,
  // "Check my profile / bio / link …" pitch that never says "check out".
  /\b(check|see|visit)\s+(my|our)\s+(profile|bio|link|page|website|channel|course|newsletter)\b/i,
  /\bwe (help|specialize)\b/i,
  /\bbook a (call|demo)\b/i,
  /\bDM me\b/i,
  /\bguaranteed (results|growth)\b/i,
  /\bhttps?:\/\/\S+/i,
];

const SUPPORT_SIGNALS = [
  /^(great|nice|love|awesome|amazing|excellent|wonderful|fantastic)\b/i,
  /\b(well said|so true|couldn'?t agree more|congrats|thanks for sharing|this resonates)\b/i,
];

/**
 * Sort comments into the pack's five buckets. Heuristic and content-only — the
 * skill's version uses names and roles the paste may not carry.
 */
export function triageReplies(
  comments: Array<{ author?: string; text: string }>,
): TriagedComment[] {
  return comments.map((comment) => {
    const text = comment.text.trim();
    const words = wordCount(text);

    if (NOISE_SIGNALS.some((re) => re.test(text))) {
      return { ...comment, text, bucket: "NOISE", reason: "pitch or spam — replying gives it reach" };
    }
    if (LEAD_SIGNALS.some((re) => re.test(text))) {
      return { ...comment, text, bucket: "LEAD", reason: "describes the problem you solve" };
    }
    // A disagreement or a datum is substance regardless of length — the skill
    // treats "disagrees" and "adds data" as the same bucket.
    if (
      /\b(disagree|however|actually|data|research)\b/i.test(text) ||
      (words >= 25 && /\d/.test(text))
    ) {
      return { ...comment, text, bucket: "SUBSTANCE", reason: "adds data, disagrees or extends" };
    }
    if (SUPPORT_SIGNALS.some((re) => re.test(text)) || words <= 5) {
      return { ...comment, text, bucket: "SUPPORT", reason: "acknowledgement, not a conversation" };
    }
    if (/\bwe\b|\bour team\b|\bi built\b|\bi run\b/i.test(text)) {
      return { ...comment, text, bucket: "PEER", reason: "a peer worth being seen next to" };
    }
    return { ...comment, text, bucket: "SUBSTANCE", reason: "general comment — worth a real reply" };
  });
}

/** How each bucket should be answered, from the li-reply skill. */
export const REPLY_GUIDANCE: Record<ReplyBucket, string> = {
  LEAD: "Answer fully in public. The open door is one sentence at the end — an offer of help, not a pitch.",
  SUBSTANCE: "The longest reply on the thread. Engage the actual point.",
  PEER: "Give them something: a number, a template, a name.",
  SUPPORT: "A like, and a 3–8 word reply at most.",
  NOISE: "Nothing, or one line and out. Replying gives it reach.",
};

// ── li-dm: invite note, first message, two follow-ups ────────────────────────

export interface DmInput {
  name: string;
  /** The specific reason to reach out now (a post, a launch, a mutual). */
  reference: string;
  /** One line of who the sender is. */
  who: string;
  /** What the sender wants: conversation, referral, job, sale. */
  goal: "conversation" | "referral" | "job" | "sale";
  /** Something to give before asking (from the first message). */
  give?: string;
}

export interface DmOutput {
  inviteNote: string;
  inviteChars: number;
  inviteOverLimit: boolean;
  firstMessage: string;
  followUp4Days: string;
  followUp10Days: string;
  warnings: string[];
  humanized: HumanizeResult;
}

const ASK_BY_GOAL: Record<DmInput["goal"], string> = {
  conversation: "Worth a 15-minute call?",
  referral: "Any pointers on who to talk to next?",
  job: "Worth a quick chat about the role?",
  sale: "Worth a 15-minute call to see if it fits?",
};

/** Assemble the outreach sequence, humanized, with the packed character count. */
export function buildDm(input: DmInput): DmOutput {
  const warnings: string[] = [];
  const invite = `${input.reference} — ${input.who}. Would like to follow along.`;

  if (invite.length > 200) {
    warnings.push("Invite note exceeds LinkedIn's 200-character limit — trim the reference.");
  }
  if (/i hope this message finds you well/i.test(invite)) {
    warnings.push("Never open with \"I hope this message finds you well\".");
  }

  const give = input.give ?? "a template that cut the same step for us";
  const first =
    `${input.reference} — following up on the note. ${give[0].toUpperCase()}${give.slice(1)} ` +
    `helped us. ${ASK_BY_GOAL[input.goal]}`;

  const followUp4Days =
    `Adding something new rather than bumping this: we shipped ${give} since we last spoke, ` +
    `and the first result was easy to measure. Still happy to compare notes.`;

  const followUp10Days =
    `I'll stop here so I'm not cluttering your inbox. If it's ever useful, my door is open — ` +
    `no pitch attached.`;

  // Every field ships humanized — the pack's rule for DMs as much as posts.
  const inviteNote = humanizeText(invite).text.trim();
  const humanized = humanizeText([invite, first, followUp4Days, followUp10Days].join("\n\n"));

  return {
    inviteNote,
    inviteChars: inviteNote.length,
    inviteOverLimit: inviteNote.length > 200,
    firstMessage: humanizeText(first).text.trim(),
    followUp4Days: humanizeText(followUp4Days).text.trim(),
    followUp10Days: humanizeText(followUp10Days).text.trim(),
    warnings,
    humanized,
  };
}

// ── li-plan: the week ─────────────────────────────────────────────────────────

export const PLAN_SLOT_TYPES = ["PROOF", "OPINION", "TEACH", "STORY", "OFFER"] as const;
export type PlanSlotType = (typeof PLAN_SLOT_TYPES)[number];

export interface PlanInput {
  /** ISO date of the Monday, or today's week. */
  weekOf?: string;
  /** Angles that actually happened this week. */
  angles: Array<{ type: PlanSlotType; angle: string; hookId?: number }>;
  /** Timezone label for the posting window. */
  audienceTimezone?: string;
}

export interface PlanSlot {
  day: string;
  time: string;
  type: PlanSlotType;
  hookId: number | null;
  angle: string;
}

/**
 * Lay the week out. Four posts beat seven; the skill's shape is Proof, Opinion,
 * Teach weekly with Story/Offer fortnightly. Times are the B2B default.
 */
export function buildPlan(input: PlanInput): { weekOf: string; slots: PlanSlot[]; note: string } {
  const weekOf = input.weekOf ?? mondayOf(new Date());
  const defaults: Record<PlanSlotType, { day: string; time: string }> = {
    PROOF: { day: "TUE", time: "8:15am" },
    OPINION: { day: "THU", time: "8:00am" },
    TEACH: { day: "FRI", time: "8:30am" },
    STORY: { day: "SUN", time: "4:00pm" },
    OFFER: { day: "MON", time: "9:00am" },
  };

  const slots: PlanSlot[] = input.angles.map((entry) => ({
    day: defaults[entry.type].day,
    time: defaults[entry.type].time,
    type: entry.type,
    hookId: entry.hookId ?? suggestHooks(entry.angle, 1).recommended?.id ?? null,
    angle: entry.angle,
  }));

  const tz = input.audienceTimezone ?? "your audience's timezone";
  return {
    weekOf,
    slots,
    note:
      `Times are the B2B default (${tz}). The day and hour matter far less than whether ` +
      "the first line is good — fix the hook before optimising the clock.",
  };
}

function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

// ── li-profile: rubric ────────────────────────────────────────────────────────

export interface ProfileScoreInput {
  /** Map of rubric item id → points awarded (0–item.points). */
  scores: Record<string, number>;
}

export interface ProfileScoreResult {
  total: number;
  max: number;
  rows: Array<{ item: RubricItem; score: number; note: string }>;
  /** Items that lost the most points, in fix-first order. */
  fixFirst: RubricItem[];
}

/** Score a profile against the vendored 12-item rubric. */
export function scoreProfile(input: ProfileScoreInput): ProfileScoreResult {
  const rows = rubric.items.map((item) => {
    const raw = input.scores[item.id] ?? 0;
    const score = Math.max(0, Math.min(item.points, raw));
    return { item, score, note: `${score}/${item.points}` };
  });

  const total = rows.reduce((a, r) => a + r.score, 0);
  const fixFirst = [...rows]
    .sort((a, b) => b.item.points - b.score - (a.item.points - a.score))
    .filter((r) => r.score < r.item.points)
    .slice(0, 6)
    .map((r) => r.item);

  return { total, max: rubric.total, rows, fixFirst };
}
