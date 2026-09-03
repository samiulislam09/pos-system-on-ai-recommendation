"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Loading,
  PageHeader,
} from "@/components/ui";
import { LocationAction } from "@/components/management/location-actions";
import { TodaySalesCsvButton } from "@/components/management/sales-export";

interface Store {
  id: string;
  name: string;
  code: string;
  type: "STORE" | "WAREHOUSE";
  address: string | null;
  status: string;
  _count: { postTerminals: number; sales: number };
}

export default function StoresPage() {
  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/stores"),
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Network" title="Locations" description="Manage stores and warehouses from one operational directory." actions={<LocationAction />} />

      {stores.isLoading ? (
        <Loading />
      ) : stores.data && stores.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {stores.data.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    <Link href={`/stores/${s.id}`} className="text-teal-700 hover:text-teal-900 hover:underline">
                      {s.name}
                    </Link>
                  </CardTitle>
                  <Badge color={s.type === "WAREHOUSE" ? "blue" : "indigo"}>{s.type}</Badge>
                </div>
                <p className="text-xs text-zinc-500">{s.code} · {s.address ?? "No address"}</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Status</span>
                    <Badge color={s.status === "ACTIVE" ? "green" : "zinc"}>{s.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">POS terminals</span>
                    <span className="font-medium">{s._count.postTerminals}</span>
                  </div>
                </div>
                <TodaySalesCsvButton storeId={s.id} storeCode={s.code} />
                <p className="mt-1.5 text-center text-xs text-zinc-400">
                  Need a date range? Open the store for From/To export.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Empty label="No stores" />
      )}
    </div>
  );
}
