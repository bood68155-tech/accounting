/**
 * ── LinkedIn transport (opt-in) ───────────────────────────────────────────────
 * A thin client over LinkedIn's private "Voyager" REST API, authenticated with
 * the `li_at` session cookie.
 *
 * ⚠️  READ THIS BEFORE ENABLING IT
 * The Voyager endpoints below are UNDOCUMENTED and UNSTABLE. Automating LinkedIn
 * with a browser/session cookie violates LinkedIn's User Agreement and can get
 * the account restricted. The upstream skill deliberately never posts for this
 * reason: it writes, and the human posts. This client exists because the repo
 * owner explicitly asked for it. It is OFF unless
 * `LINKEDIN_AGENT_ENABLE_HTTP=true`, and the safe, default path is the
 * content-generation service in `service.ts`.
 *
 * Because the endpoints are private, treat every method here as best-effort:
 * verify it against your own account and expect to adjust paths/payloads as
 * LinkedIn changes them.
 */
import type { LinkedInAgentConfig } from "./types";

export interface LinkedInHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Minimal injectable `fetch` — compatible with the global. */
export type LinkedInFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<LinkedInHttpResponse>;

/** Thrown when a Voyager request fails or cannot be authenticated. */
export class LinkedInError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "LinkedInError";
    this.status = status;
  }
}

const VOYAGER_BASE = "https://www.linkedin.com/voyager/api";
const RESTLI_PROTOCOL_VERSION = "2.0.0";

const defaultFetch: LinkedInFetch = (url, init) => fetch(url, init);

export interface LinkedInClientOptions {
  config: LinkedInAgentConfig;
  /** Injectable for tests — defaults to the global fetch. */
  fetch?: LinkedInFetch;
  /** Override for staging/tests. */
  baseUrl?: string;
}

export interface SearchPeopleParams {
  keywords: string;
  count?: number;
  start?: number;
}

export class LinkedInClient {
  private readonly cookieHeader: string;
  private readonly csrfToken: string;
  private readonly request: LinkedInFetch;
  private readonly baseUrl: string;

  constructor(options: LinkedInClientOptions) {
    const { liAtCookie, jsessionId } = options.config;
    if (!liAtCookie) {
      throw new LinkedInError(
        "LINKEDIN_LI_AT_COOKIE is not set — the LinkedIn client cannot authenticate.",
      );
    }

    let cookie = `li_at=${liAtCookie}`;
    if (jsessionId) cookie += `; JSESSIONID="${jsessionId}"`;

    this.cookieHeader = cookie;
    // Voyager validates the `csrf-token` header against the JSESSIONID value
    // (with the surrounding quotes stripped). Fall back to li_at when absent.
    this.csrfToken = (jsessionId ?? liAtCookie).replace(/^"|"$/g, "");
    this.request = options.fetch ?? defaultFetch;
    this.baseUrl = options.baseUrl ?? VOYAGER_BASE;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/vnd.linkedin.normalized+json+2.1",
      "content-type": "application/json",
      "csrf-token": this.csrfToken,
      cookie: this.cookieHeader,
      "x-li-lang": "en_US",
      "x-restli-protocol-version": RESTLI_PROTOCOL_VERSION,
      ...extra,
    };
  }

  /** Issue one Voyager request and parse its JSON body. */
  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new LinkedInError(
        `LinkedIn ${method} ${path} failed with status ${response.status}` +
          (detail ? `: ${detail.slice(0, 300)}` : ""),
        response.status,
      );
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /** The signed-in member's own profile id and name. */
  async fetchSelf(): Promise<unknown> {
    return this.call("GET", "/me");
  }

  /** Look up a profile by its public identifier (the part after `/in/`). */
  async fetchProfile(publicId: string): Promise<unknown> {
    const query = new URLSearchParams({
      q: "memberIdentity",
      memberIdentity: publicId,
    });
    return this.call("GET", `/identity/dash/profiles?${query.toString()}`);
  }

  /** People search — the raw material for lead generation. */
  async searchPeople(params: SearchPeopleParams): Promise<unknown> {
    const query = new URLSearchParams({
      keywords: params.keywords,
      q: "all",
      start: String(params.start ?? 0),
      count: String(Math.min(params.count ?? 10, 49)),
      origin: "GLOBAL_SEARCH_HEADER",
    });
    return this.call("GET", `/search/blended?${query.toString()}`);
  }

  /** A member's recent activity, used to ground comments and outreach. */
  async fetchRecentPosts(profileUrn: string, count = 5): Promise<unknown> {
    const query = new URLSearchParams({
      count: String(count),
      q: "memberShareFeed",
      profileUrn,
      moduleKey: "member-shares:phone",
    });
    return this.call("GET", `/feed/updates?${query.toString()}`);
  }

  /**
   * Publish a text post on the authenticated member's profile.
   * Best-effort: the Voyager "normalized content" contract is undocumented.
   */
  async shareTextPost(params: {
    text: string;
    authorUrn: string;
    visibility?: "PUBLIC" | "CONNECTIONS";
  }): Promise<unknown> {
    const visibility = params.visibility ?? "PUBLIC";
    return this.call("POST", "/contentcreation/normalized-content?action=create", {
      author: params.authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: params.text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": visibility },
    });
  }

  /** Comment on a post, given its raw urn (`urn:li:activity:…`). */
  async createComment(params: { postUrn: string; text: string }): Promise<unknown> {
    const encoded = encodeURIComponent(params.postUrn);
    return this.call("POST", `/socialActions/${encoded}/comments`, {
      object: params.postUrn,
      text: params.text,
    });
  }

  /** Start a 1:1 or group conversation with one or more profile urns. */
  async sendMessage(params: { recipientUrns: string[]; text: string }): Promise<unknown> {
    return this.call("POST", "/messaging/conversations?action=create", {
      recipients: params.recipientUrns,
      message: {
        body: { text: params.text },
      },
    });
  }
}
