// Typer for Trumf-kjøpshistorikk. Kilden er ikke lenger et REST-API, men
// RSC-flight-payloaden som trumf.no server-rendrer på /trumf-profil/kvitteringer
// (det gamle platform-rest-prod.ngdata.no-API-et svarer nå 404). Løst typet:
// ukjente felter passerer uendret gjennom via [key: string].

/** Transaksjonshode fra `transactionsData[]` i liste-payloaden. */
export interface TrumfTransaction {
  batchId: string;
  beskrivelse: string;
  belop: number;
  bonus?: number;
  /** ISO-tidsstempel, f.eks. "2026-09-05T15:04:56.000Z". */
  transaksjonsTidspunkt: string;
  /** Kjede: "KIWI", "MENY", "Joker", "SPAR", "Esso" … */
  filterCategory?: string;
  partnerId?: string;
  harKvittering?: boolean;
  medlemId?: string;
  transaksjonKategori?: string;
  [key: string]: unknown;
}

/** Varelinje fra `purchaseDetails.varelinjer[]` i detalj-payloaden.
 *  MERK: `ean` er per sept. 2026 alltid "$undefined" — Trumf eksponerer ikke
 *  lenger strekkode. Kun produkttekst er tilgjengelig. */
export interface TrumfLineItem {
  produktBeskrivelse: string;
  ean?: string;
  antall: number;
  belop: number;
  bonus?: number;
  enhetsType?: string;
  momsProsent?: number;
  besparelser?: Array<{ type?: string; beskrivelse?: string; belop?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Full kvittering fra detalj-payloaden. */
export interface TrumfReceipt {
  batchId?: string;
  kvitteringsId?: string;
  belop?: number;
  bonus?: number;
  transaksjonsTidspunkt?: string;
  varelinjer: TrumfLineItem[];
  [key: string]: unknown;
}

/** Én observert pris: hva en vare faktisk kostet i en gitt butikk en gitt dag.
 *  `ean` er valgfri og settes kun når den er slått opp via kassal.app-søk på
 *  produktnavnet (Trumf gir ingen strekkode selv). */
export interface PriceObservation {
  name: string;
  ean?: string;
  /** Matchende produktnavn fra kassal.app, når EAN er resolvet. */
  matched_name?: string;
  /** Andel av søkeordene som fantes i det matchede navnet (0–1). */
  match_score?: number;
  store: string;
  chain?: string;
  date: string;
  quantity: number;
  unit_type?: string;
  total: number;
  unit_price: number;
  savings?: number;
  batchid: string;
}
