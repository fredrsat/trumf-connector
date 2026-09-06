// MCP-server (stdio) for Trumf-kjøpshistorikk. Verktøybeskrivelsene er på
// engelsk med hensikt — de leses av språkmodellen.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TrumfClient } from "./trumf-client.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export async function runMcpServer(): Promise<void> {
  const client = new TrumfClient();
  const server = new McpServer({ name: "trumf-connector", version: "0.2.0" });

  server.registerTool(
    "get_purchases",
    {
      description:
        "List the user's Trumf purchases (NorgesGruppen: Kiwi, Meny, Spar, Joker) with store, date and amount. Trumf keeps the last 12 months; from_date/to_date narrow it. Use get_receipt for line items.",
      inputSchema: {
        from_date: z.string().regex(DATE).optional().describe("YYYY-MM-DD, inclusive"),
        to_date: z.string().regex(DATE).optional().describe("YYYY-MM-DD, inclusive"),
      },
    },
    async ({ from_date, to_date }) => jsonResult(await client.getPurchases(from_date, to_date)),
  );

  server.registerTool(
    "get_receipt",
    {
      description:
        "Get the line items of one Trumf purchase: product name, quantity, unit and amount paid, plus any discounts. Note: Trumf no longer exposes EAN barcodes on receipts — only product text. Real observed shelf prices.",
      inputSchema: {
        batchid: z.string().describe("batchid from get_purchases"),
      },
    },
    async ({ batchid }) => jsonResult(await client.getReceiptCompact(batchid)),
  );

  server.registerTool(
    "get_price_observations",
    {
      description:
        "Flatten the user's Trumf receipts into observed prices per product and store: what each item actually cost, where and when. This is the main tool for real Kiwi/Meny/Joker/Spar prices (kassal.app has no fresh Kiwi data). Keyed by product name since Trumf gives no EAN; set resolve_ean to look up barcodes via kassal.app (best-effort, adds one lookup per product). By default returns only the latest observation per product+store. One page fetch per receipt — max_receipts caps it (default 25).",
      inputSchema: {
        from_date: z.string().regex(DATE).optional().describe("YYYY-MM-DD, inclusive"),
        to_date: z.string().regex(DATE).optional(),
        max_receipts: z.number().int().min(1).max(200).optional(),
        latest_only: z
          .boolean()
          .optional()
          .describe("false returns every observation, not just the latest per product+store"),
        resolve_ean: z
          .boolean()
          .optional()
          .describe("look up EAN barcodes for product names via kassal.app search (best-effort)"),
      },
    },
    async ({ from_date, to_date, max_receipts, latest_only, resolve_ean }) =>
      jsonResult(
        await client.getPriceObservations({
          fra: from_date,
          til: to_date,
          maxReceipts: max_receipts,
          latestOnly: latest_only,
          resolveEan: resolve_ean,
        }),
      ),
  );

  server.registerTool(
    "get_connector_settings",
    {
      description:
        "Show whether Trumf session cookies are configured and whether kassal.app EAN lookup is available. If calls fail as 'not logged in', the user must copy a fresh Cookie header from a logged-in www.trumf.no browser session and run 'trumf-connector auth set-cookies' — the agent cannot do this.",
      inputSchema: {},
    },
    async () => jsonResult(await client.getSettings()),
  );

  await server.connect(new StdioServerTransport());
}
