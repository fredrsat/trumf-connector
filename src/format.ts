// Gjør Trumf-kvitteringer om til prisobservasjoner — kjernedataen agenten
// trenger: hva varen faktisk kostet, hvor og når. Siden Trumf ikke lenger gir
// EAN, nøkles observasjonene på produktnavn; EAN kan slås opp separat via
// kassal.app (se ean-resolver.ts).
import type { PriceObservation, TrumfReceipt, TrumfTransaction } from "./types.js";

/** ISO-tidsstempel → YYYY-MM-DD. */
export function toDate(timestamp: string | undefined): string {
  return String(timestamp ?? "").slice(0, 10);
}

/** Kjede for en transaksjon: filterCategory > partnerId > butikknavnets første ord. */
export function chainOf(transaction: TrumfTransaction): string | undefined {
  return (
    transaction.filterCategory ||
    transaction.partnerId ||
    transaction.beskrivelse?.split(/\s+/)[0] ||
    undefined
  );
}

/** Flater én kvittering ut til prisobservasjoner. Linjer uten meningsfull pris
 *  eller mengde (pant-registrering, 0-linjer) hoppes over. */
export function receiptToObservations(
  transaction: TrumfTransaction,
  receipt: TrumfReceipt,
): PriceObservation[] {
  const date = toDate(transaction.transaksjonsTidspunkt);
  const chain = chainOf(transaction);
  const observations: PriceObservation[] = [];
  for (const line of receipt.varelinjer ?? []) {
    const name = String(line.produktBeskrivelse ?? "").trim();
    const quantity = Number(line.antall);
    const total = Number(line.belop);
    if (!name || !Number.isFinite(quantity) || !Number.isFinite(total) || quantity <= 0) continue;
    const savings = (line.besparelser ?? []).reduce((sum, s) => sum + (Number(s.belop) || 0), 0);
    observations.push({
      name,
      ean: /^\d{8,14}$/.test(String(line.ean ?? "")) ? String(line.ean) : undefined,
      store: transaction.beskrivelse,
      chain,
      date,
      quantity,
      unit_type: line.enhetsType,
      total,
      unit_price: Number((total / quantity).toFixed(2)),
      savings: savings > 0 ? Number(savings.toFixed(2)) : undefined,
      batchid: transaction.batchId,
    });
  }
  return observations;
}

/** Beholder kun nyeste observasjon per produkt+butikk — "sist sett pris".
 *  Nøkkelen er EAN når den finnes, ellers produktnavnet. */
export function latestPerProduct(observations: PriceObservation[]): PriceObservation[] {
  const newest = new Map<string, PriceObservation>();
  for (const obs of observations) {
    const key = `${obs.ean ?? obs.name}|${obs.store}`;
    const existing = newest.get(key);
    if (!existing || obs.date > existing.date) newest.set(key, obs);
  }
  return [...newest.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Kompakt transaksjon for get_purchases. */
export function compactTransaction(transaction: TrumfTransaction) {
  return {
    batchid: transaction.batchId,
    store: transaction.beskrivelse,
    chain: chainOf(transaction),
    date: toDate(transaction.transaksjonsTidspunkt),
    datetime: transaction.transaksjonsTidspunkt,
    amount: transaction.belop,
    bonus: transaction.bonus,
    has_receipt: transaction.harKvittering ?? false,
  };
}

/** Kompakt kvittering for get_receipt. */
export function compactReceipt(transaction: TrumfTransaction | undefined, receipt: TrumfReceipt) {
  return {
    batchid: receipt.batchId ?? transaction?.batchId,
    store: transaction?.beskrivelse,
    date: toDate(receipt.transaksjonsTidspunkt ?? transaction?.transaksjonsTidspunkt),
    amount: receipt.belop ?? transaction?.belop,
    bonus: receipt.bonus,
    lines: (receipt.varelinjer ?? []).map((line) => ({
      name: line.produktBeskrivelse,
      ean: /^\d{8,14}$/.test(String(line.ean ?? "")) ? String(line.ean) : undefined,
      quantity: Number(line.antall),
      unit_type: line.enhetsType,
      total: Number(line.belop),
      vat_percent: line.momsProsent,
      savings: (line.besparelser ?? []).map((s) => ({ description: s.beskrivelse, amount: s.belop })),
    })),
  };
}
