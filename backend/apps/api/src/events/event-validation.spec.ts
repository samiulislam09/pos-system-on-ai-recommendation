import { returnEventSchema, saleEventSchema } from "@inv/validation";

const baseEvent = {
  eventId: "checkout-123",
  storeId: "clz1234567890abcdefghijkl",
  timestamp: "2026-08-23T12:00:00.000Z",
};

describe("POS event validation", () => {
  it("accepts a sale containing only server-priced item identity and quantity", () => {
    expect(
      saleEventSchema.parse({
        ...baseEvent,
        type: "SALE",
        items: [{ sku: "SKU-001", quantity: 2 }],
      }),
    ).toEqual({
      ...baseEvent,
      type: "SALE",
      items: [{ sku: "SKU-001", quantity: 2 }],
    });
  });

  it("rejects client-controlled sale pricing and payment fields", () => {
    expect(() =>
      saleEventSchema.parse({
        ...baseEvent,
        type: "SALE",
        items: [{ sku: "SKU-001", quantity: 1, unitPrice: 0 }],
        payments: [{ method: "CASH", amount: 0 }],
      }),
    ).toThrow();
  });

  it("keeps priced return items valid", () => {
    expect(
      returnEventSchema.safeParse({
        ...baseEvent,
        type: "RETURN",
        items: [{ sku: "SKU-001", quantity: 1, unitPrice: 12.5 }],
      }).success,
    ).toBe(true);
  });
});
