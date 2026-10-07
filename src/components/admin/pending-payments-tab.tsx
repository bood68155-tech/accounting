"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import {
  approvePayment,
  rejectPayment,
  extendSubscription,
} from "@/lib/admin/billing-actions";
import type { AdminBillingData, PendingPayment } from "@/lib/admin/billing-types";
import { formatCurrency, relativeTime } from "@/lib/utils";

const STATUS_BADGE: Record<PendingPayment["status"], "success" | "warning" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export function PendingPaymentsTab({ data }: { data: AdminBillingData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [extendEmail, setExtendEmail] = useState("");
  const [extendMonths, setExtendMonths] = useState(1);

  const pending = data.pendingPayments.filter((p) => p.status === "pending");
  const reviewed = data.pendingPayments.filter((p) => p.status !== "pending");

  async function onApprove(paymentId: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await approvePayment({ paymentId });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage("Payment approved — subscription renewed for 30 days.");
      router.refresh();
    });
  }

  async function onReject(paymentId: string) {
    if (!rejectReason.trim()) {
      setMessage("Rejection reason is required.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await rejectPayment(paymentId, rejectReason);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage("Payment rejected: " + rejectReason);
      setRejectReason("");
      router.refresh();
    });
  }

  async function onExtend(email: string, months: number) {
    setMessage(null);
    const user = data.users.find((u) => u.email === email);
    if (!user) {
      setMessage("User not found.");
      return;
    }
    startTransition(async () => {
      const result = await extendSubscription({ userId: user.id, months });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage("Subscription extended by " + months + " month(s) for " + email + ".");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pending Binance Pay requests</CardTitle>
          <CardDescription>
            TxID submissions waiting for admin approval — approve to renew the subscription for 30 days
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">No pending Binance Pay requests right now.</p>
          ) : (
            <Table>
              <THead>
                <TRow>
                  <THeadCell>User</THeadCell>
                  <THeadCell>Pay ID</THeadCell>
                  <THeadCell>TxID</THeadCell>
                  <THeadCell className="text-right">Amount</THeadCell>
                  <THeadCell>Requested</THeadCell>
                  <THeadCell className="text-right">Actions</THeadCell>
                </TRow>
              </THead>
              <TBody>
                {pending.map((payment) => (
                  <TRow key={payment.id}>
                    <TCell>
                      <p className="font-medium text-zinc-100">{payment.payId}</p>
                      <p className="text-xs text-zinc-500">{payment.userId.slice(0, 8)}…</p>
                    </TCell>
                    <TCell className="font-mono text-xs text-zinc-300">{payment.payId}</TCell>
                    <TCell className="font-mono text-xs text-zinc-100">{payment.txId}</TCell>
                    <TCell className="text-right tabular-nums">
                      {formatCurrency(payment.amountUsd, "USD")}
                    </TCell>
                    <TCell className="text-xs text-zinc-500">{relativeTime(payment.requestedAt)}</TCell>
                    <TCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onApprove(payment.id)}
                          disabled={isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => onReject(payment.id)}
                          disabled={isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    </TCell>
                  </TRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reject reason</CardTitle>
            <CardDescription>
              Used when rejecting the selected pending payment. Leave blank to cancel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Reason (shown to the user)</Label>
              <Input
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. TxID not found on Binance"
                className="h-24 resize-y font-mono text-sm"
              />
            </div>
            {message && (
              <p role="status" className="border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300">
                {message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {reviewed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reviewed requests</CardTitle>
            <CardDescription>Previously approved or rejected Binance Pay requests</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <Table>
              <THead>
                <TRow>
                  <THeadCell>User</THeadCell>
                  <THeadCell>TxID</THeadCell>
                  <THeadCell className="text-right">Amount</THeadCell>
                  <THeadCell>Reviewed</THeadCell>
                  <THeadCell>Status</THeadCell>
                </TRow>
              </THead>
              <TBody>
                {reviewed.map((payment) => (
                  <TRow key={payment.id}>
                    <TCell>
                      <p className="font-medium text-zinc-100">{payment.payId}</p>
                      <p className="text-xs text-zinc-500">{payment.userId.slice(0, 8)}…</p>
                    </TCell>
                    <TCell className="font-mono text-xs text-zinc-100">{payment.txId}</TCell>
                    <TCell className="text-right tabular-nums">
                      {formatCurrency(payment.amountUsd, "USD")}
                    </TCell>
                    <TCell className="text-xs text-zinc-500">
                      {payment.reviewedAt ? relativeTime(payment.reviewedAt) : "—"}
                    </TCell>
                    <TCell>
                      <Badge variant={STATUS_BADGE[payment.status] ?? "neutral"}>
                        {payment.status}
                      </Badge>
                    </TCell>
                  </TRow>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
