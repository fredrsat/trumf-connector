#!/usr/bin/env node
// CLI-inngang: `trumf-connector mcp` starter MCP-serveren, resten er
// kommandoer for oppsett og testing fra terminalen.
import { TrumfClient } from "./trumf-client.js";
import { runMcpServer } from "./server.js";

const HELP = `trumf-connector — CLI and MCP server for Trumf purchase history

Usage:
  trumf-connector mcp                          Start the MCP server (stdio)

  trumf-connector auth set-cookies [cookie]    Paste Cookie header + Enter (or pass as arg)
  trumf-connector auth status
  trumf-connector auth logout                  Delete the stored cookies

  trumf-connector purchases [--from YYYY-MM-DD] [--to YYYY-MM-DD]
  trumf-connector receipt <batchid>
  trumf-connector observations [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--max N] [--all] [--ean]

  trumf-connector ean-cache status             Cache size and location
  trumf-connector ean-cache seed-rema [--max N]  Seed name→EAN from Rema receipts
                                               (needs rema1000-cli, logged in)

Cookies: log in at https://www.trumf.no, open devtools → Network, click any
request to www.trumf.no, and copy the full 'Cookie' request header. The
'__Secure-authjs.session-token' cookies are the ones that matter (valid ~1 year).
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function readLine(prompt: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim();
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  const client = new TrumfClient();

  switch (`${cmd} ${sub}`) {
    case "mcp undefined":
      await runMcpServer();
      return;

    case "auth set-cookies": {
      const cookies = rest[0] ?? (await readLine("Lim inn Cookie-headeren og trykk Enter:\n> "));
      if (!cookies) throw new Error("Empty cookie header");
      await client.setCookies(cookies);
      print({ status: "cookies saved" });
      return;
    }
    case "auth status":
      print(await client.getSettings());
      return;
    case "auth logout":
      await client.clearCookies();
      print({ status: "cookies deleted" });
      return;

    case "ean-cache status":
      print(await client.resolver.stats());
      return;
    case "ean-cache seed-rema": {
      const { seedFromRema } = await import("./rema-seed.js");
      const max = flag(rest, "--max") ? Number(flag(rest, "--max")) : undefined;
      print(await seedFromRema(client.resolver, max));
      return;
    }

    case "purchases undefined":
      print(await client.getPurchases(flag(rest, "--from"), flag(rest, "--to")));
      return;

    case "observations undefined":
      print(
        await client.getPriceObservations({
          fra: flag(rest, "--from"),
          til: flag(rest, "--to"),
          maxReceipts: flag(rest, "--max") ? Number(flag(rest, "--max")) : undefined,
          latestOnly: rest.includes("--all") ? false : undefined,
          resolveEan: rest.includes("--ean"),
        }),
      );
      return;

    default:
      if (cmd === "purchases") {
        const args = [sub!, ...rest].filter(Boolean);
        print(await client.getPurchases(flag(args, "--from"), flag(args, "--to")));
        return;
      }
      if (cmd === "observations") {
        const args = [sub!, ...rest].filter(Boolean);
        print(
          await client.getPriceObservations({
            fra: flag(args, "--from"),
            til: flag(args, "--to"),
            maxReceipts: flag(args, "--max") ? Number(flag(args, "--max")) : undefined,
            latestOnly: args.includes("--all") ? false : undefined,
            resolveEan: args.includes("--ean"),
          }),
        );
        return;
      }
      if (cmd === "receipt" && sub) {
        print(await client.getReceiptCompact(sub));
        return;
      }
      console.log(HELP);
      process.exitCode = cmd && cmd !== "help" ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
