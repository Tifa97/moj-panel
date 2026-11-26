# Moj panel

Osobni info panel kao progressive web app. Tri panela, tri akcenta:

| Panel | Sadržaj | Boje |
|---|---|---|
| **Dubrovnik** | nadolazeća događanja u gradu + vijesti, grupirano po danu | bijela + zlatna `#B8902B` |
| **Hajduk** | sljedeća utakmica, rezultati, raspored, HNL tablica, strijelci, vijesti | bijela + hajdučka plava `#014EA2` |
| **Vrijeme** | prognoza za Dubrovnik, Zagreb i mjesta koja sam dodaš | bijela + svijetlo plava `#2D8FD5` |

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
| Dubrovnik — vijesti | [dulist.hr](https://dulist.hr), [dubrovniknet.hr](https://www.dubrovniknet.hr) | RSS |
| Dubrovnik — događanja | [dubrovnikdanas.com](https://dubrovnikdanas.com/kalendar-dogadanja-dubrovnik/) | schema.org `ItemList` iz JSON-LD-a |
| Hajduk — vijesti | [hajduk.hr](https://hajduk.hr) službeni RSS | RSS |
| Hajduk — vijesti | [slobodnadalmacija.hr](https://www.slobodnadalmacija.hr) | glavni RSS, filtriran na Hajduk |
| Hajduk — raspored | `hajduk.hr/json/ova_sezona/raspored.json` | službeni JSON |
| Hajduk — tablica | `hajduk.hr/json/ova_sezona/prvenstvo_poredak.json` | službeni JSON |
| Hajduk — rezultati | naslovi izvještaja s utakmica na hajduk.hr | parsiranje rezultata iz naslova |
| Hajduk — strijelci | `hajduk.hr/json/ova_sezona/sve_utakmice.json` | službeni JSON |
| Vrijeme | [Open-Meteo](https://open-meteo.com) | REST, bez API ključa |
| Traženje mjesta | [Open-Meteo geocoding](https://open-meteo.com) | REST, bez API ključa |

Panel ispod svake kartice pokazuje koji su izvori korišteni i je li neki pao.

### Događanja

Kalendar na dubrovnikdanas.com objavljuje schema.org `ItemList` s `Event`
objektima, pa se ne scrapa HTML — strukturirani podaci već nose vrijeme,
mjesto, kategoriju i cijenu. Sami događaji dolaze od turističke zajednice
(experiencedubrovnik.com), kamo vode i linkovi.

Jedna kvaka: dugotrajnim izložbama JSON-LD upisuje `endDate` jednak danu
otvorenja, iako na stranici stoji "do 19.1.". Takve bi ispale iz filtera, pa
se vodi ovo pravilo: kalendar nosi samo aktualno i buduće, dakle stavka koja
je počela ranije a još je na popisu — još traje. U prikazu je označena kao
"u tijeku".

### Vlastita mjesta za prognozu

Dubrovnik i Zagreb su stalni i ne mogu se ukloniti. Ostalo se traži preko
Open-Meteo geocodera (bez ključa, CORS otvoren) i sprema u `localStorage`
pod `cip:places`, najviše 6 mjesta. Dodana mjesta postoje samo u browseru —
build snapshot i dalje nosi samo dva stalna grada, pa se njihova prognoza
dohvaća uživo i offline dolazi iz service worker cachea.

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

## Sekcije u harmonici

Dubrovnik ima **Događanja** i **Vijesti**, a unutar Događanja je svaki dan
svoja podsekcija. Hajduk ima **Rezultate**, **Raspored**, **SuperSport HNL**,
**Strijelce** i **Vijesti**. Hero, obavijesti i kartica sljedeće utakmice
ostaju izvan harmonike jer su kratki i uvijek relevantni.

Građeno na `<details>`/`<summary>` pa tipkovnica, čitači ekrana i pretraga
unutar stranice rade bez dodatnog koda.

Zadano je sve otvoreno — osim dana unutar Događanja, gdje je otvoren samo
današnji jer je tamo i nastala duljina (40 događanja kroz dva tjedna). Što
otvoriš ili zatvoriš pamti se u `localStorage` pod `cip:sections`. Dnevni
ključevi nose datum i brišu se kad prođu, pa taj zapis ne raste.

## Obavijesti o utakmicama

U Hajduk panelu se uključuju jednim gumbom. Javljaju dvije stvari:

- **na dan utakmice** — "Danas igra Hajduk", s protivnikom, satom i kolom
- **rezultat** — "Pobjeda Hajduka", s rezultatom i opisom iz izvještaja

Obje nastaju **pri sinkronizaciji podataka**: na otvaranju appa, pri povratku
u app nakon 5 minuta, i na ručni refresh. Nema push servera, pa app ne može
javiti dok je zatvorena — ovo je dokle se ide bez njega.

Detalji:

- Pri uključivanju se postojeći rezultati označe kao viđeni da se ne reproducira
  cijela sezona; utakmica koja je danas se svejedno javi, što ujedno potvrdi
  da stvar radi.
- Rezultati stariji od 4 dana se ne javljaju — to je povijest, ne vijest.
- Svaka obavijest ima svoj `tag` pa se tri rezultata odjednom ne pregaze.
- Viđene stavke se pamte u `localStorage` pod `cip:notify` (zadnjih 120).
- Klik na obavijest otvara app na Hajduk panelu, odnosno izvještaj s utakmice
  ako ga ima.
- Hajduk podaci se dohvate u pozadini i kad je otvoren drugi panel, inače bi
  obavijest ovisila o tome gdje si zadnji put stao.

### Što bi trebalo za pravi push

Da obavijest stigne bez otvaranja appa treba Web Push: VAPID ključevi,
`push` handler u service workeru i nešto što šalje u pravi čas. Cron iz
Actionsa bi to mogao, ali subscription je *capability URL* — tko ga ima,
može slati obavijesti na uređaj — pa ne smije u javni repo, nego u repo
secret. Uz to traži ili `web-push` dependency ili ručni VAPID JWT i AES128GCM
enkripciju. Izvedivo, ali je to drugi red složenosti od ovoga.

## PWA

- `manifest.webmanifest` — standalone, ikone 192/512 + maskable, shortcuti po panelu
- `sw.js` — shell *network-first* s 1.5 s timeoutom (online uvijek aktualan kod),
  podaci *network-first*, `/api/` samo s mreže uz zrcaljenje u cache
- Radi offline: zadnji učitani paneli ostaju dostupni
- `theme-color` se mijenja po aktivnom panelu
- `notificationclick` u service workeru vraća fokus na app

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
    notify.js           obavijesti o utakmicama i rezultatima
    places.js           vlastita mjesta + geocoding
    views/              dubrovnik | events | hajduk | weather | accordion | shared
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
- **Geocoder slabije nalazi mala mjesta** jer rangira po broju stanovnika;
  npr. "Vis" vrati veće gradove iz svijeta. Pomaže puno ime mjesta.
