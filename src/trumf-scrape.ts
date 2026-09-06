// Parser for RSC-flight-payloaden trumf.no bygger sidene sine av. Dataen ligger
// som en escapet JS-streng i HTML-en (hermetegn er skrevet \"). Vi finner
// JSON-strukturen som følger en nøkkel, av-escaper den og parser den.
import type { TrumfReceipt, TrumfTransaction } from "./types.js";

/** Finn og parse JSON-arrayen/objektet som følger `"<key>":` i flight-teksten.
 *  Skanner streng-bevisst slik at hermetegn/braketter inne i verdier ikke
 *  forvirrer brakett-tellingen. Returnerer undefined om nøkkelen mangler. */
export function extractJsonAfter<T = unknown>(html: string, key: string): T | undefined {
  const marker = key + '\\":';
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  let i = at + marker.length;
  while (i < html.length && html[i] !== "[" && html[i] !== "{") i++;
  if (i >= html.length) return undefined;
  const open = html[i];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let j = i;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === "\\" && html[j + 1] === '"') {
        // Tell backslashene rett før hermetegnet: odde antall => \" avslutter
        // strengen, jamn antall => \\\" er et escapet hermetegn inne i strengen.
        let b = 0;
        let k = j;
        while (k >= 0 && html[k] === "\\") {
          b++;
          k--;
        }
        if (b % 2 === 1) inStr = false;
        j++;
      }
      continue;
    }
    if (c === "\\" && html[j + 1] === '"') {
      inStr = true;
      j++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  const raw = html.slice(i, j);
  // Av-escape til gyldig JSON. "$D foran datoer er RSC sin Date-markør; strip den.
  const unescaped = raw
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/"\$D/g, '"');
  return JSON.parse(unescaped) as T;
}

/** Hent hele transaksjonslista fra en /trumf-profil/kvitteringer-side.
 *  Kaster hvis payloaden mangler (som regel = utløpt innlogging). */
export function parseTransactions(html: string): TrumfTransaction[] {
  const data = extractJsonAfter<TrumfTransaction[]>(html, "transactionsData");
  if (!data) {
    throw new NotAuthenticatedError();
  }
  return data;
}

/** Hent én kvittering fra en detalj-side. */
export function parseReceipt(html: string): TrumfReceipt {
  const details = extractJsonAfter<TrumfReceipt>(html, "purchaseDetails");
  if (!details) {
    throw new NotAuthenticatedError();
  }
  return { ...details, varelinjer: details.varelinjer ?? [] };
}

/** Kastes når sidene lastes uten gyldig sesjon (ingen flight-data å parse). */
export class NotAuthenticatedError extends Error {
  constructor() {
    super(
      "Not logged in to trumf.no (no receipt data in page). The stored session " +
        "cookies are missing or expired — log in at https://www.trumf.no and run " +
        "'trumf-connector auth set-cookies' with a fresh Cookie header. See README.",
    );
    this.name = "NotAuthenticatedError";
  }
}
