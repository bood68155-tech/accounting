import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getTenantTables, publicSchema, requireDb, tenantDb } from "@/lib/db";
import {
  createLinkToken,
  describeChat,
  hashLinkToken,
  DEFAULT_LINK_TOKEN_TTL_HOURS,
} from "@/lib/notifications/telegram";
import { UNLINKED_TELEGRAM } from "@/lib/notifications/types";
import type { TelegramChat } from "@/lib/notifications/telegram";

/**
 * ── Telegram link tokens & binding ──────────────────────────────────────────
 * Token rows live in the PUBLIC schema because an inbound Telegram webhook
 * carries no session and therefore no tenant context — the token→tenant mapping
 * has to be resolvable without one, exactly like `store_registry`.
 *
 * Every write below is scoped to a single tenant schema and is only ever reached
 * with a schema name that came from a verified source (a signed token row for
 * webhooks, `getTenantContext()` for the settings UI), never from user input.
 */

export interface MintedLink {
  /** The raw token. Returned once and never persisted in plaintext. */
  token: string;
  /** Epoch millis after which the token stops working. */
  expiresAt: number;
}

/**
 * Mint (or replace) the link token for a store.
 *
 * Replacing rather than accumulating keeps a single live token per store, so an
 * owner who never finishes the flow can simply request a new link and the old
 * one is dead.
 */
export async function mintTelegramLinkToken(
  schemaName: string,
  tenantId: string,
  storeId: string,
  ttlHours: number = DEFAULT_LINK_TOKEN_TTL_HOURS,
): Promise<MintedLink> {
  const token = createLinkToken();
  const expiresAt = Date.now() + Math.max(1, ttlHours) * 3_600_000;

  await requireDb()
    .insert(publicSchema.telegramLinkTokens)
    .values({
      tokenHash: hashLinkToken(token),
      tenantId,
      schemaName,
      storeId,
      expiresAt: new Date(expiresAt),
    })
    // One live token per store: re-minting supersedes the previous link.
    .onConflictDoUpdate({
      target: [publicSchema.telegramLinkTokens.schemaName, publicSchema.telegramLinkTokens.storeId],
      set: {
        tokenHash: sql`excluded.token_hash`,
        expiresAt: new Date(expiresAt),
        usedAt: null,
        boundChatId: null,
        boundChatTitle: null,
        createdAt: new Date(),
      },
    });

  return { token, expiresAt };
}

export interface ResolvedLinkToken {
  tenantId: string;
  schemaName: string;
  storeId: string;
}

/**
 * Resolve an unexpired, unused token to its tenant.
 *
 * Returns null for unknown, expired and already-used tokens — the three cases
 * are deliberately indistinguishable to the caller so the webhook cannot be
 * used to probe which tokens exist.
 */
