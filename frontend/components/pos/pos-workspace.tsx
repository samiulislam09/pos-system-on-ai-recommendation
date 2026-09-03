"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, Loading, PageHeader } from "@/components/ui";
import { CartPanel } from "@/components/pos/cart-panel";
import { ConfirmationPanel } from "@/components/pos/confirmation-panel";
import { ProductSearch } from "@/components/pos/product-search";
import { StoreControls } from "@/components/pos/store-controls";
import {
  getBootstrap,
  isExplicitClientError,
  reconcileSale,
  resolveResult,
  searchProducts,
  submitSale,
  type CartLine,
  type PendingSale,
  type Product,
  type SaleConfirmation,
} from "@/lib/pos";

type SaleState = "editing" | "submitting" | "unknown" | "confirmed";

class UnknownOutcomeError extends Error {}

async function processPendingSale(pending: PendingSale) {
  let result;
  try {
    result = await submitSale(pending);
  } catch (error) {
    if (isExplicitClientError(error)) throw error;
    const reconciled = await reconcileSale(pending.eventId);
    if (reconciled) return reconciled;
    throw new UnknownOutcomeError("The server has not confirmed the final outcome.");
  }

  try {
    const directConfirmation = await resolveResult(result);
    if (directConfirmation) return directConfirmation;
  } catch {
    // A confirmation fetch can lag behind an accepted event; reconcile below.
  }
  const reconciled = await reconcileSale(pending.eventId);
  if (reconciled) return reconciled;
  throw new UnknownOutcomeError("The server has not confirmed the final outcome.");
}

