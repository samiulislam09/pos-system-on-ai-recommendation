"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSupplierAuthenticated } from "@/lib/supplier-api";
import { SupplierSidebar } from "@/components/supplier-sidebar";

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    if (!isSupplierAuthenticated()) {
      router.replace("/supplier/login");
    }
  }, [router]);

  if (typeof window !== "undefined" && !isSupplierAuthenticated()) {
    return null;
  }

  return (
    <div className="min-h-screen md:flex">
      <SupplierSidebar />
      <main className="min-w-0 flex-1 bg-[#f4f6f5] px-4 py-6 sm:px-6 md:px-8 md:py-8 lg:px-10 lg:py-10">
        <div className="mx-auto w-full max-w-[1480px]">{children}</div>
      </main>
    </div>
  );
}