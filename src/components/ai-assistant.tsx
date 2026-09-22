"use client";

import { useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "agent";
  text: string;
  source?: string;
}

const STARTERS = [
  "How profitable am I this month?",
  "Forecast my cash flow",
  "Any anomalies in my orders?",
  "What's my cash position?",
  "Where does 'Meta Ads 250' go in the books?",
];

/**
 * Embedded AI Financial Assistant chat. Answers are grounded in the signed-in
 * tenant's ledger via /api/assistant (deterministic tools, optional LLM
 * phrasing when OPENAI_API_KEY is set).
 */
export function AiAssistant({ storeName }: { storeName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      text: `Hello! I'm your AI financial assistant for **${storeName}**. I can analyze profitability, forecast cash flow, detect anomalies, and map transactions to ledger accounts — all from your live books.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(STARTERS);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = (await res.json()) as {
        answer?: string;
        source?: string;
        suggestions?: string[];
        error?: string;
      };

      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: data.answer ?? data.error ?? "Something went wrong — try again.",
          source: data.source,
        },
      ]);
      if (data.suggestions) setSuggestions(data.suggestions);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "agent", text: "Network error — please try again." },
      ]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  return (
    <Card className="flex h-[calc(100vh-11rem)] flex-col">
      <CardHeader className="shrink-0">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
            ✦
          </span>
          <div>
            <CardTitle>AI Financial Assistant</CardTitle>
            <CardDescription>Grounded in your live ledger — never hallucinated numbers</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-emerald-500/15 text-emerald-100"
                    : "border border-zinc-800 bg-zinc-900/60 text-zinc-200",
                )}
              >
                {msg.text}
                {msg.source && (
                  <div className="mt-2">
                    <Badge variant="neutral">grounded: {msg.source}</Badge>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500">
                Analyzing the books…
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 4).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={loading}
                className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about profit, cash flow, anomalies, categorization…"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