export function PosWorkspace() {
  const [storeId, setStoreId] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleState, setSaleState] = useState<SaleState>("editing");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSale | null>(null);
  const [confirmation, setConfirmation] = useState<SaleConfirmation | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState(0);
  const submittingRef = useRef(false);
  const pendingRef = useRef<PendingSale | null>(null);

  const bootstrap = useQuery({
    queryKey: ["pos-bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const productsQuery = useQuery({
    queryKey: ["pos-products", storeId, debouncedQuery],
    queryFn: ({ signal }) => searchProducts(storeId, debouncedQuery, signal),
    enabled: Boolean(storeId && debouncedQuery),
    retry: 1,
  });

  const saleMutation = useMutation({
    mutationFn: processPendingSale,
    retry: false,
  });

  const stores = bootstrap.data?.stores ?? [];
  const activeStore = stores.find((store) => store.id === storeId);
  const activeTerminal = activeStore?.terminals.find((terminal) => terminal.id === terminalId);
  const products = productsQuery.data?.products ?? [];
  const locked = saleState !== "editing";
  const total = cart.reduce((sum, line) => sum + Number(line.product.sellingPrice) * line.quantity, 0);

  const handleStoreChange = (nextStoreId: string) => {
    if (nextStoreId === storeId) return;
    if (cart.length > 0 && !window.confirm("Changing stores will clear the current cart. Continue?")) return;
    setStoreId(nextStoreId);
    setTerminalId("");
    setCart([]);
    setQuery("");
    setDebouncedQuery("");
    setMessage(null);
  };

  const addProduct = (product: Product) => {
    if (locked || product.availableQuantity <= 0) return;
    setCart((current) => {
      const existing = current.find((line) => line.product.sku === product.sku);
      if (!existing) return [...current, { product, quantity: 1 }];
      if (existing.quantity >= product.availableQuantity) {
        setMessage(`Only ${product.availableQuantity} ${product.unit} of ${product.name} is available.`);
        return current;
      }
      return current.map((line) => line.product.sku === product.sku ? { ...line, quantity: line.quantity + 1 } : line);
    });
  };

  const addFromEnter = async () => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized || !storeId || locked) return;
    let candidates = products;
    if (query.trim() !== debouncedQuery) {
      try {
        candidates = (await searchProducts(storeId, query.trim())).products;
      } catch {
        setMessage("The scanned product could not be looked up. Check the connection and try again.");
        return;
      }
    }
    const exact = candidates.find((product) =>
      [product.sku, product.matchedCode].some((code) => code?.toLocaleLowerCase() === normalized),
    );
    const product = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (product) {
      addProduct(product);
      setQuery("");
      setDebouncedQuery("");
    }
  };

  const changeQuantity = (sku: string, quantity: number) => {
    setCart((current) => current.map((line) =>
      line.product.sku === sku
        ? { ...line, quantity: Math.max(1, Math.min(quantity, line.product.availableQuantity)) }
        : line,
    ));
  };

  const finishSale = (sale: SaleConfirmation, snapshot: PendingSale, snapshotTotal: number) => {
    setConfirmation(sale);
    setConfirmedTotal(snapshotTotal);
    setSaleState("confirmed");
    setMessage(null);
    setCart([]);
  };

  const runSubmission = async (snapshot: PendingSale) => {
    if (submittingRef.current || saleMutation.isPending) return;
    submittingRef.current = true;
    setSaleState("submitting");
    setMessage(null);
    const snapshotTotal = cart.reduce((sum, line) => sum + Number(line.product.sellingPrice) * line.quantity, 0);
    try {
      const sale = await saleMutation.mutateAsync(snapshot);
      finishSale(sale, snapshot, snapshotTotal);
    } catch (error) {
      if (isExplicitClientError(error)) {
        pendingRef.current = null;
        setPending(null);
        setSaleState("editing");
        setMessage(error instanceof Error ? error.message : "The sale was rejected. Review the cart and try again.");
      } else {
        setSaleState("unknown");
        setMessage("The sale outcome is not yet known. Do not create another sale; retry or check status using the same event reference.");
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const beginSale = () => {
    if (submittingRef.current || locked || !storeId || cart.length === 0) return;
    const snapshot: PendingSale = Object.freeze({
      eventId: crypto.randomUUID(),
      type: "SALE",
      storeId,
      ...(terminalId ? { terminalId } : {}),
      timestamp: new Date().toISOString(),
      items: Object.freeze(cart.map((line) => Object.freeze({ sku: line.product.sku, quantity: line.quantity }))),
    });
    pendingRef.current = snapshot;
    setPending(snapshot);
    void runSubmission(snapshot);
  };

  const checkStatus = async () => {
    const snapshot = pendingRef.current;
    if (!snapshot || submittingRef.current) return;
    submittingRef.current = true;
    setSaleState("submitting");
    setMessage(null);
    try {
      const sale = await reconcileSale(snapshot.eventId);
      if (sale) finishSale(sale, snapshot, total);
      else {
        setSaleState("unknown");
        setMessage("The event is still processing or unavailable. The cart remains locked to prevent a duplicate sale.");
      }
    } catch (error) {
      if (isExplicitClientError(error)) {
        pendingRef.current = null;
        setPending(null);
        setSaleState("editing");
        setMessage(error instanceof Error ? error.message : "The sale was rejected.");
      } else {
        setSaleState("unknown");
        setMessage("Status could not be confirmed. Keep this event reference for support and try checking again.");
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const newSale = () => {
    pendingRef.current = null;
    setPending(null);
    setConfirmation(null);
    setSaleState("editing");
    setQuery("");
  };

  if (confirmation && pending) {
    return <ConfirmationPanel sale={confirmation} pending={pending} store={activeStore} terminal={activeTerminal} total={confirmedTotal} onNewSale={newSale} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader eyebrow="Point of sale" title="New sale" description="Select a location, scan products, and complete the transaction." />

      <Card>
        <CardContent className="pt-5">
          {bootstrap.isLoading ? <Loading label="Loading stores and terminals..." /> : null}
          {bootstrap.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">POS setup could not be loaded. Refresh the page or check the API connection.</p> : null}
          {bootstrap.data ? <StoreControls stores={stores} storeId={storeId} terminalId={terminalId} disabled={locked} onStoreChange={handleStoreChange} onTerminalChange={setTerminalId} /> : null}
        </CardContent>
      </Card>

      {message ? (
        <div role="alert" className={`rounded-lg border p-4 text-sm ${saleState === "unknown" ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"}`}>
          <p>{message}</p>
          {pending ? <p className="mt-2 break-all font-mono text-xs">Event: {pending.eventId}</p> : null}
          {saleState === "unknown" && pending ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void checkStatus()}>Check status</Button>
              <Button variant="secondary" onClick={() => void runSubmission(pending)}>Retry same sale</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <ProductSearch query={query} products={products} disabled={!storeId || locked} loading={productsQuery.isFetching} error={productsQuery.isError} onQueryChange={setQuery} onEnter={addFromEnter} onAdd={addProduct} />
        <CartPanel
          lines={cart}
          disabled={!storeId || locked}
          submitting={saleState === "submitting"}
          onQuantity={changeQuantity}
          onRemove={(sku) => setCart((current) => current.filter((line) => line.product.sku !== sku))}
          onClear={() => setCart([])}
          onSubmit={beginSale}
        />
      </div>
    </div>
  );
}
