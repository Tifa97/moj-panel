# Moj panel

Osobni info panel kao progressive web app. Tri panela, tri akcenta:

| Panel | Sadržaj | Boje |
|---|---|---|
| **Dubrovnik** | vijesti iz Dubrovnika, grupirane po danu | bijela + zlatna `#B8902B` |
| **Hajduk** | sljedeća utakmica, rezultati, raspored, HNL tablica, vijesti | bijela + hajdučka plava `#014EA2` |
| **Vrijeme** | prognoza za Dubrovnik i Zagreb — sada, po satima, 7 dana | bijela + svijetlo plava `#2D8FD5` |

Svi podaci su stvarni. Nema dependencyja — ni za build, ni u browseru.

## Pokretanje

```bash
npm run refresh     # povuče svježe podatke u public/data/
npm run serve       # http://localhost:4173
npm run dev         # oboje
```

Prvi put, da popuniš rezultate cijele sezone:

```bash
npm run backfill    # ~250 vijesti unatrag; "npm run backfill -- 600" ide dalje
npm run refresh
```

Server ispiše i LAN adresu (`http://192.168.x.x:4173`) pa app možeš otvoriti
na mobitelu na istoj Wi-Fi mreži i dodati ga na home screen.

## Izvori podataka

| Panel | Izvor | Kako |
|---|---|---|
| Dubrovnik | [dulist.hr](https://dulist.hr), [dubrovniknet.hr](https://www.dubrovniknet.hr) | RSS |
| Hajduk — vijesti | [hajduk.hr](https://hajduk.hr) službeni RSS | RSS |
| Hajduk — vijesti | [slobodnadalmacija.hr](https://www.slobodnadalmacija.hr) | glavni RSS, filtriran na Hajduk |
| Hajduk — raspored | `hajduk.hr/json/ova_sezona/raspored.json` | službeni JSON |
| Hajduk — tablica | `hajduk.hr/json/ova_sezona/prvenstvo_poredak.json` | službeni JSON |
| Hajduk — rezultati | naslovi izvještaja s utakmica na hajduk.hr | parsiranje rezultata iz naslova |
| Vrijeme | [Open-Meteo](https://open-meteo.com) | REST, bez API ključa |

Panel ispod svake kartice pokazuje koji su izvori korišteni i je li neki pao.

### Zašto rezultati idu preko naslova

hajduk.hr nema endpoint s odigranim utakmicama, ali svaki izvještaj nosi
rezultat u naslovu (`Zagreb: Lokomotiva - Hajduk 1:2`). Parser uzima samo prvu
momčad — filtrira ŽNK, Hajduk II, pionire, kadete i juniore — i razlikuje
prijateljske utakmice od natjecateljskih.

`npm run backfill` koristi to što se članci na hajduk.hr otvaraju i samo po
ID-u (`/vijest/x/18650`), pa hoda unatrag kroz ID-eve i pokupi rezultate
cijele sezone. Jedan prolaz, 4 paralelna zahtjeva.

## Build-time pipeline

```
scripts/refresh.mjs
  ├── sources/dubrovnik.mjs  ─┐
  ├── sources/hajduk.mjs     ─┼─→  data/store.json  ─→  public/data/*.json
  └── sources/weather.mjs    ─┘      (akumulira)          (što app čita)
```

`data/store.json` je u gitu i raste kroz vrijeme. RSS pokazuje samo zadnjih
par dana, pa svaki `refresh` spaja novo sa starim umjesto da ga pregazi. Ako
izvor padne, objavi se zadnje što je bilo ispravno i panel to označi.

Vrijeme je iznimka: snapshot ide u `public/data/weather.json` za offline, ali
app u browseru ide direktno na Open-Meteo (CORS je dopušten) i pokazuje
`uživo`. Ako to ne prođe, pada natrag na snapshot i piše `spremljeno`.

## PWA

- `manifest.webmanifest` — standalone, ikone 192/512 + maskable, shortcuti po panelu
- `sw.js` — shell ide *stale-while-revalidate*, podaci *network-first* s cache fallbackom
- Radi offline: zadnji učitani paneli ostaju dostupni
- `theme-color` se mijenja po aktivnom panelu

Ikone generira `npm run icons` (vlastiti PNG encoder, bez dependencyja).

## Struktura

```
public/                 ← ovo se deploya (statika, npr. GitHub Pages)
  index.html            SVG sprite + skeleton panela
  css/app.css           tokeni po panelu, mobile-first
  js/
    app.js              tabovi, učitavanje, live vrijeme, SW
    dom.js              el() / icon() helperi
    format.js           hrvatski datumi, relativno vrijeme, množina
    openmeteo.js        dijeli ga i Node i browser
    weather-codes.js    WMO kodovi → hrvatski opis + ikona
    views/              dubrovnik | hajduk | weather | shared
  data/                 generirano, ne diraj ručno
scripts/
  refresh.mjs           glavni pipeline
  backfill.mjs          jednokratno kopanje rezultata unatrag
  gen-icons.mjs         PNG ikone
  serve.mjs             dev server
  lib/                  http, xml, text, dedupe, store, hr-dates
data/store.json         akumulirani podaci (u gitu)
```

## Poznata ograničenja prototipa

- **Podaci su statični do sljedećeg `npm run refresh`** (osim vremena, koje je
  uživo). Kad ovo preraste build-time pristup, `scripts/sources/*` se
  presele iza malog backenda ili serverless funkcije — sučelje ostaje isto
  jer app čita samo `data/*.json`.
- **Duplikati u vijestima.** Dva portala isti događaj znaju objaviti pod
  dovoljno različitim naslovom da ih filter propusti.
- **Slobodna Dalmacija** nudi samo glavni RSS (sekcijski su 403), pa Hajduk
  vijesti otamo dolaze tek kad upadnu u zadnjih 50 članaka.
- **Rezultati nemaju točno vrijeme utakmice** — datum je vrijeme objave
  izvještaja, što je gotovo uvijek isti dan.
