import { buildSalesCsv, csvEscape, SALES_CSV_HEADER } from "./csv.util";

describe("csvEscape", () => {
  it("passes plain values through", () => {
    expect(csvEscape("TSHIRT-BLK-M")).toBe("TSHIRT-BLK-M");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(null)).toBe("");
  });

  it("quotes and doubles values containing commas, quotes, or newlines", () => {
    expect(csvEscape('T-Shirt, "Black" M')).toBe('"T-Shirt, ""Black"" M"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildSalesCsv", () => {
  it("emits one row per sale item with sale-level columns repeated", () => {
    const csv = buildSalesCsv([
      {
        transactionNumber: "TXN-1",
        createdAt: new Date("2026-09-03T10:00:00.000Z"),
        status: "COMPLETED",
        paymentStatus: "PAID",
        store: { name: "Mirpur, Store", code: "DHK-MIR" },
        terminal: null,
        payments: [{ method: "CASH" }],
        subtotal: "650",
        total: "650",
        items: [
          { quantity: 1, unitPrice: "650", total: "650", product: { sku: "SKU-1", name: "Shirt" } },
          { quantity: 2, unitPrice: "100", total: "200", product: { sku: "SKU-2", name: "Cap" } },
        ],
      },
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(SALES_CSV_HEADER);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      'TXN-1,2026-09-03T10:00:00.000Z,"Mirpur, Store",DHK-MIR,,SKU-1,Shirt,1,650,650,650,650,COMPLETED,PAID,CASH',
    );
    expect(lines[2]).toContain("SKU-2,Cap,2,100,200");
  });
});
