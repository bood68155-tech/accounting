"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconBell, IconCheck, IconExternal, IconRefresh, IconX } from "@/components/icons";

/**
 * ── Telegram connection card ────────────────────────────────────────────────
 * Brutalist card matching the settings page: flat black, 1px white frame, zero
 * radius, uppercase micro-labels, signal-red only on the primary action.
 *
 * The handshake is a deep link, so the button opens `t.me/<bot>?start=<token>`
 * in a new tab. Telegram confirms the subscription *inside the bot chat*, not in
 * this tab, so this card polls the status endpoint until the binding appears —
 * without polling, pressing the button would appear to do nothing.
 */

interface Binding {
  chat_id: string | null;
  chat_title: string | null;
  username: string | null;
  linked_at: string | null;
  bot_username: string | null;
}

interface StatusResponse {
  binding: Binding;
  connected: boolean;
  bot_username: string | null;
  bot_configured: boolean;
  webhook_configured: boolean;
}

/** How often to re-check after opening the deep link. */
const POLL_INTERVAL_MS = 3000;
/** Give up after ~1 minute; Telegram binding is near-instant when it works. */
const POLL_TIMEOUT_MS = 60_000;

export function TelegramConnectCard({
  storeId,
  storeName,
}: {
  /**
   * Store the chat binds to. Omitted when the owner has no store yet — the card
   * still renders (so the feature is discoverable) but explains what to do
   * instead of calling an endpoint that would 400.
   */
  storeId?: string;
  /** Shown as a kicker when one page renders a card per store. */
  storeName?: string;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [awaitingBind, setAwaitingBind] = useState(false);

  const endpoint = storeId
    ? `/api/notifications/telegram?store_id=${encodeURIComponent(storeId)}`
    : null;

  const loadStatus = useCallback(async (): Promise<StatusResponse | null> => {
    if (!endpoint) return null;
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as StatusResponse;
    } catch {
      return null;
    }
  }, [endpoint]);

  useEffect(() => {
    // Nothing to check without a store. `loading` is left untouched here on
    // purpose — the card renders a "Needs a store" badge instead, so it never
    // sits on "Checking…" forever, and no setState runs synchronously.
    if (!endpoint) return;
    let cancelled = false;
    (async () => {
      const data = await loadStatus();
      if (cancelled) return;
      if (data) setStatus(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatus, endpoint]);

  /**
   * While the deep link is open, poll for the binding. Stops on success, on
   * timeout, and on unmount.
   */
  useEffect(() => {
    if (!awaitingBind) return;
    const startedAt = Date.now();

    const timer = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setAwaitingBind(false);
        setNotice("Still waiting. Finish connecting in Telegram, then refresh this page.");
        return;
      }
      const data = await loadStatus();
      if (data?.connected) {
        setStatus(data);
        setAwaitingBind(false);
        setNotice("Connected. Your daily digest will arrive in Telegram each morning.");
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [awaitingBind, loadStatus]);

  async function connect(): Promise<void> {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { deep_link?: string; error?: string };
      if (!res.ok || !data.deep_link) {
        setError(data.error ?? "Could not create a connection link.");
        setBusy(false);
        return;
      }
      // Open the deep link; Telegram handles the rest in its own UI.
      window.open(data.deep_link, "_blank", "noopener,noreferrer");
      setAwaitingBind(true);
      setNotice("Finish the connection inside Telegram — this card updates automatically.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not disconnect.");
        setBusy(false);
        return;
      }
      const fresh = await loadStatus();
      setStatus(fresh);
      setNotice("Disconnected. No further digests will be sent to this chat.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(status?.connected);
  const binding = status?.binding;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {storeName && <p className="type-kicker text-zinc-600">{storeName}</p>}
            <CardTitle className="flex items-center gap-2">
              <IconBell className="h-4 w-4" />
              Telegram
            </CardTitle>
            <CardDescription>
              Receive the daily accounting digest — revenue, profit, cash and tax — in Telegram.
            </CardDescription>
          </div>
          {!storeId ? (
            <Badge variant="warning">Needs a store</Badge>
          ) : loading ? (
            <Badge variant="neutral">Checking…</Badge>
          ) : connected ? (
            <Badge variant="success">
              <IconCheck className="h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="neutral">Not Connected</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Connected state: who is bound, and since when. */}
        {connected && binding ? (
          <dl className="grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
            <div className="bg-black p-3">
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">Chat</dt>
              <dd className="mt-1 truncate text-sm text-white">
                {binding.chat_title ?? binding.username ?? `Chat ${binding.chat_id}`}
              </dd>
            </div>
            <div className="bg-black p-3">
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">Chat ID</dt>
              <dd className="mt-1 font-mono text-sm text-white">{binding.chat_id}</dd>
            </div>
            <div className="bg-black p-3">
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">Linked</dt>
              <dd className="mt-1 text-sm text-white">
                {binding.linked_at ? new Date(binding.linked_at).toLocaleDateString("en-US") : "—"}
              </dd>
            </div>
          </dl>
        ) : !storeId ? (
          <div className="border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm text-zinc-300">
              Connect a store first — a Telegram chat is bound to one store at a time. Once your
              store exists this card turns into the connect button.
            </p>
          </div>
        ) : (
          <div className="border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm text-zinc-300">
              Press connect, then press <span className="text-white">Start</span> inside Telegram. Your
              chat is bound to this store only — other tenants never see it.
            </p>
          </div>
        )}

        {/* Server configuration problems, surfaced rather than silently failing. */}
        {status && !status.bot_configured && (
          <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
            <strong>Telegram is not configured on the server.</strong> Set{" "}
            <code className="font-mono">TELEGRAM_BOT_TOKEN</code> to enable this.
          </p>
        )}
        {status?.bot_configured && !status.webhook_configured && (
          <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
            <strong>Webhook secret missing.</strong> Set{" "}
            <code className="font-mono">TELEGRAM_WEBHOOK_SECRET</code> or connecting will be rejected.
          </p>
        )}

        {notice && (
          <p className="border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-200">{notice}</p>
        )}
        {error && (
          <p className="border border-red-500/60 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {!storeId ? (
            <Button variant="outline" size="md" disabled>
              <IconExternal className="h-4 w-4" />
              Connect Telegram Bot
            </Button>
          ) : connected ? (
            <>
              <Button variant="danger" size="sm" onClick={disconnect} disabled={busy}>
                <IconX className="h-3.5 w-3.5" />
                Disconnect
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => routerRefreshStatus(setStatus, loadStatus)}
                disabled={busy}
              >
                <IconRefresh className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </>
          ) : (
            <Button variant="primary" size="md" onClick={connect} disabled={busy || loading}>
              <IconExternal className="h-4 w-4" />
              {busy ? "Opening Telegram…" : "Connect Telegram Bot"}
            </Button>
          )}

          {status?.bot_username && (
            <span className="text-xs text-zinc-500">
              via <span className="font-mono text-zinc-400">@{status.bot_username}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Manual refresh handler kept out of the JSX above to keep the markup readable. */
async function routerRefreshStatus(
  setStatus: (s: StatusResponse | null) => void,
  load: () => Promise<StatusResponse | null>,
): Promise<void> {
  setStatus(await load());
}
