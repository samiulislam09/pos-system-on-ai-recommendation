"use client";

import { useEffect, useId } from "react";
import { Button, cn } from "@/components/ui";

export function Dialog({
  open,
  title,
  description,
  size = "md",
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg" | "xl";
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/55 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn("my-4 w-full rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900", widths[size])}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm text-zinc-500">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" className="-mr-2 -mt-1 px-2.5" aria-label="Close" onClick={onClose}>Close</Button>
        </header>
        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-5">{children}</div>
      </section>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {error instanceof Error ? error.message : "The request could not be completed."}
    </p>
  );
}
