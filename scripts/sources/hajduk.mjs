import { getText, getJson } from '../lib/http.mjs';
import { parseFeed } from '../lib/xml.mjs';
import { decodeEntities, toPlainText, truncate, fold } from '../lib/text.mjs';
import { dedupeArticles } from '../lib/dedupe.mjs';
import { parseMonthHeader, parseDayTime, zagrebToUtcIso } from '../lib/hr-dates.mjs';

const OFFICIAL_RSS = 'https://hajduk.hr/sadrzaj/rss/vijesti.xml';
const SCHEDULE = 'https://hajduk.hr/json/ova_sezona/raspored.json';
const STANDINGS = 'https://hajduk.hr/json/ova_sezona/prvenstvo_poredak.json';
const SEASON = 'https://hajduk.hr/json/ova_sezona/sve_utakmice.json';
const SD_RSS = 'https://www.slobodnadalmacija.hr/feed';
const PLAYER_BASE = 'https://hajduk.hr/prva-momcad/';

const COMPETITIONS = {
  PRV: 'SuperSport HNL',
  KUP: 'Hrvatski nogometni kup',
  EUR: 'Europa',
  SUPERKUP: 'Superkup',
};

/** Youth, women's and reserve sides share the news feed; keep the first team. */
const NOT_FIRST_TEAM = [
  'hnlz', 'znk', 'hajduk ii', 'hajducice', 'hajducica', 'pioniri', 'pionira',
  'kadeti', 'kadeta', 'juniori', 'juniora', 'u-19', 'u-17', 'u-15', 'u-13',
  'omladinci', 'akademij',
];

export async function collectHajduk() {
  const [rss, schedule, standings, season, sd] = await Promise.allSettled([
    getText(OFFICIAL_RSS),
    // NOTE: these /json/ endpoints answer 403 from datacenter IPs (GitHub
    // runners). Tried browser-like referer/origin/sec-fetch headers: no
    // effect, the block is by address. The store keeps the last good copy.
    getJson(SCHEDULE),
    getJson(STANDINGS),
    getJson(SEASON),
    getText(SD_RSS),
  ]);

  const sources = [];
  const officialItems =
    rss.status === 'fulfilled' ? parseFeed(rss.value).items : [];
  sources.push(status('hajduk.hr', 'https://hajduk.hr', rss, officialItems.length));

  const news = buildNews(officialItems, sd, sources);
  const fixtures = schedule.status === 'fulfilled' ? buildFixtures(schedule.value) : [];
  const table = standings.status === 'fulfilled' ? buildStandings(standings.value) : [];
  const results = buildResults(officialItems);
  const scorers = season.status === 'fulfilled' ? buildScorers(season.value) : [];

  sources.push(status('hajduk.hr/raspored', 'https://hajduk.hr/utakmice', schedule, fixtures.length));
  sources.push(status('hajduk.hr/poredak', 'https://hajduk.hr/utakmice', standings, table.length));
  sources.push(status('hajduk.hr/strijelci', 'https://hajduk.hr/utakmice', season, scorers.length));

  return {
    club: 'HNK Hajduk Split',
    sources,
    news,
    fixtures,
    nextMatch: fixtures[0] || null,
    results,
    standings: table,
    scorers,
  };
}

/* -------------------------------------------------------------- scorers */

/**
 * The season stats blob carries several unlabelled blocks; the scorers live
 * under `strijelci_asistencije`. Ranks come blank for ties ("", "", "5."),
 * so they are recomputed here with proper tie handling.
 */
function buildScorers(json) {
  const blocks = json?.sve_utakmice || [];
  const block = blocks.find((b) => b.strijelci_asistencije)?.strijelci_asistencije;
  const rows = block?.find((b) => b.strijelci)?.strijelci || [];

  let lastGoals = null;
  let lastRank = 0;

  return rows
    .map((r) => ({
      player: clean(r.igrac),
      goals: num(r.broj_golova),
      league: num(r.broj_golova_prv),
      cup: num(r.broj_golova_kup),
      europe: num(r.broj_golova_eur),
      supercup: num(r.broj_golova_spk),
      profile: r.link_na_profil ? PLAYER_BASE + clean(r.link_na_profil) : '',
    }))
    .filter((r) => r.player && r.goals > 0)
    .map((r, i) => {
      if (r.goals !== lastGoals) {
        lastRank = i + 1;
        lastGoals = r.goals;
      }
      return { ...r, rank: lastRank, tied: r.goals === lastGoals && lastRank !== i + 1 };
    });
}

/* ------------------------------------------------------------------ news */

function buildNews(officialItems, sd, sources) {
  const official = officialItems
    .filter((it) => it.title && it.link)
    .map((it) => ({
      title: it.title,
      link: it.link,
      source: 'hajduk.hr',
      official: true,
      publishedAt: it.publishedAt,
      summary: truncate(it.summary, 170),
      image: it.image || '',
    }));

  let extra = [];
  if (sd.status === 'fulfilled') {
    const all = parseFeed(sd.value).items;
    extra = all
      .filter((it) => it.title && it.link && mentionsHajduk(it))
      .map((it) => ({
        title: it.title,
        link: it.link,
        source: 'Slobodna Dalmacija',
        official: false,
        publishedAt: it.publishedAt,
        summary: truncate(it.summary, 170),
        image: it.image || '',
      }));
    sources.push({
      name: 'Slobodna Dalmacija',
      home: 'https://www.slobodnadalmacija.hr',
      ok: true,
      count: extra.length,
      note: `${extra.length} od ${all.length} članaka spominje Hajduk`,
    });
  } else {
    sources.push(status('Slobodna Dalmacija', 'https://www.slobodnadalmacija.hr', sd, 0));
  }

  const pool = [...official, ...extra].sort(
    (a, b) => ts(b.publishedAt) - ts(a.publishedAt)
  );
  return dedupeArticles(pool).slice(0, 20);
}

