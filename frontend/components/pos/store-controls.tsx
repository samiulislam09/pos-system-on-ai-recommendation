import { Select } from "@/components/ui";
import type { Store } from "@/lib/pos";

export function StoreControls({
  stores,
  storeId,
  terminalId,
  disabled,
  onStoreChange,
  onTerminalChange,
}: {
  stores: Store[];
  storeId: string;
  terminalId: string;
  disabled: boolean;
  onStoreChange: (storeId: string) => void;
  onTerminalChange: (terminalId: string) => void;
}) {
  const store = stores.find((candidate) => candidate.id === storeId);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Store
        <Select className="min-h-11 w-full" value={storeId} disabled={disabled} onChange={(event) => onStoreChange(event.target.value)}>
          <option value="">Select a store</option>
          {stores.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
        </Select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Terminal <span className="font-normal text-zinc-500">(optional)</span>
        <Select className="min-h-11 w-full" value={terminalId} disabled={disabled || !storeId || !store?.terminals.length} onChange={(event) => onTerminalChange(event.target.value)}>
          <option value="">No terminal</option>
          {store?.terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.terminalCode}</option>)}
        </Select>
      </label>
    </div>
  );
}
