import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { LoginSuccessBanner } from "@/components/login-success-banner";

export const metadata: Metadata = { title: "Sign in" };

/**
 * /login — credentials + Google OAuth + 6-digit email OTP.
 * After a successful password reset the user is redirected here with
 * ?reset=success and a confirmation banner is shown above the form.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthForm mode="login" />}>
      <LoginSuccessBanner />
      <AuthForm mode="login" />
    </Suspense>
  );
}
