import { classifyRows, DUPLICATE_SKU, findEmptyColumns, type EtlRow } from "./etl.util";

const full: EtlRow = {
  poNumber: "PO-1",
  vendorId: "VEND_BD_001",
  vendorName: "Aarong",
  sku: "SKU_A",
  itemDescription: "Milk 1L",
  category: "Dairy",
  orderQty: 10,
  unitPriceBdt: "90.00",
  totalAmountBdt: "900.00",
  orderDate: "2026-07-15",
  deliveryDate: "2026-07-17",
  status: "Pending",
};

describe("findEmptyColumns", () => {
  it("returns nothing for a fully filled row", () => {
    expect(findEmptyColumns(full)).toEqual([]);
  });

  it("flags blank and whitespace-only text columns", () => {
    expect(findEmptyColumns({ ...full, vendorId: "", category: "   " })).toEqual([
      "vendor_id",
      "category",
    ]);
  });

  it("flags null text columns", () => {
    expect(findEmptyColumns({ ...full, orderDate: null, status: null })).toEqual([
      "order_date",
      "status",
    ]);
  });

  it("flags zero, non-numeric and decimal-string zero numbers", () => {
    expect(
      findEmptyColumns({ ...full, orderQty: 0, unitPriceBdt: "abc", totalAmountBdt: "0.00" }),
    ).toEqual(["order_qty", "unit_price_bdt", "total_amount_bdt"]);
  });
});

describe("classifyRows", () => {
  it("marks complete rows GOOD and rows with blanks INCOMPLETE", () => {
    const result = classifyRows(
      [
        { ...full, id: "a" },
        { ...full, id: "b", sku: "SKU_B", vendorId: "" },
      ],
      [],
    );
    expect(result).toEqual([
      { id: "a", status: "GOOD", missing: [] },
      { id: "b", status: "INCOMPLETE", missing: ["vendor_id"] },
    ]);
  });

  it("flags later rows repeating a SKU, ignoring case and spaces", () => {
    const result = classifyRows(
      [
        { ...full, id: "a", sku: "SKU_A" },
        { ...full, id: "b", sku: " sku_a " },
      ],
      [],
    );
    expect(result[0]).toEqual({ id: "a", status: "GOOD", missing: [] });
    expect(result[1]).toEqual({ id: "b", status: "INCOMPLETE", missing: [DUPLICATE_SKU] });
  });

  it("flags a row whose SKU already exists as GOOD/STOCKED in the upload", () => {
    const result = classifyRows([{ ...full, id: "a", sku: "SKU_A" }], ["sku_a"]);
    expect(result).toEqual([{ id: "a", status: "INCOMPLETE", missing: [DUPLICATE_SKU] }]);
  });

  it("does not treat empty SKUs as duplicates of each other", () => {
    const result = classifyRows(
      [
        { ...full, id: "a", sku: "" },
        { ...full, id: "b", sku: "" },
      ],
      [],
    );
    expect(result.map((r) => r.missing)).toEqual([["sku"], ["sku"]]);
  });
});

describe("column selection", () => {
  const blank = { ...full, vendorId: "", category: "", sku: "", orderQty: 0 };

  it("checks only the selected columns", () => {
    expect(findEmptyColumns(blank, ["vendor_id"])).toEqual(["vendor_id", "sku", "order_qty"]);
  });

  it("always checks SKU and quantity", () => {
    expect(findEmptyColumns(blank, [])).toEqual(["sku", "order_qty"]);
  });

  it("classifies with the selected columns only", () => {
    expect(classifyRows([{ ...full, id: "a", category: "" }], [], ["vendor_id"])).toEqual([
      { id: "a", status: "GOOD", missing: [] },
    ]);
  });
});
