import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenants";
import { getTenantTables, isDatabaseConfigured, tenantDb } from "@/lib/db";
import {
  fetchTelegramBinding,
  mintTelegramLinkToken,
  revokeTelegramLinkTokens,
  unbindTelegramChat,
} from "@/lib/data/telegramLinks";
import { resolveTelegramBotUsername, telegramDeepLink } from "@/lib/notifications/telegram";

export const dynamic = "force-dynamic";

/**
 * /api/notifications/telegram — manage the signed-in owner's Telegram binding.
 *
 *   GET    ?store_id=…  → current connection status (+ bot username)
 *   POST   ?store_id=…  → mint a fresh deep-link token
 *   DELETE ?store_id=…  → unbind this chat
 *
 * Auth is the session, and the store is verified to belong to the caller's
 * tenant schema before anything is written — a `store_id` from another tenant
 * returns 404 rather than binding someone else's store.
 */

interface StoreCheck {
  schema: string;
  storeId: string;
}

/** Resolve + authorize the requested store, or null when it isn't the caller's. */
async function authorizeStore(request: Request): Promise<StoreCheck | { error: string; status: number }> {
  if (!isDatabaseConfigured()) {
    return { error: "Database is not configured.", status: 503 };
  }

  const session = await auth();
  if (!session?.user) return { error: "Sign in to manage notifications.", status: 401 };

  const { schema } = await getTenantContext();
  if (!schema) {
    return { error: "No tenant provisioned for this account — sign out and back in.", status: 409 };
  }

  const storeId = new URL(request.url).searchParams.get("store_id");
  if (!storeId) return { error: "store_id is required.", status: 400 };

  const t = getTenantTables(schema);
  const rows = await tenantDb(schema)
    .select({ id: t.stores.id })
    .from(t.stores)
    .where(eq(t.stores.id, storeId))
    .limit(1);

  if (!rows[0]) return { error: "Store not found.", status: 404 };
  return { schema, storeId };
}

export async function GET(request: Request) {
  const auth_ = await authorizeStore(request);
  if ("error" in auth_) return NextResponse.json({ error: auth_.error }, { status: auth_.status });

  const binding = await fetchTelegramBinding(auth_.schema, auth_.storeId);
  const botUsername = resolveTelegramBotUsername();
  const botConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());

  return NextResponse.json({
    binding,
    connected: Boolean(binding.chat_id),
    bot_username: botUsername,
    bot_configured: botConfigured,
    webhook_configured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
  });
}

export async function POST(request: Request) {
  const auth_ = await authorizeStore(request);
  if ("error" in auth_) return NextResponse.json({ error: auth_.error }, { status: auth_.status });

  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: "Could not resolve your tenant.", status: 409 });
  }

  const botUsername = resolveTelegramBotUsername();
  const { token, expiresAt } = await mintTelegramLinkToken(auth_.schema, tenantId, auth_.storeId);

  // The raw token is returned exactly once — only its hash is stored.
  return NextResponse.json({
    deep_link: telegramDeepLink(botUsername, token),
    expires_at: new Date(expiresAt).toISOString(),
  });
}

export async function DELETE(request: Request) {
  const auth_ = await authorizeStore(request);
  if ("error" in auth_) return NextResponse.json({ error: auth_.error }, { status: auth_.status });

  await unbindTelegramChat(auth_.schema, auth_.storeId);
  // Kill any outstanding link too, so a leaked deep link cannot re-bind later.
  await revokeTelegramLinkTokens(auth_.schema, auth_.storeId);

  return NextResponse.json({ ok: true });
}
