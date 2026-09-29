import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * ── OTP verification email (React Email + Resend) ─────────────────────────────
 * Rendered server-side and passed to `resend.emails.send({ react })` — the
 * canonical Resend/Next.js pattern. Dark theme matches the app UI.
 */

export interface OtpEmailProps {
  code: string;
  purpose: "signup" | "login" | "password_reset";
  minutes: number;
  appName?: string;
}

export function OtpEmail({
  code,
  purpose,
  minutes,
  appName = "X — Automated AI Accounting",
}: OtpEmailProps) {
  const isReset = purpose === "password_reset";
  const action = isReset ? "reset your password" : purpose === "signup" ? "create your account" : "sign in";
  return (
    <Html>
      <Head />
      <Preview>{isReset ? "Reset your password" : "Your verification code"}: {code}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          background: "#0b0d10",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <Container style={{ maxWidth: 480, margin: "0 auto", padding: "32px 24px" }}>
          <Section
            style={{
              background: "#111318",
              border: "1px solid #27272a",
              borderRadius: 16,
              padding: 32,
            }}
          >
            <Text style={{ margin: "0 0 8px", color: "#a1a1aa", fontSize: 13 }}>{appName}</Text>
            <Heading
              as="h1"
              style={{ margin: "0 0 16px", color: "#fafafa", fontSize: 20, fontWeight: 600 }}
            >
              {isReset ? "Reset your password" : "Verify your email"}
            </Heading>
            <Text style={{ margin: "0 0 20px", color: "#d4d4d8", fontSize: 14, lineHeight: 1.6 }}>
              Use this 6-digit code to {action}:
            </Text>
            <Section
              style={{
                background: "#0b0d10",
                border: "1px solid #27272a",
                borderRadius: 12,
                padding: 16,
                textAlign: "center" as const,
                marginBottom: 20,
              }}
            >
              <Text
                style={{
                  margin: 0,
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: 8,
                  color: "#34d399",
                }}
              >
                {code}
              </Text>
            </Section>
            <Text style={{ margin: 0, color: "#71717a", fontSize: 12, lineHeight: 1.6 }}>
              This code expires in {minutes} minutes and can be used once. If you didn&apos;t
              request it, you can safely ignore this email
              {isReset ? " — your password will remain unchanged." : "."}
            </Text>
          </Section>
          <Hr style={{ border: "none", borderTop: "1px solid #27272a", margin: "24px 0 0" }} />
          <Text style={{ margin: "12px 0 0", color: "#52525b", fontSize: 11, textAlign: "center" as const }}>
            You are receiving this email because a verification code was requested for this address.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default OtpEmail;
