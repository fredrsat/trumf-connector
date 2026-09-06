// Seeder EAN-cachen fra Rema-kvitteringer: rema1000-cli («rema»-binæren) gir
// varelinjer med både produktnavn og EAN (prodtxt3), som er gratis fasit for
// navn→EAN. Kjedene skriver navn litt ulikt, så treffene mot Trumf-tekster er
// beste-forsøk via den normaliserte cachenøkkelen.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { EanResolver } from "./ean-resolver.js";

const execFileAsync = promisify(execFile);

async function findRemaBinary(): Promise<string> {
  const candidates = [process.env.REMA_CLI_PATH, join(homedir(), ".local", "bin", "rema"), "rema"].filter(
    (c): c is string => !!c,
  );
  for (const candidate of candidates) {
    if (candidate === "rema") return candidate; // la PATH avgjøre
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* prøv neste */
    }
  }
  return "rema";
}

async function rema(args: string[]): Promise<unknown> {
  const bin = await findRemaBinary();
  try {
    const { stdout } = await execFileAsync(bin, ["--json", ...args], { maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Could not run rema1000-cli ('${bin} --json ${args.join(" ")}'). Install it and log in ` +
        `('rema auth login') — see https://github.com/Alfredvc/rema1000-cli. ` +
        `(${err instanceof Error ? err.message.split("\n")[0] : String(err)})`,
    );
  }
}

interface RemaRow {
  prodtxt1?: string;
  productDescription?: string;
  prodtxt3?: string;
}

/** Leser Rema-transaksjoner og legger navn→EAN inn i cachen.
 *  maxTransactions begrenser antall kvitteringsoppslag (ett CLI-kall per stk). */
export async function seedFromRema(
  resolver: EanResolver,
  maxTransactions = 50,
): Promise<{ transactions_read: number; lines_seen: number; eans_added: number }> {
  const list = (await rema(["transactions", "list"])) as { transactions?: Array<{ id: number }> };
  const transactions = (list.transactions ?? []).slice(0, maxTransactions);
  let linesSeen = 0;
  let added = 0;
  for (const transaction of transactions) {
    const detail = (await rema(["transactions", "get", String(transaction.id)])) as { rows?: RemaRow[] };
    for (const row of detail.rows ?? []) {
      const name = (row.prodtxt1 ?? row.productDescription ?? "").trim();
      const ean = String(row.prodtxt3 ?? "").trim();
      if (!name || !/^\d{8,14}$/.test(ean)) continue;
      linesSeen++;
      if (await resolver.put(name, ean)) added++;
    }
  }
  await resolver.flush();
  return { transactions_read: transactions.length, lines_seen: linesSeen, eans_added: added };
}
