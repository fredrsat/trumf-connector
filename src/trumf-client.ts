// Klient mot Trumf-kjøpshistorikk. Det gamle REST-API-et
// (platform-rest-prod.ngdata.no/trumf/husstand/…) er dødt (404); dataene hentes
// nå ved å laste de innloggede sidene på www.trumf.no og parse RSC-payloaden.
// Autentisering: session-cookies kopiert fra en innlogget trumf.no-nettleser,
// lagret i ~/.trumf-connector/cookies (chmod 600).
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { EanResolver } from "./ean-resolver.js";
import {
  chainOf,
  compactReceipt,
  compactTransaction,
  latestPerProduct,
  receiptToObservations,
  toDate,
} from "./format.js";
import { parseReceipt, parseTransactions } from "./trumf-scrape.js";
import type { PriceObservation, TrumfReceipt, TrumfTransaction } from "./types.js";

const BASE = "https://www.trumf.no";
const RECEIPTS_PATH = "/trumf-profil/kvitteringer";
const CONFIG_DIR = join(homedir(), ".trumf-connector");
const COOKIE_FILE = join(CONFIG_DIR, "cookies");

// Trumf svarer normalt, men vi ser ut som en nettleser for å unngå bot-filtre.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
};

export class TrumfApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TrumfApiError";
  }
}

export class TrumfClient {
  private cachedCookies: string | undefined;
  private readonly eanResolver = new EanResolver();

  /** Lagrer Cookie-headeren fra en innlogget trumf.no-sesjon. */
  async setCookies(cookies: string): Promise<void> {
    const normalized = cookies.trim().replace(/^Cookie:\s*/i, "");
    if (!/authjs\.session-token/.test(normalized)) {
      throw new Error(
        "That doesn't look like a Trumf session cookie (missing '__Secure-authjs.session-token'). " +
          "Copy the full Cookie header from a logged-in request to www.trumf.no.",
      );
    }
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(COOKIE_FILE, normalized);
    await chmod(COOKIE_FILE, 0o600);
    this.cachedCookies = normalized;
  }

  async clearCookies(): Promise<void> {
    this.cachedCookies = undefined;
    await rm(COOKIE_FILE, { force: true });
  }

  private async cookies(): Promise<string> {
    if (this.cachedCookies) return this.cachedCookies;
    try {
      this.cachedCookies = (await readFile(COOKIE_FILE, "utf8")).trim();
      return this.cachedCookies;
    } catch {
      throw new Error(
        "No Trumf session cookies. Log in at https://www.trumf.no, copy the Cookie " +
          "header from any request to www.trumf.no (devtools → Network), then run " +
          "'trumf-connector auth set-cookies' and paste it. See README for details.",
      );
    }
  }

  async getSettings() {
    let configured = !!this.cachedCookies;
    if (!configured) {
      try {
        await readFile(COOKIE_FILE, "utf8");
        configured = true;
      } catch {
        /* ikke satt */
      }
    }
    return {
      cookies_configured: configured,
      cookie_file: COOKIE_FILE,
      ean_lookup_available: await this.eanResolver.available(),
      ean_cache: await this.eanResolver.stats(),
    };
  }

  /** EAN-resolveren, for cache-kommandoene i CLI-et. */
  get resolver(): EanResolver {
    return this.eanResolver;
  }

  private async fetchPage(path: string): Promise<string> {
    const response = await fetch(BASE + path, {
      headers: { ...BROWSER_HEADERS, Cookie: await this.cookies() },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new TrumfApiError(`GET ${path} failed: HTTP ${response.status}`, response.status);
    }
    return response.text();
  }

  /** Alle transaksjoner (siste 12 mnd fra Trumf), valgfritt filtrert på dato. */
  async getTransactions(fra?: string, til?: string): Promise<TrumfTransaction[]> {
    const html = await this.fetchPage(RECEIPTS_PATH);
    let transactions = parseTransactions(html);
    if (fra) transactions = transactions.filter((t) => toDate(t.transaksjonsTidspunkt) >= fra);
    if (til) transactions = transactions.filter((t) => toDate(t.transaksjonsTidspunkt) <= til);
    return transactions;
  }

  /** Kompakt transaksjonsliste for get_purchases. */
  async getPurchases(fra?: string, til?: string) {
    const transactions = await this.getTransactions(fra, til);
    return transactions.map(compactTransaction);
  }

  /** Rå kvittering for én batchId. */
  async getReceipt(batchId: string): Promise<TrumfReceipt> {
    const html = await this.fetchPage(`${RECEIPTS_PATH}/${encodeURIComponent(batchId)}`);
    return parseReceipt(html);
  }

  /** Kompakt kvittering for get_receipt. */
  async getReceiptCompact(batchId: string) {
    const receipt = await this.getReceipt(batchId);
    return compactReceipt(undefined, receipt);
  }

  /** Flater kjøpshistorikken ut til prisobservasjoner. Ett sideoppslag per
   *  kvittering; maxReceipts begrenser antallet. resolveEan slår opp strekkode
   *  per produktnavn via kassal.app (beste-forsøk, siden Trumf ikke gir EAN). */
  async getPriceObservations(
    options: {
      fra?: string;
      til?: string;
      maxReceipts?: number;
      latestOnly?: boolean;
      resolveEan?: boolean;
    } = {},
  ): Promise<{
    observations: PriceObservation[];
    receipts_read: number;
    receipts_total: number;
    ean_resolved?: number;
  }> {
    const transactions = (await this.getTransactions(options.fra, options.til)).filter(
      (t) => t.harKvittering !== false,
    );
    const limit = options.maxReceipts ?? 25;
    const selected = transactions.slice(0, limit);
    const observations: PriceObservation[] = [];
    for (const transaction of selected) {
      const receipt = await this.getReceipt(transaction.batchId);
      observations.push(...receiptToObservations(transaction, receipt));
    }

    let result = options.latestOnly === false ? observations : latestPerProduct(observations);

    let eanResolved: number | undefined;
    if (options.resolveEan) {
      eanResolved = 0;
      for (const obs of result) {
        if (obs.ean) continue;
        const match = await this.eanResolver.resolve(obs.name);
        if (match) {
          obs.ean = match.ean;
          obs.matched_name = match.matched_name;
          obs.match_score = match.match_score;
          eanResolved++;
        }
      }
      await this.eanResolver.flush();
    }

    return {
      observations: result,
      receipts_read: selected.length,
      receipts_total: transactions.length,
      ean_resolved: eanResolved,
    };
  }
}
