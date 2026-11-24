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
npm run serve       # http://localhost:4173
npm run refresh     # zapiše snapshot u public/data/ (za offline i statički deploy)
npm run dev         # oboje
```

Dok `npm run serve` radi, app **sama dohvaća najnovije podatke pri svakom
otvaranju i refreshu** — `npm run refresh` treba samo da osvježiš snapshot
koji ide u git.

Prvi put, da popuniš rezultate cijele sezone:

```bash
npm run backfill    # ~250 vijesti unatrag; "npm run backfill -- 600" ide dalje
npm run refresh
```

Server ispiše i LAN adresu (`http://192.168.x.x:4173`). Otvorit će se na
mobitelu, ali **service worker se preko plain HTTP-a na privatnoj IP adresi
ne registrira** — browseri traže HTTPS ili `localhost`. Za pravu PWA s
offlineom i "Add to Home Screen" koristi objavljenu verziju.

## Objavljeno

**https://tifa97.github.io/moj-panel/**

GitHub Action (`.github/workflows/pages.yml`) svakih 30 minuta povuče svježe
podatke, commita ih natrag u repo i deploya `public/` na Pages. Refresh i
deploy su namjerno u istom jobu: commit napravljen s `GITHUB_TOKEN`-om ne
okida druge workflowe, pa lanac "commit → deploy" ne bi radio.

Pokretanje ručno: `gh workflow run pages.yml`.

> Ako lokalno pokreneš `npm run refresh` i commitaš, prvo `git pull --rebase`.
> Generirani JSON-i se sudaraju s onima koje je commitao CI; svejedno je koju
> stranu uzmeš jer se oba regeneriraju.

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

## Odakle app čita podatke

Tri razine, redom:

1. **`/api/*.json`** — dok `npm run serve` radi, svaki zahtjev pokrene
   kolektore. Odgovor se cachira 3 minute (`API_TTL_MS`) pa niz refresheva
   pogađa izvore jednom; `?force=1` preskače cache. Cache se zagrijava pri
   startu servera, tako da prvo otvaranje ne čeka. Kad je ovo izvor, u
   zaglavlju piše **uživo**.
2. **`data/*.json` iz service worker cachea** — ako servera nema. Service
   worker svaki uspješan `/api/` odgovor zrcali pod `/data/` ključ, pa
   offline dobiješ zadnje *žive* podatke, ne zadnji commitani build.
3. **`public/data/*.json` sa diska** — statički hosting (GitHub Pages) ili
   prvo pokretanje. Ovo piše `npm run refresh`.

App osim toga tiho osvježi podatke kad joj se vratiš nakon 5 minuta
neaktivnosti.

## Pipeline

```
scripts/lib/pipeline.mjs
  ├── sources/dubrovnik.mjs  ─┐
  ├── sources/hajduk.mjs     ─┼─→  data/store.json  ─→  payloadi
  └── sources/weather.mjs    ─┘      (akumulira)
                                        ↓                    ↓
                              refresh.mjs             serve.mjs
                              public/data/*.json      /api/*.json
```

Isti kod vrti i jedno i drugo, pa se podaci ne mogu razići.

`data/store.json` je u gitu i raste kroz vrijeme. RSS pokazuje samo zadnjih
par dana, pa svaki `refresh` spaja novo sa starim umjesto da ga pregazi. Ako
izvor padne, objavi se zadnje što je bilo ispravno i panel to označi.

Vrijeme je iznimka: snapshot ide u `public/data/weather.json` za offline, ali
app u browseru ide direktno na Open-Meteo (CORS je dopušten) i pokazuje
`uživo`. Ako to ne prođe, pada natrag na snapshot i piše `spremljeno`.

## PWA

- `manifest.webmanifest` — standalone, ikone 192/512 + maskable, shortcuti po panelu
- `sw.js` — shell *network-first* s 1.5 s timeoutom (online uvijek aktualan kod),
  podaci *network-first*, `/api/` samo s mreže uz zrcaljenje u cache
- Radi offline: zadnji učitani paneli ostaju dostupni
- `theme-color` se mijenja po aktivnom panelu

Ikone generira `npm run icons` (vlastiti PNG encoder, bez dependencyja).

## Struktura

```
public/                 ← ovo se deploya (statika, npr. GitHub Pages)
  index.html            SVG sprite + skeleton panela
  css/app.css           tokeni po panelu, mobile-first
  js/
    app.js              tabovi, učitavanje (api → cache → snapshot), SW
    dom.js              el() / icon() helperi
    format.js           hrvatski datumi, relativno vrijeme, množina
    openmeteo.js        dijeli ga i Node i browser
    weather-codes.js    WMO kodovi → hrvatski opis + ikona
    views/              dubrovnik | hajduk | weather | shared
  data/                 generirano, ne diraj ručno
scripts/
  refresh.mjs           zapiše snapshot u public/data/
  serve.mjs             dev server + /api/*.json (živi podaci)
  backfill.mjs          jednokratno kopanje rezultata unatrag
  gen-icons.mjs         PNG ikone
  lib/pipeline.mjs      dijeljeni pipeline (refresh i serve zovu isto)
  lib/                  http, xml, text, dedupe, store, hr-dates
data/store.json         akumulirani podaci (u gitu)
```

## Poznata ograničenja prototipa

- **Živi `/api` traži da `npm run serve` radi** na nekom računalu u mreži.
  Na Pagesu app koristi snapshot koji cron osvježava svakih 30 min. Kad
  zatreba pravi live 24/7, `scripts/lib/pipeline.mjs` se seli u serverless
  funkciju — `buildPayloads()` je već jedina točka koju treba pozvati.
- **S GitHubovih runnera `hajduk.hr/json/*` vraća 403**, a Open-Meteo zna
  odbiti zahtjev. Blokada je po IP adresi (datacentar); probani su
  browserski `referer`/`origin`/`sec-fetch-*` — bez efekta. Posljedica:
  raspored i HNL tablica se u cloudu ne osvježavaju, nego se drži zadnja
  ispravna kopija iz `data/store.json`. Oboje se mijenja tjedno, a lokalni
  `npm run refresh` ih uvijek povuče. Prognoza nije pogođena jer je browser
  dohvaća direktno s Open-Meteoa.
- **Prvi dohvat traje ~5 s** ako je cache servera hladan (osam izvora
  paralelno). Zato se cache zagrijava pri startu.
- **Duplikati u vijestima.** Dva portala isti događaj znaju objaviti pod
  dovoljno različitim naslovom da ih filter propusti.
- **Slobodna Dalmacija** nudi samo glavni RSS (sekcijski su 403), pa Hajduk
  vijesti otamo dolaze tek kad upadnu u zadnjih 50 članaka.
- **Rezultati nemaju točno vrijeme utakmice** — datum je vrijeme objave
  izvještaja, što je gotovo uvijek isti dan.
