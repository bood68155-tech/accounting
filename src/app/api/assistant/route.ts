import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenants";
import { isDatabaseConfigured } from "@/lib/db";
import { fetchStoreOverview, fetchLedger } from "@/lib/data/repository";
import { buildBalanceSheet } from "@/lib/accounting/balanceSheet";
import { buildIncomeStatementFromOrders } from "@/lib/accounting/incomeStatement";
import { askFinancialAgent, type AgentContext } from "@/lib/ai/agent";

export const dynamic = "force-dynamic";

/**
 * ── AI Financial Assistant endpoint ───────────────────────────────────────────
 * POST { question } → grounded answer over the signed-in tenant's books.
 * Tenant scoping is inherited from the repository (session-bound tenant schema),
 * so the agent can never see another tenant's data.
 */
export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database is not configured — set DATABASE_URL (Neon) in the environment." },
      { status: 503 },
    );
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  }

  const { schema } = await getTenantContext();
  if (!schema) {
    return NextResponse.json(
      { error: "No tenant provisioned for this account — sign out and back in." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Provide a question." }, { status: 400 });
  }

  try {
    // Assemble the agent's grounded context from the same repository the
    // dashboard uses — one source of truth for every number.
    const overview = await fetchStoreOverview();
    const ledger = await fetchLedger(overview.store?.id);

    const ctx: AgentContext = {
      storeName: overview.store?.name ?? "your store",
      currency: overview.store?.currency ?? "USD",
      stats: overview.stats,
      incomeStatement: buildIncomeStatementFromOrders(overview.orders),
      balanceSheet: buildBalanceSheet(ledger),
      monthly: overview.monthly,
      orders: overview.orders,
      journalEntries: ledger,
      store: overview.store,
      products: overview.products,
    };

    const result = await askFinancialAgent(question, ctx);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Assistant failed: ${message}` }, { status: 500 });
  }
}
