import { describe, expect, it, vi } from "vitest";
import { createVerifiedToken, verifyVerifiedToken } from "@/lib/auth/verification";

/**
 * Unit tests for the HMAC-protected "verified email" token that gates signup
 * and password sign-in after a 6-digit OTP was proven.
 */

describe("verification token", () => {
  it("round-trips a valid token for the same email + purpose", () => {
    const token = createVerifiedToken("Owner@Example.com", "signup");
    expect(verifyVerifiedToken(token, "owner@example.com", "signup")).toBe(true);
  });

  it("is case-insensitive on email", () => {
    const token = createVerifiedToken("user@shop.com", "login");
    expect(verifyVerifiedToken(token, "USER@SHOP.COM", "login")).toBe(true);
  });

  it("rejects a different purpose", () => {
    const token = createVerifiedToken("user@shop.com", "signup");
    expect(verifyVerifiedToken(token, "user@shop.com", "login")).toBe(false);
  });

  it("rejects a different email", () => {
    const token = createVerifiedToken("user@shop.com", "login");
    expect(verifyVerifiedToken(token, "other@shop.com", "login")).toBe(false);
  });

  it("rejects tampered payloads and signatures", () => {
    const token = createVerifiedToken("user@shop.com", "login");
    const [payload, sig] = token.split(".");

    // Flip a character mid-payload (appending is a no-op for base64url decode
    // of a 4-char-aligned payload, so modify the email part instead).
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const flipped = decoded.replace("user", "usfr");
    const tamperedPayload = Buffer.from(flipped).toString("base64url");
    expect(verifyVerifiedToken(`${tamperedPayload}.${sig}`, "user@shop.com", "login")).toBe(false);

    const tamperedSig = `${sig.slice(0, -2)}AA`;
    expect(verifyVerifiedToken(`${payload}.${tamperedSig}`, "user@shop.com", "login")).toBe(false);
  });

  it("rejects garbage and malformed tokens", () => {
    expect(verifyVerifiedToken("", "user@shop.com", "login")).toBe(false);
    expect(verifyVerifiedToken("not-a-token", "user@shop.com", "login")).toBe(false);
    expect(verifyVerifiedToken("a.b.c", "user@shop.com", "login")).toBe(false);
    expect(verifyVerifiedToken("!!!.###", "user@shop.com", "login")).toBe(false);
  });

  it("rejects expired tokens", async () => {
    // The real TTL is 10 minutes; verify the expiry check by monkey-patching
    // Date.now past the token's lifetime.
    const token = createVerifiedToken("user@shop.com", "login");
    const realNow = Date.now();
    const spied = vi.spyOn(Date, "now").mockReturnValue(realNow + 11 * 60_000);
    try {
      expect(verifyVerifiedToken(token, "user@shop.com", "login")).toBe(false);
    } finally {
      spied.mockRestore();
    }
  });
});
