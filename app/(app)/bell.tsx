"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string;
  job_id: string | null;
  job_number: string | null;
  read_at: string | null;
  created_at: string;
};

const POLL_MS = 60_000;

// Admin/ops-only for now (sole recipients of the current trigger set).
export function Bell({ initialCount, enabled }: { initialCount: number; enabled: boolean }) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  async function fetchCount() {
    const res = await fetch("/api/notifications?unread=true&limit=1");
    if (!res.ok) return;
    const data = (await res.json()) as { unreadCount: number };
    setCount(data.unreadCount);
  }

  async function openList() {
    const res = await fetch("/api/notifications?limit=20");
    if (!res.ok) return;
    const data = (await res.json()) as { items: Item[]; unreadCount: number };
    setItems(data.items);
    setCount(data.unreadCount);
  }

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(fetchCount, POLL_MS);
    const onFocus = () => fetchCount();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!enabled) return null;

  async function markRead(id: string) {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setCount((c) => Math.max(0, c - 1));
    setItems((its) => its.map((i) => (i.id === id ? { ...i, read_at: new Date().toISOString() } : i)));
  }

  async function markAll() {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    setCount(0);
    setItems((its) => its.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })));
  }

  function activate(i: Item) {
    if (!i.read_at) void markRead(i.id);
    setOpen(false);
    if (i.job_id) router.push(`/jobs/${i.job_id}`);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        onClick={async () => {
          const next = !open;
          setOpen(next);
          if (next) await openList();
        }}
        className="relative rounded-md border border-zinc-300 px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="text-xs font-semibold uppercase text-zinc-500">Notifications</span>
            <button
              onClick={markAll}
              className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-40 dark:hover:text-zinc-200"
              disabled={count === 0}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-3 py-4 text-sm text-zinc-500">No notifications.</li>
            )}
            {items.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => activate(i)}
                  className={`block w-full border-b border-zinc-100 px-3 py-2 text-left last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900 ${
                    i.read_at ? "opacity-60" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {!i.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />}
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{i.title}</span>
                    {i.job_number && (
                      <span className="ml-auto shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {i.job_number}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">{i.body}</span>
                  <span className="mt-0.5 block text-[10px] text-zinc-400">
                    {new Date(i.created_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
