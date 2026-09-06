import { describe, expect, it } from "vitest";
import { NotAuthenticatedError, parseReceipt, parseTransactions } from "../src/trumf-scrape.js";

// Syntetisk RSC-flight-payload: hermetegn er escapet (\") slik trumf.no gjør det,
// datoer har $D-markør, og EAN er "$undefined" (slik ekte kvitteringer nå er).
const listHtml =
  '<script>self.__next_f.push([1,"12:[\\"$\\",\\"div\\",null,{\\"transactionsData\\":' +
  '[{\\"batchId\\":\\"b-100\\",\\"belop\\":268.41,\\"beskrivelse\\":\\"KIWI Testbutikk\\",' +
  '\\"bonus\\":2.67,\\"transaksjonsTidspunkt\\":\\"$D2026-09-05T17:58:14.000Z\\",' +
  '\\"filterCategory\\":\\"KIWI\\",\\"partnerId\\":\\"KIWI\\",\\"harKvittering\\":true},' +
  '{\\"batchId\\":\\"b-101\\",\\"belop\\":99,\\"beskrivelse\\":\\"MENY Testby\\",\\"bonus\\":1,' +
  '\\"transaksjonsTidspunkt\\":\\"$D2026-08-01T10:00:00.000Z\\",\\"filterCategory\\":\\"MENY\\",' +
  '\\"harKvittering\\":false}],\\"areMonthsGrouped\\":true}]"])</script>';

const receiptHtml =
  '<script>self.__next_f.push([1,"60:[\\"$\\",\\"x\\",null,{\\"purchaseDetails\\":' +
  '{\\"batchId\\":\\"b-100\\",\\"kvitteringsId\\":\\"224383\\",\\"belop\\":99,\\"bonus\\":1,' +
  '\\"transaksjonsTidspunkt\\":\\"$D2026-09-05T17:58:14.000Z\\",\\"varelinjer\\":[' +
  '{\\"produktBeskrivelse\\":\\"TINE HELMELK 1L\\",\\"ean\\":\\"$undefined\\",\\"antall\\":2,' +
  '\\"belop\\":49.8,\\"enhetsType\\":\\"EA\\",\\"momsProsent\\":15,\\"besparelser\\":[]},' +
  '{\\"produktBeskrivelse\\":\\"SMÅGODT PR KG\\",\\"ean\\":\\"$undefined\\",\\"antall\\":0.215,' +
  '\\"belop\\":27.74,\\"enhetsType\\":\\"KG\\",\\"besparelser\\":[' +
  '{\\"type\\":\\"OFFER\\",\\"beskrivelse\\":\\"UKE 36\\",\\"belop\\":10.75}]}]}}]"])</script>';

describe("parseTransactions", () => {
  it("henter alle transaksjoner fra flight-payloaden", () => {
    const tx = parseTransactions(listHtml);
    expect(tx).toHaveLength(2);
    expect(tx[0]).toMatchObject({
      batchId: "b-100",
      beskrivelse: "KIWI Testbutikk",
      belop: 268.41,
      transaksjonsTidspunkt: "2026-09-05T17:58:14.000Z",
      harKvittering: true,
    });
  });

  it("kaster NotAuthenticatedError når payloaden mangler", () => {
    expect(() => parseTransactions("<html>logg inn</html>")).toThrow(NotAuthenticatedError);
  });
});

describe("parseReceipt", () => {
  it("henter varelinjer, strippet $D fra dato", () => {
    const receipt = parseReceipt(receiptHtml);
    expect(receipt.batchId).toBe("b-100");
    expect(receipt.transaksjonsTidspunkt).toBe("2026-09-05T17:58:14.000Z");
    expect(receipt.varelinjer).toHaveLength(2);
    expect(receipt.varelinjer[0]).toMatchObject({ produktBeskrivelse: "TINE HELMELK 1L", antall: 2 });
    // EAN er "$undefined" på ekte kvitteringer — beholdes rått her, filtreres i format.
    expect(receipt.varelinjer[0].ean).toBe("$undefined");
    expect(receipt.varelinjer[1].besparelser?.[0]).toMatchObject({ belop: 10.75 });
  });
});
