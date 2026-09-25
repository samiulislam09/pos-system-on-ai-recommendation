"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";

const TOAST_MS = 8000;
const MAX_TOASTS = 3;

interface ToastItem {
  id: number;
  message: string;
}

/** A small stack of auto-dismissing toasts; `push` adds one. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback(
    (message: string) =>
      setToasts((t) => [...t.slice(-(MAX_TOASTS - 1)), { id: Date.now() + Math.random(), message }]),
    [],
  );
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

export function NotificationToasts({
  toasts,
  dismiss,
  href,
}: {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
  /** Where clicking a toast goes, e.g. the notifications page. */
  href: string;
}) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} href={href} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function Toast({ message, href, onDismiss }: { message: string; href: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-teal-200 bg-white p-4 shadow-lg">
      <Icon name="bell" className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
      <Link href={href} onClick={onDismiss} className="min-w-0 flex-1 text-sm text-zinc-700 hover:text-zinc-950">
        <span className="block text-xs font-semibold uppercase tracking-wide text-teal-700">New notification</span>
        {message}
      </Link>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="text-zinc-400 hover:text-zinc-700">
        ×
      </button>
    </div>
  );
}
