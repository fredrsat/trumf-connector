// Gjør Trumf-kvitteringer om til prisobservasjoner per EAN — kjernedataen
// agenten trenger: hva varen faktisk kostet, hvor og når.
import type { PriceObservation, TrumfLineItem, TrumfReceipt, TrumfTransaction } from "./types.js";

/** Trumf serverer tall som strenger med varierende format; tolker begge. */
export function toNumber(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (value === undefined) return NaN;
  return Number(String(value).replace(",", "."));
}

/** Flater én kvittering ut til prisobservasjoner. Linjer uten gyldig EAN
 *  (pant, poser, rabattlinjer merket med '*') hoppes over. */
export function receiptToObservations(
  transaction: TrumfTransaction,
  receipt: TrumfReceipt,
): PriceObservation[] {
  const observations: PriceObservation[] = [];
  for (const line of receipt.varelinjer ?? []) {
    const ean = String(line.ean ?? "").trim();
    if (!/^\d{8,14}$/.test(ean)) continue;
    const quantity = toNumber(line.antall);
    const total = toNumber(line.belop);
    if (!Number.isFinite(quantity) || !Number.isFinite(total) || quantity <= 0) continue;
    observations.push({
      ean,
      name: line.vareTekst,
      store: transaction.beskrivelse,
      date: transaction.dato,
      quantity,
      total,
      unit_price: Number((total / quantity).toFixed(2)),
      batchid: transaction.batchid,
    });
  }
  return observations;
}

/** Beholder kun nyeste observasjon per EAN+butikk — det er "sist sett pris". */
export function latestPerStoreAndEan(observations: PriceObservation[]): PriceObservation[] {
  const newest = new Map<string, PriceObservation>();
  for (const obs of observations) {
    const key = `${obs.ean}|${obs.store}`;
    const existing = newest.get(key);
    if (!existing || obs.date > existing.date) newest.set(key, obs);
  }
  return [...newest.values()].sort((a, b) => b.date.localeCompare(a.date));
}
