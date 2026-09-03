import { Button, Card, CardContent, formatMoney } from "@/components/ui";
import type { PendingSale, SaleConfirmation, Store, Terminal } from "@/lib/pos";

export function ConfirmationPanel({
  sale,
  pending,
  store,
  terminal,
  total,
  onNewSale,
}: {
  sale: SaleConfirmation;
  pending: PendingSale;
  store?: Store;
  terminal?: Terminal;
  total: number;
  onNewSale: () => void;
}) {
  const itemCount = pending.items.reduce((sum, item) => sum + item.quantity, 0);
  const transactionReference = sale.transactionNumber ?? sale.transactionId ?? sale.id ?? "Confirmed";

  return (
    <Card role="status" aria-live="polite" className="mx-auto max-w-2xl border-emerald-200 dark:border-emerald-900">
      <CardContent className="p-6 sm:p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">OK</div>
        <h1 className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">Sale confirmed</h1>
        <p className="mt-1 text-sm text-zinc-500">Inventory has been recorded. Payment status is PENDING.</p>
        <dl className="mt-7 grid gap-x-8 gap-y-5 border-y border-zinc-200 py-6 sm:grid-cols-2 dark:border-zinc-800">
          <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Transaction</dt><dd className="mt-1 break-all font-semibold">{transactionReference}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Total</dt><dd className="mt-1 font-semibold">{formatMoney(sale.total ?? total)}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Store</dt><dd className="mt-1">{sale.store?.name ?? store?.name ?? pending.storeId}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Terminal</dt><dd className="mt-1">{sale.terminal?.terminalCode ?? terminal?.terminalCode ?? "Not selected"}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Items</dt><dd className="mt-1">{itemCount}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Event support reference</dt><dd className="mt-1 break-all font-mono text-xs">{pending.eventId}</dd></div>
        </dl>
        <Button className="mt-7 min-h-12 w-full sm:w-auto" onClick={onNewSale}>New Sale</Button>
      </CardContent>
    </Card>
  );
}
