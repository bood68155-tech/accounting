import type { BalanceSheet, IncomeStatement, JournalEntry, Order, Product, StoreStats, Store } from "@/types";
import { categorizeTransaction, detectAnomalies, forecastCashFlow } from "@/lib/ai/categorizer";
import { generateInsights } from "@/lib/ai/insights";
import { runDeepStoreResearch } from "@/lib/analytics/storeResearch";
import { round2 } from "@/lib/utils";

/**
 * ── Embedded AI Financial Agent ───────────────────────────────────────────────
 * Architecture inspired by phidata's agent pattern (model + tools + grounding):
 * the agent has deterministic TOOLS (query the ledger, compute KPIs, forecast,
 * categorize) and an optional LLM layer (OPENAI_API_KEY) that decides which
 * tool answers the question and phrases the result. Without a key, a
 * keyword-router answers from the same tools — so the assistant is always
 * available and always grounded in the tenant's real books. The LLM never sees
 * data from other tenants, and every number it quotes comes from a tool result.
 */

export interface AgentContext {
  storeName: string;
  currency: string;
  stats: StoreStats;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  monthly: Array<{ label: string; key: string; revenue: number; net_profit: number; cogs: number; fees: number }>;
  orders: Order[];
  journalEntries: JournalEntry[];
  /** Optional: store + catalog for deep research (analytics & audit tools). */
  store?: Store | null;
  products?: Product[];
}

export interface AgentAnswer {
  answer: string;
  /** Which grounding source produced the answer (for UI transparency). */
  source: "forecast" | "profitability" | "anomalies" | "ledger" | "categorization" | "general";
  suggestions: string[];
}

