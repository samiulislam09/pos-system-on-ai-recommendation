import type { KeyboardEvent } from "react";
import { Button, Card, Empty, Input, Loading, formatMoney } from "@/components/ui";
import type { Product } from "@/lib/pos";

export function ProductSearch({
  query,
  products,
  disabled,
  loading,
  error,
  onQueryChange,
  onEnter,
  onAdd,
}: {
  query: string;
  products: Product[];
  disabled: boolean;
  loading: boolean;
  error: boolean;
  onQueryChange: (value: string) => void;
  onEnter: () => void;
  onAdd: (product: Product) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onEnter();
    }
  };

  return (
    <section aria-labelledby="catalog-heading" className="space-y-4">
      <div>
        <h2 id="catalog-heading" className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Find products</h2>
        <p className="text-sm text-zinc-500">Scan a code or search by name or SKU.</p>
      </div>
      <label className="block">
        <span className="sr-only">Search or scan a product</span>
        <Input
          autoFocus
          autoComplete="off"
          className="min-h-12 text-base"
          disabled={disabled}
          placeholder={disabled ? "Select a store to begin" : "Scan barcode or search products"}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      <div aria-live="polite" aria-busy={loading}>
        {loading ? <Loading label="Searching products..." /> : null}
        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">Products could not be loaded. Check the connection and try again.</p> : null}
        {!loading && !error && query.trim() && products.length === 0 ? <Empty label="No matching products" /> : null}
        {!loading && !error && products.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <Card key={product.id} className="flex min-h-40 flex-col p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{product.name}</p>
                  <p className="mt-1 font-mono text-xs text-zinc-500">{product.matchedCode ?? product.sku}</p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <span className="text-lg font-semibold tracking-tight text-teal-700">{formatMoney(product.sellingPrice)}</span>
                    <span className="text-xs text-zinc-500">{product.availableQuantity} {product.unit} available</span>
                  </div>
                </div>
                <Button className="mt-4 min-h-11 w-full" disabled={disabled || product.availableQuantity <= 0} onClick={() => onAdd(product)}>
                  {product.availableQuantity > 0 ? "Add to cart" : "Out of stock"}
                </Button>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