export async function resolveLinkToken(
  token: string,
): Promise<ResolvedLinkToken | null> {
  const hash = hashLinkToken(token);
  const rows = await requireDb()
    .select({
      tenantId: publicSchema.telegramLinkTokens.tenantId,
      schemaName: publicSchema.telegramLinkTokens.schemaName,
      storeId: publicSchema.telegramLinkTokens.storeId,
    })
    .from(publicSchema.telegramLinkTokens)
    .where(
      and(
        eq(publicSchema.telegramLinkTokens.tokenHash, hash),
        isNull(publicSchema.telegramLinkTokens.usedAt),
        gt(publicSchema.telegramLinkTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Mark a token consumed. A losing race leaves usedAt set and is ignored. */
async function consumeToken(hash: string, chatId: string, chatTitle: string): Promise<void> {
  await requireDb()
    .update(publicSchema.telegramLinkTokens)
    .set({ usedAt: new Date(), boundChatId: chatId, boundChatTitle: chatTitle })
    .where(
      and(
        eq(publicSchema.telegramLinkTokens.tokenHash, hash),
        isNull(publicSchema.telegramLinkTokens.usedAt),
      ),
    );
}

export interface BindResult {
  ok: boolean;
  /** Populated on success — used for the confirmation message. */
  storeName?: string;
  reason?: string;
}

/**
 * Bind a Telegram chat to a store's digest settings and consume the token.
 *
 * Consuming BEFORE writing means a failure can burn a token rather than
 * double-bind it. That is the right trade: the owner can always mint another
 * link, whereas a token that could bind twice could silently reassign a store's
 * digest to an attacker who replayed it.
 */
export async function bindTelegramChat(
  token: string,
  chat: TelegramChat,
  botUsername: string | null,
): Promise<BindResult> {
  const resolved = await resolveLinkToken(token);
  if (!resolved) {
    return { ok: false, reason: "This connection link is invalid or has expired — generate a new one." };
  }

  const chatId = String(chat.id ?? "").trim();
  if (!chatId) return { ok: false, reason: "Telegram did not send a usable chat id." };

  const title = describeChat(chat);

  // A tenant provisioned before this migration has no telegram_* columns; the
  // insert would fail and must not 500 the whole webhook.
  try {
    const db = tenantDb(resolved.schemaName);
    const t = getTenantTables(resolved.schemaName);

    const storeRows = await db
      .select({ id: t.stores.id, name: t.stores.name })
      .from(t.stores)
      .where(eq(t.stores.id, resolved.storeId))
      .limit(1);
    const store = storeRows[0];
    if (!store) {
      return { ok: false, reason: "That store no longer exists." };
    }

    await db
      .insert(t.digestSettings)
      .values({
        storeId: resolved.storeId,
        telegramChatId: chatId,
        telegramChatTitle: title,
        telegramUsername: chat.username ?? null,
        telegramLinkedAt: new Date(),
        telegramBotUsername: botUsername,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: t.digestSettings.storeId,
        set: {
          telegramChatId: chatId,
          telegramChatTitle: title,
          telegramUsername: chat.username ?? null,
          telegramLinkedAt: new Date(),
          telegramBotUsername: botUsername,
          updatedAt: new Date(),
        },
      });

    await consumeToken(hashLinkToken(token), chatId, title);
    return { ok: true, storeName: store.name };
  } catch (error) {
    // Token stays unconsumed so a transient database error can be retried.
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Could not save the connection.",
    };
  }
}

/** Remove a store's Telegram binding. */
export async function unbindTelegramChat(schemaName: string, storeId: string): Promise<void> {
  const db = tenantDb(schemaName);
  const t = getTenantTables(schemaName);

  await db
    .update(t.digestSettings)
    .set({
      telegramChatId: null,
      telegramChatTitle: null,
      telegramUsername: null,
      telegramLinkedAt: null,
      telegramBotUsername: null,
      updatedAt: new Date(),
    })
    .where(eq(t.digestSettings.storeId, storeId));
}

/** Read the binding columns for the settings UI. */
export async function fetchTelegramBinding(
  schemaName: string,
  storeId: string,
): Promise<typeof UNLINKED_TELEGRAM> {
  const db = tenantDb(schemaName);
  const t = getTenantTables(schemaName);

  const rows = await db
    .select({
      chatId: t.digestSettings.telegramChatId,
      chatTitle: t.digestSettings.telegramChatTitle,
      username: t.digestSettings.telegramUsername,
      linkedAt: t.digestSettings.telegramLinkedAt,
      botUsername: t.digestSettings.telegramBotUsername,
    })
    .from(t.digestSettings)
    .where(eq(t.digestSettings.storeId, storeId))
    .limit(1);

  const row = rows[0];
  if (!row) return { ...UNLINKED_TELEGRAM };
  return {
    chat_id: row.chatId,
    chat_title: row.chatTitle,
    username: row.username,
    linked_at: row.linkedAt ? row.linkedAt.toISOString() : null,
    bot_username: row.botUsername,
  };
}

/** Drop any outstanding (unused) tokens for a store. */
export async function revokeTelegramLinkTokens(
  schemaName: string,
  storeId: string,
): Promise<void> {
  await requireDb()
    .delete(publicSchema.telegramLinkTokens)
    .where(
      and(
        eq(publicSchema.telegramLinkTokens.schemaName, schemaName),
        eq(publicSchema.telegramLinkTokens.storeId, storeId),
      ),
    );
}
