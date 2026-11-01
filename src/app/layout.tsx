import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Canonical origin. Override with NEXT_PUBLIC_SITE_URL when the app moves to a
 * custom domain — every absolute URL in the metadata tags derives from it. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://accounting-nu-teal.vercel.app";

const TITLE = "NUV Accounting — Automated AI Accounting for E-commerce";
const DESCRIPTION =
  "NUV Accounting connects your store, computes true net profit (item cost, shipping & gateway fees), and automates double-entry bookkeeping with income statements.";

/** 1200×630 still of the shipped dashboard overview — the card WhatsApp,
 * Telegram, Slack and X render when the production link is shared. */
const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "NUV Accounting dashboard: revenue, true net profit, orders and net margin for the last 30 days, with a bar chart of the period's takings.",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · NUV Accounting",
  },
  description: DESCRIPTION,
  applicationName: "NUV Accounting",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "NUV Accounting",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
