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
  const items = [];
  const seen = new Set();

  // The news items are typically in a structure like:
  // <div class="item">
  //   <a href="...">
  //     <div class="iteminformation">
  //       <h3>Title</h3>
  //       <div class="itemdate">Date</div>
  //       <div class="itemdescription">Description</div>
  //     </div>
  //   </a>
  // </div>
  // Or sometimes the <a> is inside the h3, but based on debug output, the <a> wraps the content or is a parent.
  // Let's look for the specific structure seen in debug output:
  // Parent class: item
  // Grandparent class: itemlist

  // We'll iterate over elements that look like news items.
  // Based on debug output, we can select by class .item or .iteminformation

  $('.item').each((_, el) => {
    const $el = $(el);
    const $info = $el.find('.iteminformation');
    if ($info.length === 0) return;

    const title = $info.find('h3').text().trim();
    const dateStr = $info.find('.itemdate').text().trim();
    const description = $info.find('.itemdescription').text().trim();

    // The link is usually on the parent <a> tag if the structure is <a href><div class="item">...</div></a>
    // OR inside the item.
    // In the debug output: 
    // Href: /stockholm/brf/svetsaren/nyheter/nytt-kosystem-for-p-platser/
    // HTML: <div class="iteminformation ">...</div>
    // Parent class: item
    // It seems the <a> tag might be the parent of .item or .item is inside <a>.
    // Let's check if the element itself is an <a> or has an <a> parent or child.

    let link = $el.find('a').attr('href');
    if (!link) {
      // Check if the item itself is wrapped in an anchor or is an anchor
      if ($el.is('a')) link = $el.attr('href');
      else link = $el.closest('a').attr('href');
    }

    // If still no link, try to find it in the h3
    if (!link) {
      link = $info.find('h3 a').attr('href');
    }

    // Debug output showed: 
    // Link Href: /stockholm/brf/svetsaren/nyheter/...
    // HTML: <div class="iteminformation ">...</div>
    // Parent class: item
    // This implies the structure is likely: <div class="item"> <a href="..."> ... </a> </div> OR <a href...><div class="item">...</div></a>
    // Wait, the debug script did $('a').each...
    // And it found the link.
    // So we can just iterate over 'a' tags that contain .iteminformation or are inside .item

  });

  // Let's use a more direct approach matching the debug script's findings.
  // The debug script found links that contain '/nyheter/'.
  // And those links contained the text and HTML.

  $('a').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href');

    // Filter for news links
    if (!href || !href.includes('/nyheter/')) return;

    // We want to find the structured content inside this link
    const $info = $a.find('.iteminformation');
    if ($info.length === 0) return;

    const title = $info.find('h3').text().trim();
    const dateStr = $info.find('.itemdate').text().trim();
    let description = $info.find('.itemdescription').text().trim();

    // Clean up description (remove "Läs mer" etc if present, though HSB seems clean)

    if (!title || !dateStr) return;

    const date = parseSwedishDate(dateStr);
    if (!date) return;

    // Resolve relative URL
    const fullLink = href.startsWith('http') ? href : new URL(href, SOURCE_URL).toString();

    const key = `${title}::${date.toISOString()}`;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      title,
      link: fullLink,
      guid: fullLink,
      pubDate: date,
      description,
    });
  });

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


