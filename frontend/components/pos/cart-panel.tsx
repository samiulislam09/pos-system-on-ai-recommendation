import { Button, Card, CardContent, CardHeader, CardTitle, Input, formatMoney } from "@/components/ui";
import type { CartLine, PaymentMethod } from "@/lib/pos";

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "MOBILE_PAYMENT", label: "Mobile" },
];

export function CartPanel({
  lines,
  disabled,
  submitting,
  paymentMethod,
  amountTendered,
  onPaymentMethod,
  onAmountTendered,
  onQuantity,
  onRemove,
  onClear,
  onSubmit,
}: {
  lines: CartLine[];
  disabled: boolean;
  submitting: boolean;
  paymentMethod: PaymentMethod;
  amountTendered: string;
  onPaymentMethod: (method: PaymentMethod) => void;
  onAmountTendered: (value: string) => void;
  onQuantity: (sku: string, quantity: number) => void;
  onRemove: (sku: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + Number(line.product.sellingPrice) * line.quantity, 0);
  const tendered = Number.parseFloat(amountTendered);
  const changeDue = Number.isFinite(tendered) ? tendered - total : null;

  return (
    <Card className="lg:sticky lg:top-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Current sale</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">{itemCount} {itemCount === 1 ? "item" : "items"}</p>
        </div>
        <Button variant="ghost" disabled={disabled || lines.length === 0} onClick={onClear}>Clear</Button>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">Your cart is empty.</div>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {lines.map((line) => (
              <li key={line.product.sku} className="py-4 first:pt-0">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-950 dark:text-zinc-50">{line.product.name}</p>
                    <p className="font-mono text-xs text-zinc-500">{line.product.sku}</p>
                  </div>
                  <p className="shrink-0 font-semibold">{formatMoney(Number(line.product.sellingPrice) * line.quantity)}</p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-center rounded-md border border-zinc-300 dark:border-zinc-700" aria-label={`Quantity for ${line.product.name}`}>
                    <button className="min-h-11 min-w-11 text-lg disabled:opacity-40" disabled={disabled || line.quantity <= 1} aria-label={`Decrease ${line.product.name}`} onClick={() => onQuantity(line.product.sku, line.quantity - 1)}>−</button>
                    <span className="min-w-10 text-center text-sm font-semibold" aria-live="polite">{line.quantity}</span>
                    <button className="min-h-11 min-w-11 text-lg disabled:opacity-40" disabled={disabled || line.quantity >= line.product.availableQuantity} aria-label={`Increase ${line.product.name}`} onClick={() => onQuantity(line.product.sku, line.quantity + 1)}>+</button>
                  </div>
                  <button className="min-h-11 px-2 text-sm font-medium text-red-600 disabled:opacity-40" disabled={disabled} onClick={() => onRemove(line.product.sku)}>Remove</button>
                </div>
                <p className="mt-1 text-xs text-zinc-500">Maximum {line.product.availableQuantity} available</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 space-y-2 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
          <div className="flex justify-between"><span className="text-zinc-500">Subtotal</span><span>{formatMoney(total)}</span></div>
          <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{formatMoney(total)}</span></div>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">Payment method</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={paymentMethod === m.value}
                  disabled={disabled}
                  onClick={() => onPaymentMethod(m.value)}
                  className={`min-h-11 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 ${
                    paymentMethod === m.value
                      ? "border-teal-600 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                      : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {paymentMethod === "CASH" ? (
            <div>
              <label htmlFor="amount-tendered" className="mb-1.5 block text-xs font-medium text-zinc-500">
                Amount received (optional)
              </label>
              <Input
                id="amount-tendered"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amountTendered}
                disabled={disabled}
                onChange={(e) => onAmountTendered(e.target.value)}
              />
              {changeDue !== null && lines.length > 0 ? (
                changeDue >= 0 ? (
                  <p className="mt-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    Change due: {formatMoney(changeDue)}
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-amber-700 dark:text-amber-400">
                    {formatMoney(Math.abs(changeDue))} short of the total
                  </p>
                )
              ) : null}
            </div>
          ) : null}
        </div>
        <Button className="mt-4 min-h-12 w-full text-base" disabled={disabled || lines.length === 0} onClick={onSubmit}>
          {submitting ? "Recording sale..." : "Complete sale"}
        </Button>
      </CardContent>
    </Card>
  );
}
