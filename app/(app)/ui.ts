"use client";

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100";

export const inputCls = `rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-zinc-700 ${focusRing}`;
export const btnCls = `rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900 ${focusRing}`;
export const primaryCls = `rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 ${focusRing}`;
export const dangerCls = `rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950 ${focusRing}`;
export const sectionCls =
  "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
export const titleCls = "mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50";
// DESIGN.md error contract: banner, not bare red text; aria-live for async state
export const errorCls =
  "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
// shared form-field input (label wraps input, label owns association)
export const fieldCls = `mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700 ${focusRing}`;

export type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export async function send(method: string, url: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(data.error ?? `Request failed (${res.status}).`) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error." };
  }
}
