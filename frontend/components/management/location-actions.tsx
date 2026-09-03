"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Dialog, Field, FormError } from "@/components/management/dialog";

interface LocationValue {
  id: string;
  name: string;
  code: string;
  type: "STORE" | "WAREHOUSE";
  address: string | null;
  status: string;
}

async function invalidateLocations(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["stores"] }),
    queryClient.invalidateQueries({ queryKey: ["locations"] }),
    queryClient.invalidateQueries({ queryKey: ["pos-bootstrap"] }),
    queryClient.invalidateQueries({ queryKey: ["overview"] }),
    ...(id ? [queryClient.invalidateQueries({ queryKey: ["store", id] })] : []),
  ]);
}

export function LocationAction({ location }: { location?: LocationValue }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [type, setType] = useState<"STORE" | "WAREHOUSE">(location?.type ?? "STORE");
  const [address, setAddress] = useState(location?.address ?? "");
  const [status, setStatus] = useState(location?.status ?? "ACTIVE");
  const queryClient = useQueryClient();
  const editing = Boolean(location);

  const mutation = useMutation({
    mutationFn: () => apiFetch<LocationValue>(location ? `/stores/${location.id}` : "/stores", {
      method: location ? "PATCH" : "POST",
      body: location
        ? { name: name.trim(), address: address.trim(), status }
        : { name: name.trim(), code: code.trim().toUpperCase(), type, ...(address.trim() ? { address: address.trim() } : {}) },
    }),
    onSuccess: async (saved) => {
      await invalidateLocations(queryClient, saved.id);
      setOpen(false);
    },
  });

  const close = () => {
    if (!mutation.isPending) setOpen(false);
  };

  return (
    <>
      <Button type="button" variant={editing ? "outline" : "primary"} onClick={() => setOpen(true)}>
        {editing ? "Edit location" : "New location"}
      </Button>
      <Dialog open={open} title={editing ? "Edit location" : "Create a location"} description="Use stores for sales and warehouses for central stock." onClose={close}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={name} maxLength={120} required autoFocus onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Code" hint={editing ? "Codes cannot be changed after creation." : "Unique within your organization."}>
              <Input value={code} maxLength={32} required disabled={editing} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <Field label="Type">
              <Select className="w-full" value={type} disabled={editing} onChange={(event) => setType(event.target.value as "STORE" | "WAREHOUSE")}>
                <option value="STORE">Store</option>
                <option value="WAREHOUSE">Warehouse</option>
              </Select>
            </Field>
            {editing ? (
              <Field label="Status">
                <Select className="w-full" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </Field>
            ) : null}
          </div>
          <Field label="Address"><Textarea rows={3} maxLength={255} value={address} onChange={(event) => setAddress(event.target.value)} /></Field>
          <FormError error={mutation.error} />
          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={close}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : editing ? "Save changes" : "Create location"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function AddTerminalAction({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [terminalCode, setTerminalCode] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/stores/${storeId}/terminals`, {
      method: "POST",
      body: { storeId, terminalCode: terminalCode.trim().toUpperCase() },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["store", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["stores"] }),
        queryClient.invalidateQueries({ queryKey: ["pos-bootstrap"] }),
      ]);
      setTerminalCode("");
      setOpen(false);
    },
  });

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>Add terminal</Button>
      <Dialog open={open} title="Add POS terminal" size="sm" onClose={() => !mutation.isPending && setOpen(false)}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <Field label="Terminal code" hint="Must be unique across all stores.">
            <Input required autoFocus maxLength={32} value={terminalCode} onChange={(event) => setTerminalCode(event.target.value)} />
          </Field>
          <FormError error={mutation.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Adding..." : "Add terminal"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function TerminalStatusAction({ storeId, terminal }: { storeId: string; terminal: { id: string; status: string } }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/stores/${storeId}/terminals/${terminal.id}`, {
      method: "PATCH",
      body: { status: terminal.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
    }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["store", storeId] }),
      queryClient.invalidateQueries({ queryKey: ["pos-bootstrap"] }),
    ]),
  });
  return (
    <Button type="button" variant="ghost" className="px-2 py-1 text-xs" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {mutation.isPending ? "Saving..." : terminal.status === "ACTIVE" ? "Deactivate" : "Activate"}
    </Button>
  );
}
