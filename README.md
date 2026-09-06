# trumf-connector

MCP-server og CLI for Trumf (NorgesGruppen) — henter kjøpshistorikk og
kvitteringer på linjenivå fra Kiwi, Meny, Spar og Joker, og gjør dem om til
**observerte priser per EAN og butikk**.

Hovedpoenget: Kiwi har ingen nettbutikk og finnes ikke i prisdatabaser som
kassal.app. Men Trumf-kvitteringene dine inneholder ekte hyllepriser med
strekkode for alt du har kjøpt — denne connectoren gjør dem tilgjengelige
for en handleagent, f.eks. sammen med
[kassalapp-connector](https://github.com/fredrsat/kassalapp-connector) og
[rema-connector](https://github.com/fredrsat/rema-connector).

**Kun personlig bruk mot egen konto.** API-et er Trumfs private API
(dokumentert via [reverse engineering](https://gist.github.com/HelgeSverre/80a7f34f874336324184a0c513c2e6a2))
og kan endres uten varsel.

## Autentisering

Connectoren bruker Bearer-tokenet fra en innlogget nettlesersesjon
(ingen passordhåndtering):

1. Logg inn på [trumf.no](https://www.trumf.no)
2. Åpne devtools (⌥⌘I) → **Network**-fanen, last siden på nytt
3. Klikk en forespørsel til `platform-rest-prod.ngdata.no` og kopier verdien
   av `Authorization`-headeren (starter med `Bearer eyJ…`)
4. ```sh
   trumf-connector auth set-token   # lim inn, avslutt med Ctrl-D
   ```

Tokenet lagres i `~/.trumf-connector/token` (chmod 600). Det utløper etter
en stund — connectoren gir tydelig beskjed (HTTP 401) når du må hente et nytt.

## Oppsett

```sh
npm install && npm run build
claude mcp add --scope user trumf -- node /sti/til/trumf-connector/dist/index.js mcp
```

## MCP-verktøy

| Verktøy | Gjør |
|---|---|
| `get_purchases` | Kjøpsliste med butikk, dato og beløp (standard: siste 90 dager) |
| `get_receipt` | Én kvittering på linjenivå: varenavn, EAN, antall, beløp |
| `get_price_observations` | Kvitteringer flatet ut til priser per EAN+butikk — «sist sett pris» |
| `get_connector_settings` | Tokenstatus |

`get_price_observations` gjør ett API-kall per kvittering; `max_receipts`
begrenser (standard 25).

## CLI

```sh
trumf-connector purchases --from 2026-06-01
trumf-connector receipt <batchid>
trumf-connector observations --max 50
```

## Lisens

[MIT](LICENSE)
