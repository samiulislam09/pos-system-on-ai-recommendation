import { SupplierItemEtlStatus as S } from "@inv/database";
import { acceptSupplierUploadSchema, runSupplierUploadEtlSchema } from "@inv/validation";
import { isFieldApplied, selectGoodItems, selectItemsByStatus } from "./accept-selection.util";

describe("selectGoodItems", () => {
  const items = [
    { id: "a", etlStatus: S.GOOD },
    { id: "b", etlStatus: S.GOOD },
    { id: "c", etlStatus: S.STOCKED },
    { id: "d", etlStatus: S.INCOMPLETE },
  ];

  it("selects every GOOD row when no ids are given", () => {
    expect(selectGoodItems(items, undefined)).toEqual({
      selected: [items[0], items[1]],
      invalidIds: [],
    });
  });

  it("selects only the listed GOOD rows", () => {
    expect(selectGoodItems(items, ["b"])).toEqual({ selected: [items[1]], invalidIds: [] });
  });

  it("reports ids that are not GOOD or not in the upload", () => {
    expect(selectGoodItems(items, ["a", "c", "d", "zzz"]).invalidIds).toEqual(["c", "d", "zzz"]);
  });
});

describe("isFieldApplied", () => {
  it("applies every field when no field list is given", () => {
    expect(isFieldApplied(undefined, "itemDescription")).toBe(true);
    expect(isFieldApplied(undefined, "unitPriceBdt")).toBe(true);
  });

  it("applies only the listed fields when a list is given", () => {
    expect(isFieldApplied(["category"], "category")).toBe(true);
    expect(isFieldApplied(["category"], "unitPriceBdt")).toBe(false);
    expect(isFieldApplied([], "itemDescription")).toBe(false);
  });
});

describe("acceptSupplierUploadSchema", () => {
  const locationId = "cmtx1rbn60015ph1l1g0is5sd";

  it("still accepts a plain locationId body", () => {
    const parsed = acceptSupplierUploadSchema.parse({ locationId });
    expect(parsed).toEqual({ locationId });
  });

  it("accepts optional itemIds and fields", () => {
    const parsed = acceptSupplierUploadSchema.parse({
      locationId,
      itemIds: [locationId],
      fields: ["itemDescription", "unitPriceBdt"],
    });
    expect(parsed.itemIds).toEqual([locationId]);
    expect(parsed.fields).toEqual(["itemDescription", "unitPriceBdt"]);
  });

  it("rejects unknown field names and empty itemIds", () => {
    expect(() =>
      acceptSupplierUploadSchema.parse({ locationId, fields: ["sku"] }),
    ).toThrow();
    expect(() =>
      acceptSupplierUploadSchema.parse({ locationId, itemIds: [] }),
    ).toThrow();
  });
});

describe("selectItemsByStatus", () => {
  const items = [
    { id: "a", etlStatus: S.NEW },
    { id: "b", etlStatus: S.NEW },
    { id: "c", etlStatus: S.GOOD },
  ];

  it("selects every row in the status when no ids are given", () => {
    expect(selectItemsByStatus(items, S.NEW, undefined).selected).toEqual([items[0], items[1]]);
  });

  it("selects the listed rows and reports ones in another status", () => {
    expect(selectItemsByStatus(items, S.NEW, ["b", "c"])).toEqual({
      selected: [items[1]],
      invalidIds: ["c"],
    });
  });
});

describe("runSupplierUploadEtlSchema", () => {
  it("accepts a missing body, row ids and column names", () => {
    expect(runSupplierUploadEtlSchema.parse(undefined)).toEqual({});
    expect(
      runSupplierUploadEtlSchema.parse({ itemIds: ["x"], columns: ["sku", "category"] }),
    ).toEqual({ itemIds: ["x"], columns: ["sku", "category"] });
  });

  it("rejects unknown columns", () => {
    expect(() => runSupplierUploadEtlSchema.parse({ columns: ["price"] })).toThrow();
  });
});