function mentionsHajduk(item) {
  const hay = fold(`${item.title} ${item.link} ${item.summary}`);
  return hay.includes('hajduk') || hay.includes('poljud');
}

/* -------------------------------------------------------------- fixtures */

function buildFixtures(json) {
  const months = json?.raspored?.miseci || [];
  const out = [];

  for (const block of months) {
    const header = parseMonthHeader(block.misec || '');
    for (const m of block.utakmice || []) {
      const label = clean(m.protivnik);
      if (!label) continue;
      const when = parseDayTime(m.datum || '');
      const month = when?.month || header?.month;
      const year = header?.year;

      let startsAt = null;
      let timeKnown = false;
      if (when?.day && month && year) {
        // The source writes "u 00:00h" for matches whose kick-off is still
        // open; anchor those at midday so the date never slips a day.
        timeKnown = when.hour != null && !(when.hour === 0 && when.minute === 0);
        startsAt = timeKnown
          ? zagrebToUtcIso(year, month, when.day, when.hour, when.minute ?? 0)
          : zagrebToUtcIso(year, month, when.day, 12, 0);
      }

      const [home, away] = splitTeams(label);
      out.push({
        home,
        away,
        label,
        isHome: clean(m.stadion).toLowerCase().startsWith('doma'),
        venue: [clean(m.mjesto).replace(/,\s*$/, ''), clean(m.stadion)]
          .filter(Boolean)
          .join(' · '),
        competition: clean(m.natjecanje),
        competitionName: COMPETITIONS[clean(m.natjecanje)] || clean(m.natjecanje),
        round: clean(m.opis),
        dateText: clean(m.datum),
        monthLabel: clean(block.misec),
        startsAt,
        timeKnown,
      });
    }
  }

  return out.sort((a, b) => ts(a.startsAt) - ts(b.startsAt));
}

/* ------------------------------------------------------------- standings */

function buildStandings(json) {
  return (json?.poredak || []).map((r) => ({
    position: num(r.mjesto),
    club: clean(r.klub),
    played: num(r.utakmica),
    won: num(r.pobjeda),
    drawn: num(r.remija),
    lost: num(r.izgubljenih),
    goalsFor: num(r.gol_za),
    goalsAgainst: num(r.gol_protiv),
    goalDiff: num(r.gol_razlika),
    points: num(r.bodova),
    isHajduk: String(r.jeli_hadjuk) === '1',
  }));
}

/* --------------------------------------------------------------- results */

/**
 * hajduk.hr publishes no results endpoint, but every match report is titled
 * with the score ("Zagreb: Lokomotiva - Hajduk 1:2"), so the official feed is
 * still the authoritative source. refresh.mjs accumulates these over time.
 */
function buildResults(officialItems) {
  const out = [];
  for (const it of officialItems) {
    const parsed = parseScoreTitle(it.title);
    if (!parsed) continue;
    out.push({
      ...parsed,
      // The article id is the stable key: backfill reaches the same article
      // through /vijest/x/<id>, so links alone would double up.
      id: articleId(it.link),
      link: it.link,
      playedAt: it.publishedAt,
      detail: truncate(it.summary, 90),
      source: 'hajduk.hr',
    });
  }
  return out;
}

export function parseScoreTitle(rawTitle = '') {
  const title = toPlainText(decodeEntities(rawTitle));
  const m = title.match(
    /^(?:(.{2,40}?):\s*)?(.{2,40}?)\s+[-–—]\s+(.{2,40}?)\s+(\d{1,2})\s*:\s*(\d{1,2})\s*$/
  );
  if (!m) return null;

  const [, prefix = '', homeRaw, awayRaw, hs, as] = m;
  const folded = fold(title);
  if (NOT_FIRST_TEAM.some((bad) => folded.includes(bad))) return null;

  const home = homeRaw.trim();
  const away = awayRaw.trim();
  const isHome = fold(home) === 'hajduk';
  const isAway = fold(away) === 'hajduk';
  if (!isHome && !isAway) return null;

  const homeScore = Number(hs);
  const awayScore = Number(as);
  const ours = isHome ? homeScore : awayScore;
  const theirs = isHome ? awayScore : homeScore;

  return {
    home,
    away,
    homeScore,
    awayScore,
    isHome,
    opponent: isHome ? away : home,
    outcome: ours > theirs ? 'W' : ours < theirs ? 'L' : 'D',
    note: prefix.trim(),
    friendly: fold(prefix).includes('prijateljsk'),
  };
}

/* ----------------------------------------------------------------- utils */

function splitTeams(label) {
  const parts = label.split(/\s+[-–—]\s+/);
  return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : [label, ''];
}

const articleId = (link = '') => (String(link).match(/\/(\d+)\s*$/) || [])[1] || '';

const clean = (v) => toPlainText(decodeEntities(String(v ?? '')));
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const ts = (iso) => (iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER);

function status(name, home, settled, count) {
  return settled.status === 'fulfilled'
    ? { name, home, ok: true, count }
    : {
        name,
        home,
        ok: false,
        count: 0,
        error: String(settled.reason?.message || settled.reason).slice(0, 160),
      };
}
