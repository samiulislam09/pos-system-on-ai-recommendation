"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supplierApiFetch } from "@/lib/supplier-api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Loading,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

interface Upload {
  id: string;
  originalName: string;
  status: string;
  rowCount: number;
  submissionCount: number;
  createdAt: string;
  location: { name: string } | null;
  _count: { items: number; notifications: number };
}

export default function SupplierUploadsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["supplier-uploads"],
    queryFn: () =>
      supplierApiFetch<{ data: Upload[]; meta: { total: number } }>(
        "/supplier-portal/uploads?page=1&limit=50",
      ),
  });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Product submissions"
        title="My uploads"
        description="Track the status of every product file you have submitted."
        actions={
          <Link href="/supplier/uploads/new">
            <Button>Upload new file</Button>
          </Link>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <Loading />
          ) : data && data.data.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>File</TH>
                  <TH>Status</TH>
                  <TH>Rows</TH>
                  <TH>Attempt</TH>
                  <TH>Location</TH>
                  <TH className="text-right">Date</TH>
                </TR>
              </THead>
              <TBody>
                {data.data.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <Link href={`/supplier/uploads/${u.id}`} className="font-medium text-teal-700 hover:underline">
                        {u.originalName}
                      </Link>
                    </TD>
                    <TD>
                      <Badge color={colorMap(u.status) as any}>{u.status}</Badge>
                    </TD>
                    <TD>{u.rowCount}</TD>
                    <TD>{u.submissionCount}</TD>
                    <TD>{u.location?.name ?? "—"}</TD>
                    <TD className="text-right text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty label="No uploads yet" hint="Upload your first product file to get started" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function colorMap(status: string) {
  if (status === "ACCEPTED") return "green";
  if (status === "REJECTED") return "red";
  if (status === "INCOMPLETE") return "amber";
  return "indigo";
}