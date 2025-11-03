'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const RSS = require('rss');

const SOURCE_URL = 'https://www.hsb.se/stockholm/brf/svetsaren/nyheter/';
const OUTPUT_DIR = path.join(process.cwd(), 'docs');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'feed.xml');

const SWEDISH_MONTHS = {
  januari: 0,
  februari: 1,
  mars: 2,
  april: 3,
  maj: 4,
  juni: 5,
  juli: 6,
  augusti: 7,
  september: 8,
  oktober: 9,
  november: 10,
  december: 11,
};

function toRfc822(date) {
  return new Date(date).toUTCString();
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function parseSwedishDate(text) {
  // Matches: 02 november 2025, 9 april 2024, etc.
  const re = /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/i;
  const m = text.match(re);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  const year = parseInt(m[3], 10);
  const monthIndex = SWEDISH_MONTHS[monthName];
  if (monthIndex == null) return null;
  // Use noon local time to avoid DST issues, then convert to UTC
  const d = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
  return d;
}

function extractItems($) {
  // Heuristic extraction: find lines that include a Swedish date and treat the text before the date as title.
  // We scan block-level elements likely to contain the list, then split their text into logical lines.
  const containerCandidates = [
    'main',
    '[role="main"]',
    'section',
    'article',
    '.content',
    '.container',
    '.page-content',
  ];

  let textBlocks = [];
  for (const sel of containerCandidates) {
    $(sel).each((_, el) => {
      const txt = $(el).text().trim();
      if (txt && txt.toLowerCase().includes('nyheter')) {
        textBlocks.push(txt);
      }
    });
  }

  if (textBlocks.length === 0) {
    // Fallback: entire body text
    textBlocks.push($('body').text().trim());
  }

  const monthAlternation = Object.keys(SWEDISH_MONTHS).join('|');
  const lineRe = new RegExp(
    `^(.+?)\s+(\\d{1,2})\\s+(${monthAlternation})\\s+(\\d{4})(?:\s|$)`,
    'i'
  );

  const items = [];
  const seen = new Set();

  for (const block of textBlocks) {
    // Split by newlines and also by bullet-like separators
    const lines = block
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const m = line.match(lineRe);
      if (!m) continue;
      const title = m[1].replace(/^[-•*\s]+/, '').trim();
      const dateStr = `${m[2]} ${m[3]} ${m[4]}`;
      const date = parseSwedishDate(dateStr);
      if (!title || !date) continue;

      const key = `${title}::${date.toISOString()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Try to find a nearby anchor for a more precise link
      let link = SOURCE_URL + '#' + slugify(title);
      const anchor = $(`a:contains("${title}")`).first();
      if (anchor && anchor.attr('href')) {
        const href = anchor.attr('href');
        link = href.startsWith('http') ? href : new URL(href, SOURCE_URL).toString();
      }

      items.push({
        title,
        link,
        guid: link,
        pubDate: date,
        description: '',
      });
    }
  }

  // Deduplicate by GUID and sort descending by date
  const byGuid = new Map();
  for (const it of items) {
    if (!byGuid.has(it.guid)) byGuid.set(it.guid, it);
  }
  const unique = Array.from(byGuid.values());
  unique.sort((a, b) => b.pubDate - a.pubDate);
  return unique.slice(0, 50);
}

async function main() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'user-agent': 'svetsarennews-bot/1.0 (+github actions)'
    },
    timeout: 20000,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch source: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = extractItems($);

  const feed = new RSS({
    title: 'BRF Svetsaren – Nyheter',
    description: 'RSS 2.0-flöde genererat från HSB BRF Svetsarens nyhetssida.',
    feed_url: 'feed.xml',
    site_url: SOURCE_URL,
    language: 'sv-SE',
    pubDate: toRfc822(new Date()),
    ttl: 60 * 24,
    generator: 'svetsarennews (GitHub Actions)'
  });

  for (const it of items) {
    feed.item({
      title: it.title,
      url: it.link,
      guid: it.guid,
      date: it.pubDate,
      description: it.description || undefined,
    });
  }

  const xml = feed.xml({ indent: true });
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, xml, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote RSS with ${items.length} item(s) to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


