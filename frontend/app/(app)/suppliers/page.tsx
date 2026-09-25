"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Input,
  Loading,
  PageHeader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

interface SupplierUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  supplier: { id: string; name: string; phone: string } | null;
  _count: { uploads: number; notifications: number };
}

interface Supplier {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
}

export default function SuppliersPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-users"],
    queryFn: () => apiFetch<{ data: SupplierUser[]; meta: { counts: Record<string, number> } }>("/supplier-portal/manage/suppliers"),
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiFetch<Supplier[]>("/purchases/suppliers"),
  });

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    supplierId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: {
      name: string;
      email: string;
      phone?: string;
      password: string;
      supplierId?: string;
    }) => apiFetch("/supplier-portal/manage/suppliers", { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-users"] });
      setSuccess(`Invitation account created. Share the email and password with ${form.name}.`);
      setForm({ name: "", email: "", phone: "", password: "", supplierId: "" });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    createMutation.mutate({
      name: form.name,
      email: form.email,
      password: form.password,
      ...(form.phone ? { phone: form.phone } : {}),
      ...(form.supplierId ? { supplierId: form.supplierId } : {}),
    });
  };

  const users = data?.data ?? [];

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Supplier portal"
        title="Supplier accounts"
        description="Create and manage login accounts that let suppliers upload product files into your portal."
        actions={
          <Link href="/supplier-uploads">
            <Button variant="outline">← Review uploads</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
        {/* Create account */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Create supplier account</CardTitle>
              <p className="mt-1 text-xs text-zinc-500">
                The supplier logs in at <span className="font-mono">/supplier/login</span> to upload files.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                  Full name
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Rahim Traders"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                  Email
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="supplier@company.com"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                  Phone (optional)
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+880 1XXX-XXXXXX"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                  Temporary password (min 8 characters)
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    required
                    minLength={8}
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                  Link supplier record (optional)
                  <Select
                    value={form.supplierId}
                    onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                  >
                    <option value="">No linked supplier record</option>
                    {suppliers?.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </label>

                {error ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
                ) : null}
                {success ? (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>
                ) : null}

                <Button type="submit" disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? "Creating..." : "Create account"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* List */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Accounts ({users.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Loading />
              ) : users.length === 0 ? (
                <Empty label="No supplier accounts yet" hint="Create an account to let suppliers upload product files." />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH>Linked supplier</TH>
                      <TH>Uploads</TH>
                      <TH>Last login</TH>
                      <TH className="text-right">Created</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {users.map((u) => (
                      <TR key={u.id}>
                        <TD>
                          <div className="font-medium text-zinc-900">{u.name}</div>
                          <div className="text-[11px] text-zinc-400">{u.email}</div>
                        </TD>
                        <TD>
                          {u.supplier ? (
                            <Badge color="blue">{u.supplier.name}</Badge>
                          ) : (
                            <span className="text-xs text-zinc-400">No linked record</span>
                          )}
                        </TD>
                        <TD className="text-zinc-700">{u._count.uploads}</TD>
                        <TD className="text-zinc-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}</TD>
                        <TD className="text-right text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}