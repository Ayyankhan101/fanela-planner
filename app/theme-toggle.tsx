"use client";

import { useSyncExternalStore } from "react";

// Light/dark toggle. The pre-paint script in app/layout.tsx applies the stored
// choice (localStorage.theme) or the OS preference before first paint; a
// MutationObserver on <html class> keeps this component in sync with it (and
// with the script itself), so no state lives in an effect.
function subscribe(onStoreChange: () => void): () => void {
  const obs = new MutationObserver(onStoreChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
    } catch {
      // private mode — class still flips for this page load
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`rounded-md border border-zinc-300 p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 ${className}`}
    >
      {dark ? (
        // sun — currently dark, click for light
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // moon — currently light, click for dark
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      )}
    </button>
  );
}
