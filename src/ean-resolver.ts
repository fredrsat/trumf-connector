// Slår opp EAN for et produktnavn via kassal.app sitt produktsøk. Trumf gir
// ikke lenger strekkode på kvitteringene (feltet er alltid "$undefined"), så
// dette er beste-forsøk: vi søker på kvitteringsteksten og tar topptreffet.
// Resultatet merkes med matchende navn + score slik at agenten kan vurdere det.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KASSAL_BASE = "https://kassal.app/api/v1";
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface EanMatch {
  ean: string;
  matched_name: string;
  match_score: number;
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
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9æøå ]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d+(g|kg|ml|l|cl|stk|pk)?$/.test(t));
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
  private readonly cache = new Map<string, EanMatch | null>();

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

  /** Returnerer beste EAN-match for et produktnavn, eller undefined. Cacher per
   *  navn (også bomtreff) for å spare API-kall. Prøver én gang til ved HTTP 429. */
  async resolve(name: string): Promise<EanMatch | undefined> {
    await this.ensureKey();
    if (!this.key) return undefined;
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached ?? undefined;

    const match = await this.search(name);
    this.cache.set(name, match ?? null);
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
