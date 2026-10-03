"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion, useScrollProgress } from "./use-scroll-progress";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Normalized 0..1 progress of `p` inside the window [a, b]. */
const range = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

const BANNER_WORDS = ["ACCOUNTING", "FOR", "E-COMMERCE"];
const OUTLINE_LINE = "IS NOT WHAT YOU THINK IT IS.";

/**
 * Kinetic hero — a 340vh scroll stage pinned behind a sticky viewport.
 * Scrolling scrubs one continuous "video": the headline breathes and the
 * camera pulls back, red banner words slam in staggered, the outline line
 * fills with ink, a signal-red wipe sweeps across, then the whole stage
 * contracts and fades to hand off to the dashboard reveal.
 *
 * Every frame writes transform/opacity to refs only (no React re-render).
 */
export function KineticHero() {
  const reduced = usePrefersReducedMotion();

  const stageRef = useRef<HTMLDivElement>(null);
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const line1Ref = useRef<HTMLDivElement>(null);
  const bannerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const line3OutlineRef = useRef<HTMLSpanElement>(null);
  const line3FillRef = useRef<HTMLSpanElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  const rootRef = useScrollProgress((p, velocity) => {
    // Subtle kinetic skew from scroll velocity — the "footage" feel.
    const skew = Math.max(-1.6, Math.min(1.6, velocity * 0.012));

    // 01 — headline breathes out, then the camera pulls back.
    const tUp = easeOut(range(p, 0.0, 0.14));
    const tPull = easeOut(range(p, 0.14, 0.46));
    if (line1Ref.current) {
      const scale = 1 + 0.05 * tUp - 0.42 * tPull;
      line1Ref.current.style.transform = `translate3d(0, ${(-24 * tPull).toFixed(2)}vh, 0) scale(${scale.toFixed(4)}) skewY(${skew.toFixed(2)}deg)`;
      line1Ref.current.style.opacity = String(1 - 0.18 * tPull);
    }
    if (kickerRef.current) {
      kickerRef.current.style.transform = `translate3d(0, ${(-9 * tPull).toFixed(2)}vh, 0)`;
      kickerRef.current.style.opacity = String(1 - 0.55 * range(p, 0.82, 1));
    }

    // 02 — red banner words slam in, staggered from alternating sides.
    BANNER_WORDS.forEach((_, i) => {
      const el = bannerRefs.current[i];
      if (!el) return;
      const a = 0.16 + i * 0.07;
      const t = easeOut(range(p, a, a + 0.24));
      const dir = i % 2 === 0 ? -1 : 1;
      el.style.transform = `translate3d(${((1 - t) * dir * 56).toFixed(1)}px, ${((1 - t) * 112).toFixed(2)}%, 0)`;
    });

    // 03 — outlined line fills with ink, bottom-up.
    const t3 = easeOut(range(p, 0.46, 0.74));
    if (line3OutlineRef.current) line3OutlineRef.current.style.opacity = t3.toFixed(3);
    if (line3FillRef.current) {
      line3FillRef.current.style.clipPath = `inset(0 0 ${(100 - t3 * 100).toFixed(2)}% 0)`;
    }

    // Signal-red wipe sweeps across the stage.
    const tw = range(p, 0.5, 0.72);
    if (wipeRef.current) {
      wipeRef.current.style.opacity = tw > 0 && tw < 1 ? "1" : "0";
      wipeRef.current.style.transform = `translate3d(${(tw * 130 - 15).toFixed(2)}vw, 0, 0) skewY(${skew.toFixed(2)}deg)`;
    }

    // Scroll hint dissolves as soon as motion starts.
    if (hintRef.current) hintRef.current.style.opacity = String(1 - range(p, 0, 0.08));

    // Watermark drifts slower than content — depth without blur.
    if (bgRef.current) bgRef.current.style.transform = `translate3d(0, ${(p * 16).toFixed(2)}vh, 0)`;

    // 04 — stage contracts and fades: hand-off to the dashboard.
    const te = easeOut(range(p, 0.84, 1));
    if (stageRef.current) {
      stageRef.current.style.transform = `scale(${(1 - 0.1 * te).toFixed(4)})`;
      stageRef.current.style.opacity = String(1 - 0.86 * te);
    }
  });

  return (
    <section ref={rootRef} aria-label="Store Accountant manifesto" className="relative h-[340vh]">
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden bg-app">
        {/* Parallax watermark — giant mono-stroke brand mark */}
        <div
          ref={bgRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center will-change-transform"
        >
          <span className="type-display text-outline-faint select-none text-[42vw] leading-none">
            SA
          </span>
        </div>

        <div
          ref={stageRef}
          className="relative mx-auto w-full max-w-7xl px-4 will-change-transform sm:px-6"
        >
          <p ref={kickerRef} className="type-kicker text-accent will-change-transform">
            00 — Store Accountant · Automated AI accounting for e-commerce
          </p>

          <h1 className="mt-5 sm:mt-7">
            <span className="sr-only">
              Store Accountant — Accounting for e-commerce is not what you think it is.
            </span>
            <div
              ref={line1Ref}
              aria-hidden
              className="type-display text-[clamp(3.2rem,12.5vw,11rem)] leading-[0.9] text-white will-change-transform"
            >
              Store
              <br />
              Accountant<span className="text-accent">.</span>
            </div>

            {/* Red banner words — clipped wrappers so they can slam in */}
            <div aria-hidden className="mt-5 flex flex-wrap gap-x-3 gap-y-2 sm:mt-7 sm:gap-x-4">
              {BANNER_WORDS.map((word, i) => (
                <span key={word} className="overflow-hidden py-[0.06em]">
                  <span
                    ref={(el) => {
                      bannerRefs.current[i] = el;
                    }}
                    className="type-display inline-block bg-accent px-2.5 py-[0.08em] text-[clamp(1.05rem,3.1vw,2.4rem)] leading-none text-white will-change-transform sm:px-3.5"
                  >
                    {word}
                  </span>
                </span>
              ))}
            </div>

            {/* Outline line — ink fill rises on scroll */}
            <div aria-hidden className="relative mt-5 sm:mt-7">
              <span
                ref={line3OutlineRef}
                className="type-display text-outline block text-[clamp(1.5rem,5vw,4.2rem)] leading-[1.02] will-change-[opacity]"
              >
                {OUTLINE_LINE}
              </span>
              <span
                ref={line3FillRef}
                className="type-display absolute inset-0 block text-[clamp(1.5rem,5vw,4.2rem)] leading-[1.02] text-white will-change-[clip-path]"
                style={{ clipPath: "inset(0 0 100% 0)" }}
              >
                {OUTLINE_LINE}
              </span>
            </div>
          </h1>

          {/* Signal-red wipe — sweeps across mid-sequence */}
          <div
            ref={wipeRef}
            aria-hidden
            className="absolute left-0 top-1/2 h-[3px] w-[26vw] bg-accent opacity-0 will-change-transform"
          />

          {/* Mono metadata strip — the editorial colophon */}
          <div className="mt-10 hidden items-center justify-between border-t border-white/25 pt-4 sm:mt-14 sm:flex">
            {["Double-entry engine", "Product-level COGS", "Schema-per-tenant", "Audit-ready exports"].map(
              (item) => (
                <span key={item} className="type-kicker text-zinc-500">
                  {item}
                </span>
              ),
            )}
          </div>
        </div>

        {/* Scroll hint */}
        <div
          ref={hintRef}
          className="absolute bottom-7 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 will-change-[opacity]"
        >
          <span className="type-kicker text-zinc-500">Scroll</span>
          <span className={cn("block h-8 w-px bg-white/40", !reduced && "animate-pulse-dot")} />
        </div>
      </div>
    </section>
  );
}