/** Everything the agent knows how to do — deterministic tools over the books. */
function buildTools(ctx: AgentContext) {
  return {
    profitability: (): string => {
      const pl = ctx.incomeStatement;
      const cur = ctx.currency;
      return [
        `**Profitability — ${ctx.storeName}**`,
        `• Net revenue: ${pl.revenue.net_revenue.toFixed(2)} ${cur} (sales ${pl.revenue.sales.toFixed(2)} + shipping ${pl.revenue.shipping.toFixed(2)} − discounts ${pl.revenue.discounts.toFixed(2)} − refunds ${pl.revenue.refunds.toFixed(2)})`,
        `• COGS: ${pl.cogs.toFixed(2)} ${cur} → gross profit ${pl.gross_profit.toFixed(2)} (${(pl.gross_margin * 100).toFixed(1)}% margin)`,
        `• Operating expenses: ${pl.operating_expenses.total.toFixed(2)} ${cur} (fees ${pl.operating_expenses.payment_fees.toFixed(2)}, shipping ${pl.operating_expenses.shipping_cost.toFixed(2)}, marketing ${pl.operating_expenses.marketing.toFixed(2)})`,
        `• **True net profit: ${pl.net_profit.toFixed(2)} ${cur} (${(pl.net_margin * 100).toFixed(1)}% net margin)**`,
      ].join("\n");
    },

    balance: (): string => {
      const bs = ctx.balanceSheet;
      const cur = ctx.currency;
      return [
        `**Balance sheet as of ${bs.as_of}**`,
        `• Assets: cash ${bs.assets.cash.toFixed(2)}, receivables ${bs.assets.accounts_receivable.toFixed(2)}, inventory ${bs.assets.inventory.toFixed(2)} → total ${bs.assets.total_assets.toFixed(2)} ${cur}`,
        `• Liabilities: payables ${bs.liabilities.accounts_payable.toFixed(2)}, sales tax ${bs.liabilities.sales_tax_payable.toFixed(2)} → total ${bs.liabilities.total_liabilities.toFixed(2)} ${cur}`,
        `• Equity: owner ${bs.equity.owners_equity.toFixed(2)} + retained earnings ${bs.equity.retained_earnings.toFixed(2)} → total ${bs.equity.total_equity.toFixed(2)} ${cur}`,
        bs.balances ? `• ✓ The identity holds: Assets = Liabilities + Equity.` : `• ⚠ Out of balance — inspect recent journal entries.`,
      ].join("\n");
    },

    forecast: (): string => {
      const f = forecastCashFlow(ctx.orders);
      if (f.projection.length === 0) {
        return "Not enough order history yet for a forecast — connect a store and let a few weeks of orders sync in.";
      }
      const lines = [
        `**Cash-flow forecast (next ${f.projection.length} weeks)**`,
        ...f.projection.map(
          (p) => `• Week of ${p.week}: ${p.net >= 0 ? "+" : ""}${p.net.toFixed(2)} ${ctx.currency} (range ${p.low.toFixed(2)} → ${p.high.toFixed(2)})`,
        ),
        `• Horizon total: **${f.horizonNet >= 0 ? "+" : ""}${f.horizonNet.toFixed(2)} ${ctx.currency}**`,
        `• Model: ${f.method}.`,
      ];
      return lines.join("\n");
    },

    anomalies: (): string => {
      const found = detectAnomalies(ctx.orders);
      if (found.length === 0) {
        return "No anomalies detected — order values, margins and refund rates all look normal. 🎉";
      }
      return [
        `**${found.length} anomal${found.length === 1 ? "y" : "ies"} detected**`,
        ...found.map((a) => `• [${a.severity.toUpperCase()}] ${a.title} — ${a.detail}`),
      ].join("\n");
    },

    ledger: (question: string): string => {
      const q = question.toLowerCase();
      // Top accounts by movement.
      const byAccount = new Map<string, { name: string; debit: number; credit: number }>();
      for (const entry of ctx.journalEntries) {
        for (const line of entry.lines) {
          const acc = byAccount.get(line.account_code) ?? { name: line.account_name, debit: 0, credit: 0 };
          acc.debit = round2(acc.debit + line.debit);
          acc.credit = round2(acc.credit + line.credit);
          byAccount.set(line.account_code, acc);
        }
      }
      const entries = ctx.journalEntries.length;
      if (q.includes("how many") || q.includes("entries") || q.includes("journal")) {
        const debits = [...byAccount.values()].reduce((s, a) => s + a.debit, 0);
        return [
          `**Journal overview**`,
          `• ${entries} journal entr${entries === 1 ? "y" : "ies"} posted, ${ctx.orders.length} orders booked.`,
          `• Total debits = total credits = ${debits.toFixed(2)} ${ctx.currency} (always balanced — double-entry).`,
          `• Most active accounts: ${[...byAccount.entries()]
            .sort((a, b) => b[1].debit + b[1].credit - (a[1].debit + a[1].credit))
            .slice(0, 3)
            .map(([code, a]) => `${code} ${a.name}`)
            .join(", ")}.`,
        ].join("\n");
      }
      // Account-specific lookup.
      const match = [...byAccount.entries()].find(([code, a]) =>
        q.includes(code) || q.includes(a.name.toLowerCase().split(" ")[0]),
      );
      if (match) {
        const [code, a] = match;
        const normal = a.debit - a.credit;
        return `**${code} — ${a.name}**: debits ${a.debit.toFixed(2)}, credits ${a.credit.toFixed(2)}, net ${normal.toFixed(2)} ${ctx.currency}.`;
      }
      return `The ledger has ${entries} entries. Ask about a specific account (e.g. "How much cash?", "What's in inventory?") or the journal overall.`;
    },

    categorize: (question: string): string => {
      // "Where does 'Meta Ads invoice 250' go?" → account mapping suggestion.
      const cleaned = question
        .replace(/^(where (does|do)|categorize|classify|map)\s*/i, "")
        .replace(/[?"']/g, "")
        .trim();
      if (!cleaned) {
        return "Give me a transaction description (e.g. \"Meta Ads charge 250\") and I'll map it to a ledger account.";
      }
      const amountMatch = cleaned.match(/(-?\d+(?:\.\d+)?)/);
      const amount = amountMatch ? Number.parseFloat(amountMatch[1]) : 0;
      const description = cleaned.replace(/-?\d+(?:\.\d+)?/, "").trim();
      const result = categorizeTransaction(description, amount, "manual");
      return [
        `**Suggested mapping**`,
        `• "${description}" → **${result.accountCode} ${result.accountName}**`,
        `• Confidence: ${(result.confidence * 100).toFixed(0)}% — ${result.reason}`,
      ].join("\n");
    },

    analytics: (): string => {
      if (!ctx.store) return "Connect a store first — deep analytics need a live store to analyze.";
      const a = runDeepStoreResearch(ctx.store, ctx.orders, ctx.products ?? [], ctx.journalEntries).analytics;
      const cur = ctx.currency;
      const lines = [
        `**Deep analytics — ${ctx.storeName} (last ${a.periodDays}d, ${a.ordersAnalyzed} orders)**`,
        `• Gross margin ${(a.grossMargin * 100).toFixed(1)}% · net margin ${(a.netMargin * 100).toFixed(1)}% · AOV ${a.aov.toFixed(2)} ${cur}`,
        `• Cost structure: COGS ${(a.cogsRate * 100).toFixed(0)}% + fees ${(a.feeRate * 100).toFixed(1)}% of net sales; refunds ${(a.refundRate * 100).toFixed(1)}% of gross`,
      ];
      if (a.roas != null) {
        lines.push(`• ROAS: ${a.roas.toFixed(2)}× (net sales ÷ ${a.adSpend.amount?.toFixed(0)} ${cur} ad spend)`);
      } else {
        lines.push(`• ROAS: placeholder — connect ad spend (store.config.adSpend or an ads integration) to unlock it.`);
      }
      if (a.topSkus.length > 0) {
        lines.push(
          `• Top SKUs: ${a.topSkus.slice(0, 3).map((s) => `${s.name} (${s.revenue.toFixed(0)} ${cur}, ${(s.margin * 100).toFixed(0)}% margin)`).join(" · ")}`,
        );
      }
      if (a.lossMakingSkus.length > 0) {
        lines.push(`• ⚠ Loss makers: ${a.lossMakingSkus.slice(0, 3).map((s) => `${s.name} (${s.profit.toFixed(0)} ${cur})`).join(" · ")}`);
      }
      for (const w of a.inventoryWarnings.slice(0, 3)) lines.push(`• [${w.severity.toUpperCase()}] ${w.title}`);
      return lines.join("\n");
    },

    audit: (): string => {
      if (!ctx.store) return "Connect a store first — the audit runs over a live store's orders, catalog and ledger.";
      const report = runDeepStoreResearch(ctx.store, ctx.orders, ctx.products ?? [], ctx.journalEntries).audit;
      const head = `**Store health audit — score ${report.healthScore}/100 (grade ${report.healthGrade})**`;
      const lines = report.findings.map((f) => {
        const mark = f.severity === "pass" ? "✓" : f.severity === "critical" ? "⛔" : f.severity === "warning" ? "⚠" : "ℹ";
        return `${mark} ${f.title}${f.severity !== "pass" && f.recommendation ? `\n   ↳ ${f.recommendation}` : ""}`;
      });
      return [head, ...lines].join("\n");
    },

    overview: (): string => {
      const insights = generateInsights({
        stats: ctx.stats,
        incomeStatement: ctx.incomeStatement,
        balanceSheet: ctx.balanceSheet,
        monthly: ctx.monthly,
        orders: ctx.orders,
        journalEntries: ctx.journalEntries,
        forecast: forecastCashFlow(ctx.orders),
        anomalies: detectAnomalies(ctx.orders),
        storeName: ctx.storeName,
        currency: ctx.currency,
      });
      const cur = ctx.currency;
      const head = `**${ctx.storeName} — financial overview**\n• Revenue (30d): ${ctx.stats.period_revenue.toFixed(2)} ${cur} · True net profit: ${ctx.stats.period_net_profit.toFixed(2)} ${cur} · ${ctx.stats.period_orders} orders`;
      const bullets = insights.slice(0, 4).map((i) => `• ${i.title}: ${i.body}`);
      return [head, ...bullets].join("\n");
    },
  };
}

/** Keyword router for the no-LLM path — maps questions to tools. */
function routeQuestion(question: string): keyof ReturnType<typeof buildTools> | "unknown" {
  const q = question.toLowerCase();
  if (/\b(forecast|predict|next week|next month|projection|cash flow|cashflow)\b/.test(q)) return "forecast";
  if (/\b(anomal|unusual|spike|suspicious|outlier|below cost|refund rate)\b/.test(q)) return "anomalies";
  if (/\b(balance sheet|assets|liabilit|equity|receivable|payable|inventory value|retained)\b/.test(q)) return "balance";
  if (/\b(categorize|classify|which account|map .*(transaction|expense)|where does)\b/.test(q)) return "categorize";
  if (/\b(journal|entries|ledger|how many)\b/.test(q)) return "ledger";
  if (/\b(profit|margin|revenue|cogs|fees|p&l|income|earn)\b/.test(q)) return "profitability";
  if (/\b(deep analytics|top (products|skus|sellers)|sku performance|roas|ad spend|best seller|loss maker|inventory warning)\b/.test(q)) return "analytics";
  if (/\b(audit|store health|health score|health check|missing cogs|missing cost|below cost|catalog coverage)\b/.test(q)) return "audit";
  if (/\b(overview|summary|how am i|how are we|status|health)\b/.test(q)) return "overview";
  return "unknown";
}

const DEFAULT_SUGGESTIONS = [
  "How profitable am I this month?",
  "Forecast my cash flow",
  "Any anomalies in my orders?",
  "Run a store health audit",
  "What are my top SKUs?",
];

export async function askFinancialAgent(question: string, ctx: AgentContext): Promise<AgentAnswer> {
  const tools = buildTools(ctx);

  const suggestionsFor = (source: AgentAnswer["source"]): string[] => {
    switch (source) {
      case "forecast":
        return ["Any anomalies I should know about?", "How profitable am I?", "What's my cash position?"];
      case "anomalies":
        return ["Forecast my cash flow", "How profitable am I?", "Show my balance sheet"];
      case "ledger":
        return ["Forecast my cash flow", "How profitable am I?", "Give me an overview"];
      case "categorization":
        return ["How profitable am I?", "Any anomalies?", "Give me an overview"];
      case "ledger":
        return ["What's my cash position?", "How profitable am I?", "Give me an overview"];
      default:
        return DEFAULT_SUGGESTIONS;
    }
  };

  // Optional LLM path — used only when a key is configured. The LLM receives
  // the SAME deterministic tool outputs (never raw data), so its answer stays
  // grounded. Failure falls back to the router silently.
  if (process.env.OPENAI_API_KEY) {
    try {
      const route = routeQuestion(question);
      const grounded =
        route === "forecast"
          ? tools.forecast()
          : route === "anomalies"
            ? tools.anomalies()
            : route === "balance"
              ? tools.balance()
              : route === "categorize"
                ? tools.categorize(question)
                : route === "ledger"
                  ? tools.ledger(question)
                  : route === "audit"
                    ? tools.audit()
                    : route === "analytics"
                      ? tools.analytics()
                      : route === "profitability"
                        ? tools.profitability()
                        : tools.overview();

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content:
                "You are an embedded financial analyst inside an accounting app. Answer using ONLY the grounded data provided. Be concise (≤120 words), use bullet points, quote exact numbers with currency. Never invent numbers.",
            },
            { role: "user", content: `Question: ${question}\n\nGrounded data:\n${grounded}` },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content?.trim();
        if (content) {
          return {
            answer: content,
            source: route === "unknown" ? "general" : (route as AgentAnswer["source"]),
            suggestions: suggestionsFor(route === "unknown" ? "general" : (route as AgentAnswer["source"])),
          };
        }
      }
    } catch {
      // fall through to the deterministic router
    }
  }

  // Deterministic router (default — no API key needed).
  const route = routeQuestion(question);
  switch (route) {
    case "forecast":
      return { answer: tools.forecast(), source: "forecast", suggestions: suggestionsFor("forecast") };
    case "anomalies":
      return { answer: tools.anomalies(), source: "anomalies", suggestions: suggestionsFor("anomalies") };
    case "balance":
      return { answer: tools.balance(), source: "ledger", suggestions: suggestionsFor("ledger") };
    case "categorize":
      return { answer: tools.categorize(question), source: "categorization", suggestions: suggestionsFor("categorization") };
    case "ledger":
      return { answer: tools.ledger(question), source: "ledger", suggestions: suggestionsFor("ledger") };
    case "profitability":
      return { answer: tools.profitability(), source: "profitability", suggestions: suggestionsFor("profitability") };
    case "analytics":
      return { answer: tools.analytics(), source: "profitability", suggestions: ["Run a store health audit", "Any anomalies?", "Forecast my cash flow"] };
    case "audit":
      return { answer: tools.audit(), source: "anomalies", suggestions: ["What are my top SKUs?", "How profitable am I?", "Give me an overview"] };
    case "overview":
      return { answer: tools.overview(), source: "general", suggestions: suggestionsFor("general") };
    default:
      return {
        answer: [
          `I can answer questions about **${ctx.storeName}'s books**. Try:`,
          ...DEFAULT_SUGGESTIONS.map((s) => `• ${s}`),
        ].join("\n"),
        source: "general",
        suggestions: DEFAULT_SUGGESTIONS,
      };
  }
}
