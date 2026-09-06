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
  const server = new McpServer({ name: "trumf-connector", version: "0.1.0" });

  server.registerTool(
    "get_purchases",
    {
      description:
        "List the user's Trumf purchases (NorgesGruppen: Kiwi, Meny, Spar, Joker) with store, date and amount. Defaults to the last 90 days. Use get_receipt for line items.",
      inputSchema: {
        from_date: z.string().regex(DATE).optional().describe("YYYY-MM-DD, default 90 days ago"),
        to_date: z.string().regex(DATE).optional().describe("YYYY-MM-DD, default today"),
      },
    },
    async ({ from_date, to_date }) => jsonResult(await client.getTransactions(from_date, to_date)),
  );

  server.registerTool(
    "get_receipt",
    {
      description:
        "Get the line items of one Trumf purchase: product name, EAN barcode, quantity and amount. Real observed shelf prices.",
      inputSchema: {
        batchid: z.string().describe("batchid from get_purchases"),
      },
    },
    async ({ batchid }) => jsonResult(await client.getReceipt(batchid)),
  );

  server.registerTool(
    "get_price_observations",
    {
      description:
        "Flatten the user's Trumf receipts into observed prices per EAN and store: what each product actually cost, where and when. This is the main tool for real Kiwi prices (kassal.app has no fresh Kiwi data). By default returns only the latest observation per EAN+store. One API call per receipt — max_receipts caps it (default 25).",
      inputSchema: {
        from_date: z.string().regex(DATE).optional().describe("YYYY-MM-DD, default 90 days ago"),
        to_date: z.string().regex(DATE).optional(),
        max_receipts: z.number().int().min(1).max(200).optional(),
        latest_only: z
          .boolean()
          .optional()
          .describe("false returns every observation, not just the latest per EAN+store"),
      },
    },
    async ({ from_date, to_date, max_receipts, latest_only }) =>
      jsonResult(
        await client.getPriceObservations({
          fra: from_date,
          til: to_date,
          maxReceipts: max_receipts,
          latestOnly: latest_only,
        }),
      ),
  );

  server.registerTool(
    "get_connector_settings",
    {
      description:
        "Show whether a Trumf token is configured. If not (or if calls fail with 401), the user must copy a fresh Authorization header from a logged-in trumf.no browser session and run 'trumf-connector auth set-token' — the agent cannot do this.",
      inputSchema: {},
    },
    async () => jsonResult(await client.getSettings()),
  );

  await server.connect(new StdioServerTransport());
}
