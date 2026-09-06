// Klient mot Trumf-API-et (NorgesGruppen). Autentisering: Bearer-token
// kopiert fra en innlogget nettlesersesjon på trumf.no — se README for
// hvordan. Tokenet lagres i ~/.trumf-connector/token (chmod 600).
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { latestPerStoreAndEan, receiptToObservations } from "./format.js";
import type { PriceObservation, TrumfReceipt, TrumfTransaction } from "./types.js";

const BASE = "https://platform-rest-prod.ngdata.no/trumf";
const CONFIG_DIR = join(homedir(), ".trumf-connector");
const TOKEN_FILE = join(CONFIG_DIR, "token");

const TRANSACTION_FIELDS =
  "dato,beskrivelse,kjedeid,partnerid,batchid,belop,trumf,ekstratrumf,trumfvisa,literbensin,trumftotal";

// Trumf-API-et avviser åpenbare ikke-nettlesere.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
};

export class TrumfApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class TrumfClient {
  private cachedToken: string | undefined;

  /** Lagrer tokenet; "Bearer "-prefiks legges til om det mangler. */
  async setToken(token: string): Promise<void> {
    const normalized = token.trim().startsWith("Bearer ") ? token.trim() : `Bearer ${token.trim()}`;
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(TOKEN_FILE, normalized);
    await chmod(TOKEN_FILE, 0o600);
    this.cachedToken = normalized;
  }

  async clearToken(): Promise<void> {
    this.cachedToken = undefined;
    await rm(TOKEN_FILE, { force: true });
  }

  private async token(): Promise<string> {
    if (this.cachedToken) return this.cachedToken;
    try {
      this.cachedToken = (await readFile(TOKEN_FILE, "utf8")).trim();
      return this.cachedToken;
    } catch {
      throw new Error(
        "No Trumf token. Log in at https://www.trumf.no, copy the Authorization header " +
          "from a request in the browser's devtools (Network tab), then run " +
          "'trumf-connector auth set-token' and paste it. See README for details.",
      );
    }
  }

  async getSettings() {
    let configured = !!this.cachedToken;
    if (!configured) {
      try {
        await readFile(TOKEN_FILE, "utf8");
        configured = true;
      } catch {
        /* ikke satt */
      }
    }
    return { token_configured: configured, token_file: TOKEN_FILE };
  }

  private async request<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(BASE + path);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Authorization: await this.token() },
    });
    if (response.status === 401 || response.status === 403) {
      throw new TrumfApiError(
        "Trumf token expired or invalid (HTTP " +
          response.status +
          "). Fetch a fresh Authorization header from a logged-in trumf.no browser session " +
          "and run 'trumf-connector auth set-token' again.",
        response.status,
      );
    }
    if (!response.ok) {
      throw new TrumfApiError(
        `GET ${path} failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  /** Kjøp i perioden [fra, til] (YYYY-MM-DD). Uten datoer: siste 90 dager. */
  async getTransactions(fra?: string, til?: string): Promise<TrumfTransaction[]> {
    const end = til ?? new Date().toISOString().slice(0, 10);
    const start =
      fra ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    return this.request<TrumfTransaction[]>("/husstand/transaksjoner", {
      felter: TRANSACTION_FIELDS,
      fra: start,
      til: end,
      format: "crm",
    });
  }

  async getReceipt(batchid: string): Promise<TrumfReceipt> {
    return this.request<TrumfReceipt>(`/husstand/transaksjoner/detaljer/${batchid}`);
  }

  /** Flater kjøpshistorikken ut til prisobservasjoner per EAN og butikk.
   *  maxReceipts begrenser antall kvitteringsoppslag (ett API-kall per kjøp). */
  async getPriceObservations(options: {
    fra?: string;
    til?: string;
    maxReceipts?: number;
    latestOnly?: boolean;
  } = {}): Promise<{ observations: PriceObservation[]; receipts_read: number; receipts_total: number }> {
    const transactions = await this.getTransactions(options.fra, options.til);
    const limit = options.maxReceipts ?? 25;
    const selected = transactions.slice(0, limit);
    const observations: PriceObservation[] = [];
    for (const transaction of selected) {
      const receipt = await this.getReceipt(transaction.batchid);
      observations.push(...receiptToObservations(transaction, receipt));
    }
    return {
      observations:
        options.latestOnly === false ? observations : latestPerStoreAndEan(observations),
      receipts_read: selected.length,
      receipts_total: transactions.length,
    };
  }
}
