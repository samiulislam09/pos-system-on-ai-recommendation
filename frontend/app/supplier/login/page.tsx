"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supplierLogin } from "@/lib/supplier-api";
import { Button, Input } from "@/components/ui";
import { Icon } from "@/components/icons";
import Link from "next/link";

export default function SupplierLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await supplierLogin(email, password);
      router.replace("/supplier/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6f5] p-3 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_24px_80px_rgba(24,32,31,0.1)] sm:min-h-[calc(100vh-3rem)] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-[#123d3a] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
          <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full border border-white/10" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-teal-800"><Icon name="logo" className="h-6 w-6" /></span>
            <div><p className="font-bold tracking-tight">Supplier Portal</p><p className="text-xs text-teal-100/60">Product submission workspace</p></div>
          </div>
          <div className="relative max-w-md">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-teal-200">Deliver with confidence</p>
            <h1 className="text-4xl font-semibold leading-tight tracking-[-0.045em]">Upload your product shipments and track their status.</h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-teal-50/65">Submit product files, receive vendor feedback, and get products into stock faster.</p>
          </div>
          <div className="relative grid grid-cols-3 gap-3 text-xs text-teal-50/70">
            <div className="border-t border-white/15 pt-3">File upload</div>
            <div className="border-t border-white/15 pt-3">Status tracking</div>
            <div className="border-t border-white/15 pt-3">Notifications</div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-12 sm:px-12">
          <div className="w-full max-w-sm">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-white"><Icon name="logo" className="h-6 w-6" /></span>
              <div><p className="font-bold text-zinc-950">Supplier Portal</p><p className="text-xs text-zinc-400">Product submission workspace</p></div>
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Welcome back</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-zinc-950">Sign in to the supplier portal</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Use your supplier account credentials.</p>

            <form onSubmit={submit} className="mt-8 space-y-5">
              <label className="grid gap-2 text-sm font-semibold text-zinc-700" htmlFor="email">
                Email address
                <Input id="email" name="email" type="email" autoComplete="username" placeholder="supplier@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-zinc-700" htmlFor="password">
                Password
                <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-zinc-500">
              Need an account? Contact your vendor for supplier portal access.
            </p>

            {process.env.NODE_ENV === "development" ? (
              <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-5 text-zinc-500">
                <p className="font-semibold text-zinc-700">Demo supplier access</p>
                <p><span className="font-mono">supplier@demo.com</span> / <span className="font-mono">supplier123</span></p>
              </div>
            ) : null}

            <div className="mt-4 text-center">
              <Link href="/login" className="text-xs font-semibold text-teal-700 hover:underline">Sign in to vendor dashboard instead</Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}