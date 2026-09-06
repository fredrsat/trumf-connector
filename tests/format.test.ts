import { describe, expect, it } from "vitest";
import { latestPerStoreAndEan, receiptToObservations, toNumber } from "../src/format.js";
import type { TrumfTransaction } from "../src/types.js";

const transaction: TrumfTransaction = {
  dato: "2026-09-01",
  beskrivelse: "KIWI 344 GRUNERLOKKA",
  batchid: "b-1",
  belop: "245.30",
};

describe("toNumber", () => {
  it("tolker både punktum og komma som desimaltegn", () => {
    expect(toNumber("24.90")).toBe(24.9);
    expect(toNumber("24,90")).toBe(24.9);
    expect(toNumber(24.9)).toBe(24.9);
  });
});

describe("receiptToObservations", () => {
  it("flater varelinjer til observasjoner med enhetspris", () => {
    const receipt = {
      varelinjer: [
        { vareTekst: "TINE HELMELK 1L", ean: "7038010000065", antall: "2", belop: "49.80" },
        { vareTekst: "PANT", ean: "*", antall: "1", belop: "3.00" },
        { vareTekst: "BÆREPOSE", ean: "", antall: "1", belop: "4.50" },
      ],
    };
    const observations = receiptToObservations(transaction, receipt);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      ean: "7038010000065",
      store: "KIWI 344 GRUNERLOKKA",
      date: "2026-09-01",
      quantity: 2,
      total: 49.8,
      unit_price: 24.9,
    });
  });

  it("tåler kvittering uten varelinjer", () => {
    expect(receiptToObservations(transaction, {})).toEqual([]);
  });
});

describe("latestPerStoreAndEan", () => {
  it("beholder nyeste observasjon per EAN+butikk, nyest først", () => {
    const make = (date: string, store: string, price: number) => ({
      ean: "7038010000065",
      name: "Melk",
      store,
      date,
      quantity: 1,
      total: price,
      unit_price: price,
      batchid: date,
    });
    const result = latestPerStoreAndEan([
      make("2026-08-01", "KIWI 344", 23.9),
      make("2026-09-01", "KIWI 344", 24.9),
      make("2026-08-15", "MENY TASEN", 26.5),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ store: "KIWI 344", unit_price: 24.9, date: "2026-09-01" });
    expect(result[1]).toMatchObject({ store: "MENY TASEN", unit_price: 26.5 });
  });
});
