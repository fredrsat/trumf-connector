// Typer for Trumf-API-et (platform-rest-prod.ngdata.no/trumf). Løst typet
// med vilje — API-et er privat og udokumentert; ukjente felter passerer
// uendret gjennom.

/** Transaksjonshode fra /husstand/transaksjoner (format=crm). */
export interface TrumfTransaction {
  dato: string;
  beskrivelse: string;
  kjedeid?: string;
  partnerid?: string;
  batchid: string;
  belop: string | number;
  trumf?: string | number;
  ekstratrumf?: string | number;
  trumfvisa?: string | number;
  literbensin?: string | number;
  trumftotal?: string | number;
  [key: string]: unknown;
}

/** Varelinje fra /husstand/transaksjoner/detaljer/{batchid}. */
export interface TrumfLineItem {
  vareTekst: string;
  ean: string;
  antall: string | number;
  belop: string | number;
  [key: string]: unknown;
}

export interface TrumfReceipt {
  varelinjer?: TrumfLineItem[];
  [key: string]: unknown;
}

/** Én observert pris: hva en vare faktisk kostet i en gitt butikk en gitt dag. */
export interface PriceObservation {
  ean: string;
  name: string;
  store: string;
  date: string;
  quantity: number;
  total: number;
  unit_price: number;
  batchid: string;
}
