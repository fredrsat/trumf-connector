#!/usr/bin/env node
// CLI-inngang: `trumf-connector mcp` starter MCP-serveren, resten er
// kommandoer for oppsett og testing fra terminalen.
import { TrumfClient } from "./trumf-client.js";
import { runMcpServer } from "./server.js";

const HELP = `trumf-connector — CLI and MCP server for Trumf purchase history

Usage:
  trumf-connector mcp                        Start the MCP server (stdio)

  trumf-connector auth set-token [token]     Paste token + Enter (or pass as arg)
  trumf-connector auth status
  trumf-connector auth logout                Delete the stored token

  trumf-connector purchases [--from YYYY-MM-DD] [--to YYYY-MM-DD]
  trumf-connector receipt <batchid>
  trumf-connector observations [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--max N] [--all]

Token: log in at https://www.trumf.no, open devtools → Network, copy the
Authorization header from any request to platform-rest-prod.ngdata.no.
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

    case "auth set-token": {
      // Token som argument, ellers interaktivt: én linje + Enter (ingen Ctrl-D).
      const token = rest[0] ?? (await readLine("Lim inn Authorization-token og trykk Enter:\n> "));
      if (!token) throw new Error("Empty token");
      await client.setToken(token);
      print({ status: "token saved" });
      return;
    }
    case "auth status":
      print(await client.getSettings());
      return;
    case "auth logout":
      await client.clearToken();
      print({ status: "token deleted" });
      return;

    case "purchases undefined":
      print(await client.getTransactions(flag(rest, "--from"), flag(rest, "--to")));
      return;

    case "observations undefined":
      print(
        await client.getPriceObservations({
          fra: flag(rest, "--from"),
          til: flag(rest, "--to"),
          maxReceipts: flag(rest, "--max") ? Number(flag(rest, "--max")) : undefined,
          latestOnly: rest.includes("--all") ? false : undefined,
        }),
      );
      return;

    default:
      if (cmd === "purchases") {
        print(await client.getTransactions(flag([sub!, ...rest], "--from"), flag([sub!, ...rest], "--to")));
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
          }),
        );
        return;
      }
      if (cmd === "receipt" && sub) {
        print(await client.getReceipt(sub));
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
