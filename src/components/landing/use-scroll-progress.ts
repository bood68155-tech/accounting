"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** useLayoutEffect when in the browser, useEffect during SSR. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** True when the user asked the OS to reduce motion (tracked reactively). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Tracks 0..1 progress of the returned ref's element as it scrolls through the
 * viewport (0 = element top hits viewport top, 1 = element bottom hits viewport
 * bottom). `onProgress` fires at most once per animation frame with a signed
 * velocity in px/frame. Callers write transforms/opacity directly to element
 * refs so scrolling never triggers a React re-render — transform/opacity only,
 * so the whole sequence stays on the compositor (60fps feel).
 *
 * Under `prefers-reduced-motion` the hook never activates and elements keep
 * their CSS defaults (the fully composed, static state).
 */
export function useScrollProgress(
  onProgress: (progress: number, velocity: number) => void,
): React.RefObject<HTMLDivElement | null> {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onProgress);

  useEffect(() => {
    cbRef.current = onProgress;
  });

  useIsoLayoutEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let ticking = false;
    let lastTop = 0;
    let hasLast = false;

    const measure = () => {
      ticking = false;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      const velocity = hasLast ? lastTop - rect.top : 0;
      lastTop = rect.top;
      hasLast = true;
      cbRef.current(p, velocity);
    };

    const schedule = () => {
      if (!ticking) {
        ticking = true;
        raf = requestAnimationFrame(measure);
      }
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return targetRef;
}
