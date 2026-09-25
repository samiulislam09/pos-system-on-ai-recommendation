import type { SupplierUploadAcceptField } from "@inv/validation";
import { SupplierItemEtlStatus } from "@inv/database";

/**
 * Rows in `status` to act on: the listed ids (or every such row when none are
 * listed). Any listed id that is not a row of this upload in that status is
 * reported so the caller can reject the whole request.
 */
export function selectItemsByStatus<T extends { id: string; etlStatus: SupplierItemEtlStatus }>(
  items: T[],
  status: SupplierItemEtlStatus,
  itemIds: string[] | undefined,
): { selected: T[]; invalidIds: string[] } {
  const matching = items.filter((i) => i.etlStatus === status);
  if (!itemIds) return { selected: matching, invalidIds: [] };
  const byId = new Map(matching.map((i) => [i.id, i]));
  return {
    selected: itemIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    invalidIds: itemIds.filter((id) => !byId.has(id)),
  };
}

/** Rows to stock: the listed GOOD rows, or every GOOD row. */
export function selectGoodItems<T extends { id: string; etlStatus: SupplierItemEtlStatus }>(
  items: T[],
  itemIds: string[] | undefined,
) {
  return selectItemsByStatus(items, SupplierItemEtlStatus.GOOD, itemIds);
}

/**
 * Whether an optional column should be written to the catalog. An absent
 * field list means "apply everything".
 */
export function isFieldApplied(
  fields: SupplierUploadAcceptField[] | undefined,
  field: SupplierUploadAcceptField,
): boolean {
  return !fields || fields.includes(field);
}
