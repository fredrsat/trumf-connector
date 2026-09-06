# trumf-connector

MCP-server og CLI for Trumf (NorgesGruppen) — henter kjøpshistorikk og
kvitteringer på linjenivå fra Kiwi, Meny, Spar og Joker, og gjør dem om til
**observerte priser per produkt og butikk**.

Hovedpoenget: Kiwi har ingen nettbutikk og finnes ikke i prisdatabaser som
kassal.app. Men Trumf-kvitteringene dine inneholder ekte hyllepriser for alt
du har kjøpt — denne connectoren gjør dem tilgjengelige for en handleagent,
f.eks. sammen med
[kassalapp-connector](https://github.com/fredrsat/kassalapp-connector) og
[rema-connector](https://github.com/fredrsat/rema-connector).

**Kun personlig bruk mot egen konto.**

> **Merk (sept. 2026):** Trumfs gamle REST-API
> (`platform-rest-prod.ngdata.no/trumf/husstand/…`) er lagt ned og svarer 404.
> Connectoren henter nå dataene ved å laste de innloggede sidene på
> `www.trumf.no` og parse dem. To konsekvenser:
>
> - **Autentisering skjer med session-cookies**, ikke Bearer-token (se under).
> - **Trumf gir ikke lenger EAN/strekkode** på kvitteringene — kun produkttekst
>   («GIFFLAR KANEL 300G PÅGEN»). Strekkode kan slås opp beste-forsøk via
>   kassal.app-søk på produktnavnet (`resolve_ean` / `--ean`).

## Autentisering

Connectoren bruker session-cookiene fra en innlogget trumf.no-nettleser
(ingen passordhåndtering):

1. Logg inn på [trumf.no](https://www.trumf.no)
2. Åpne devtools (⌥⌘I) → **Network**-fanen, last siden på nytt
3. Klikk en forespørsel til `www.trumf.no`, finn **Request Headers** og kopier
   hele verdien av `Cookie`-headeren (den inneholder
   `__Secure-authjs.session-token…`)
4. ```sh
   trumf-connector auth set-cookies   # lim inn, trykk Enter
   ```

Cookiene lagres i `~/.trumf-connector/cookies` (chmod 600) og er gyldige rundt
ett år. Connectoren gir tydelig beskjed når de er utløpt (kall feiler som
«not logged in»), og du gjentar stegene over.

### EAN-oppslag (valgfritt)

For å fylle inn strekkoder søker connectoren på produktnavnet i kassal.app.
Den finner API-nøkkelen fra (i rekkefølge): miljøvariabelen
`KASSALAPP_API_KEY`, `.env` i dette prosjektet, eller
`~/.kassalapp-connector/config.json`. Uten nøkkel hoppes oppslaget over.

## Oppsett

```sh
npm install && npm run build
claude mcp add --scope user trumf -- node /sti/til/trumf-connector/dist/index.js mcp
```

## MCP-verktøy

| Verktøy | Gjør |
|---|---|
| `get_purchases` | Kjøpsliste med butikk, dato og beløp (Trumf beholder siste 12 mnd) |
| `get_receipt` | Én kvittering på linjenivå: varenavn, antall, enhet, beløp, rabatt |
| `get_price_observations` | Kvitteringer flatet ut til priser per produkt+butikk — «sist sett pris»; `resolve_ean` slår opp strekkode |
| `get_connector_settings` | Cookie-status + om EAN-oppslag er tilgjengelig |

`get_price_observations` gjør ett sideoppslag per kvittering; `max_receipts`
begrenser (standard 25).

## CLI

```sh
trumf-connector purchases --from 2026-06-01
trumf-connector receipt <batchid>
trumf-connector observations --max 50 --ean
```

## Lisens

[MIT](LICENSE)
