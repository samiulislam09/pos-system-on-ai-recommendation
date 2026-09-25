import { resubmitIncompleteItemsSchema, returnIncompleteSchema } from "@inv/validation";

const row = {
  id: "cmueb0dqs0035oy219hss1esk",
  poNumber: "PO-1",
  vendorId: "",
  vendorName: "Aarong",
  sku: "SKU_A",
  itemDescription: "Milk",
  category: "Dairy",
  orderQty: 10,
  unitPriceBdt: 90,
  totalAmountBdt: 900,
  orderDate: "2026-07-15",
  deliveryDate: "2026-07-17",
  status: "Pending",
};

describe("returnIncompleteSchema", () => {
  it("accepts an empty body or a note", () => {
    expect(returnIncompleteSchema.parse({})).toEqual({});
    expect(returnIncompleteSchema.parse({ note: "Fill vendor ids" })).toEqual({ note: "Fill vendor ids" });
  });

  it("rejects notes over 2000 characters", () => {
    expect(() => returnIncompleteSchema.parse({ note: "x".repeat(2001) })).toThrow();
  });
});

describe("resubmitIncompleteItemsSchema", () => {
  it("accepts rows whose text fields are still empty (the service reports those per row)", () => {
    expect(resubmitIncompleteItemsSchema.parse({ items: [row] }).items[0].vendorId).toBe("");
  });

  it("requires at least one row and every column", () => {
    expect(() => resubmitIncompleteItemsSchema.parse({ items: [] })).toThrow();
    const { sku: _sku, ...withoutSku } = row;
    expect(() => resubmitIncompleteItemsSchema.parse({ items: [withoutSku] })).toThrow();
  });

  it("rejects the same row id twice", () => {
    expect(() => resubmitIncompleteItemsSchema.parse({ items: [row, row] })).toThrow(/duplicate/i);
  });
});
