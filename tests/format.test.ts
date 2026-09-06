import { describe, expect, it } from "vitest";
import {
  chainOf,
  compactReceipt,
  compactTransaction,
  latestPerProduct,
  receiptToObservations,
  toDate,
} from "../src/format.js";
import type { PriceObservation, TrumfTransaction } from "../src/types.js";

const transaction: TrumfTransaction = {
  batchId: "b-1",
  beskrivelse: "KIWI Testbutikk",
  belop: 245.3,
  bonus: 2.4,
  transaksjonsTidspunkt: "2026-09-01T15:04:56.000Z",
  filterCategory: "KIWI",
  harKvittering: true,
};

describe("toDate", () => {
  it("kutter ISO-tidsstempel til YYYY-MM-DD", () => {
    expect(toDate("2026-09-01T15:04:56.000Z")).toBe("2026-09-01");
    expect(toDate(undefined)).toBe("");
  });
});

describe("chainOf", () => {
  it("foretrekker filterCategory, faller tilbake til butikknavn", () => {
    expect(chainOf(transaction)).toBe("KIWI");
    expect(chainOf({ ...transaction, filterCategory: undefined, partnerId: undefined })).toBe("KIWI");
  });
});

describe("receiptToObservations", () => {
  it("flater varelinjer til observasjoner med enhetspris og besparelser", () => {
    const receipt = {
      varelinjer: [
        { produktBeskrivelse: "TINE HELMELK 1L", ean: "$undefined", antall: 2, belop: 49.8, enhetsType: "EA" },
        {
          produktBeskrivelse: "SMÅGODT PR KG",
          antall: 0.5,
          belop: 40,
          enhetsType: "KG",
          besparelser: [{ beskrivelse: "Tilbud", belop: 5 }],
        },
        { produktBeskrivelse: "", antall: 1, belop: 3 }, // droppes: mangler navn
      ],
    };
    const observations = receiptToObservations(transaction, receipt);
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      name: "TINE HELMELK 1L",
      ean: undefined,
      store: "KIWI Testbutikk",
      chain: "KIWI",
      date: "2026-09-01",
      quantity: 2,
      total: 49.8,
      unit_price: 24.9,
    });
    expect(observations[1]).toMatchObject({ unit_price: 80, savings: 5 });
  });

  it("tåler kvittering uten varelinjer", () => {
    expect(receiptToObservations(transaction, { varelinjer: [] })).toEqual([]);
  });
});

describe("latestPerProduct", () => {
  it("beholder nyeste observasjon per produkt+butikk, nyest først", () => {
    const make = (date: string, store: string, price: number): PriceObservation => ({
      name: "Melk",
      store,
      date,
      quantity: 1,
      total: price,
      unit_price: price,
      batchid: date,
    });
    const result = latestPerProduct([
      make("2026-08-01", "KIWI Testbutikk", 23.9),
      make("2026-09-01", "KIWI Testbutikk", 24.9),
      make("2026-08-15", "MENY Testby", 26.5),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ store: "KIWI Testbutikk", unit_price: 24.9, date: "2026-09-01" });
    expect(result[1]).toMatchObject({ store: "MENY Testby", unit_price: 26.5 });
  });

  it("skiller produkter på EAN når den finnes", () => {
    const base = { store: "KIWI", date: "2026-09-01", quantity: 1, total: 10, unit_price: 10, batchid: "x" };
    const result = latestPerProduct([
      { ...base, name: "A", ean: "7038010000065" },
      { ...base, name: "B", ean: "7038010000072" },
    ]);
    expect(result).toHaveLength(2);
  });
});

describe("compactTransaction / compactReceipt", () => {
  it("compactTransaction gir agentvennlig form", () => {
    expect(compactTransaction(transaction)).toMatchObject({
      batchid: "b-1",
      store: "KIWI Testbutikk",
      chain: "KIWI",
      date: "2026-09-01",
      amount: 245.3,
      has_receipt: true,
    });
  });

  it("compactReceipt mapper linjer og besparelser", () => {
    const compact = compactReceipt(transaction, {
      batchId: "b-1",
      belop: 49.8,
      transaksjonsTidspunkt: "2026-09-01T15:04:56.000Z",
      varelinjer: [
        {
          produktBeskrivelse: "TINE HELMELK 1L",
          antall: 2,
          belop: 49.8,
          enhetsType: "EA",
          momsProsent: 15,
          besparelser: [{ beskrivelse: "Tilbud", belop: 5 }],
        },
      ],
    });
    expect(compact).toMatchObject({ batchid: "b-1", store: "KIWI Testbutikk", date: "2026-09-01" });
    expect(compact.lines[0]).toMatchObject({ name: "TINE HELMELK 1L", quantity: 2, total: 49.8, vat_percent: 15 });
    expect(compact.lines[0].savings[0]).toMatchObject({ description: "Tilbud", amount: 5 });
  });
});
