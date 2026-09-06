// Slår opp EAN for et produktnavn via kassal.app sitt produktsøk. Trumf gir
// ikke lenger strekkode på kvitteringene (feltet er alltid "$undefined"), så
// dette er beste-forsøk: vi søker på kvitteringsteksten og tar topptreffet.
// Resultatet merkes med matchende navn + score slik at agenten kan vurdere det.
//
// Oppslagene caches persistent i ~/.trumf-connector/ean-cache.json — både
// treff og bomskudd (bomskudd prøves på nytt etter 30 dager). Cachen kan
// seedes fra Rema-kvitteringer, som har både navn og EAN (se index.ts);
// seedede navn matches via en normalisert nøkkel (små bokstaver, sorterte
// ord) siden kjedene skriver produktnavn litt ulikt.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KASSAL_BASE = "https://kassal.app/api/v1";
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = join(homedir(), ".trumf-connector", "ean-cache.json");
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // bomskudd prøves på nytt etter 30 dager

export interface EanMatch {
  ean: string;
  matched_name: string;
  match_score: number;
}

interface CacheEntry {
  ean?: string;
  matched_name?: string;
  match_score?: number;
  /** Hvor oppføringen kom fra: "kassalapp" (søk) eller "rema" (kvittering). */
  source?: string;
  at: string;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

/** Finn kassal.app-API-nøkkelen: miljøvariabel, denne connectorens .env, eller
 *  kassalapp-connectorens config/.env i hjemmemappa. */
async function findApiKey(): Promise<string | undefined> {
  if (process.env.KASSALAPP_API_KEY) return process.env.KASSALAPP_API_KEY.trim();
  const envKey = async (path: string) => {
    try {
      const m = (await readFile(path, "utf8")).match(/^\s*KASSALAPP_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m);
      return m?.[1]?.trim();
    } catch {
      return undefined;
    }
  };
  const configKey = async (path: string) => {
    try {
      const cfg = JSON.parse(await readFile(path, "utf8")) as { apiKey?: string };
      return cfg.apiKey?.trim();
    } catch {
      return undefined;
    }
  };
  return (
    (await envKey(join(PROJECT_ROOT, ".env"))) ||
    (await configKey(join(homedir(), ".kassalapp-connector", "config.json"))) ||
    (await envKey(join(homedir(), "Code", "kassalapp-connector", ".env"))) ||
    undefined
  );
}

/** Normaliserer et navn til søkeord (små bokstaver, uten mengde/enhet-støy). */
export function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9æøå ]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d+(g|kg|ml|l|cl|stk|pk)?$/.test(t));
}

/** Kjede-uavhengig cachenøkkel: sorterte, normaliserte ord. */
export function normalizedKey(name: string): string {
  return tokens(name).sort().join(" ");
}

/** Andel av kvitteringstekstens ord som gjenfinnes i det matchede navnet. */
function score(query: string, candidate: string): number {
  const q = tokens(query);
  if (q.length === 0) return 0;
  const c = new Set(tokens(candidate));
  return q.filter((t) => c.has(t)).length / q.length;
}

export class EanResolver {
  private key: string | undefined;
  private keyLoaded = false;
  private cache: CacheFile | undefined;
  private dirty = false;

  constructor(private readonly minScore = 0.5) {}

  async available(): Promise<boolean> {
    await this.ensureKey();
    return !!this.key;
  }

  private async ensureKey(): Promise<void> {
    if (this.keyLoaded) return;
    this.key = await findApiKey();
    this.keyLoaded = true;
  }

  private async loadCache(): Promise<CacheFile> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(CACHE_FILE, "utf8")) as CacheFile;
      if (this.cache.version !== 1 || typeof this.cache.entries !== "object") throw new Error();
    } catch {
      this.cache = { version: 1, entries: {} };
    }
    return this.cache;
  }

  /** Skriv cachen til disk hvis den er endret. Kalles etter et batch-oppslag. */
  async flush(): Promise<void> {
    if (!this.dirty || !this.cache) return;
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(this.cache, null, 1));
    this.dirty = false;
  }

  /** Legg inn en kjent navn→EAN-kobling (f.eks. fra en Rema-kvittering). */
  async put(name: string, ean: string, source = "rema"): Promise<boolean> {
    if (!/^\d{8,14}$/.test(ean)) return false;
    const key = normalizedKey(name);
    if (!key) return false;
    const cache = await this.loadCache();
    const existing = cache.entries[key];
    if (existing?.ean === ean) return false;
    cache.entries[key] = { ean, matched_name: name, match_score: 1, source, at: new Date().toISOString() };
    this.dirty = true;
    return true;
  }

  async stats(): Promise<{ cache_file: string; hits: number; misses: number }> {
    const cache = await this.loadCache();
    const values = Object.values(cache.entries);
    return {
      cache_file: CACHE_FILE,
      hits: values.filter((e) => e.ean).length,
      misses: values.filter((e) => !e.ean).length,
    };
  }

  /** Returnerer beste EAN-match for et produktnavn, eller undefined. Slår først
   *  opp i den persistente cachen (også bomskudd, med utløp), deretter
   *  kassal.app. Husk flush() etter et batch. */
  async resolve(name: string): Promise<EanMatch | undefined> {
    const cache = await this.loadCache();
    const key = normalizedKey(name);
    if (!key) return undefined;

    const entry = cache.entries[key];
    if (entry) {
      if (entry.ean) {
        return { ean: entry.ean, matched_name: entry.matched_name ?? name, match_score: entry.match_score ?? 1 };
      }
      // Bomskudd: ikke prøv igjen før TTL er ute.
      if (Date.now() - Date.parse(entry.at) < MISS_TTL_MS) return undefined;
    }

    await this.ensureKey();
    if (!this.key) return undefined;

    const match = await this.search(name);
    cache.entries[key] = match
      ? { ...match, source: "kassalapp", at: new Date().toISOString() }
      : { at: new Date().toISOString() };
    this.dirty = true;
    return match;
  }

  private async search(name: string, retried = false): Promise<EanMatch | undefined> {
    const url = new URL(`${KASSAL_BASE}/products`);
    url.searchParams.set("search", name);
    url.searchParams.set("size", "5");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" },
    });
    if (response.status === 429 && !retried) {
      const wait = Math.min(Number(response.headers.get("retry-after") ?? 2) || 2, 60);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.search(name, true);
    }
    if (!response.ok) return undefined;
    const body = (await response.json()) as { data?: Array<{ name?: string; ean?: string }> };
    let best: EanMatch | undefined;
    for (const product of body.data ?? []) {
      const ean = String(product.ean ?? "").trim();
      if (!/^\d{8,14}$/.test(ean)) continue;
      const s = score(name, product.name ?? "");
      if (!best || s > best.match_score) {
        best = { ean, matched_name: product.name ?? "", match_score: Number(s.toFixed(2)) };
      }
    }
    return best && best.match_score >= this.minScore ? best : undefined;
  }
}
