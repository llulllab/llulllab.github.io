#!/usr/bin/env node
// build-signals.mjs
// Single source of truth for homepage "Latest Signals" = updates.html.
// Reads the newest N update-blocks from each language's updates.html and
// regenerates the .signal-list block inside that language's index.html,
// between the <!-- signals:auto start --> / <!-- signals:auto end --> markers.
//
// updates.html is never rewritten by this script; it only reads from it.
// Per-block hints (optional, on the update-block element):
//   data-tag="Release"        label shown in the signal pill
//   data-signal="short text"  teaser text (falls back to the <strong> headline)
// The block's first <a class="update-link"> becomes the signal's link, so a
// homepage signal opens what the update is about (target="_blank" is kept).
// A block without an update-link renders as a plain, unlinked row.
// The file is authored newest-first, so the first N blocks are the newest N.
//
// Usage:  node tools/build-signals.mjs         (run from the repo root, after
//         editing any updates.html; then commit index.html + updates.html together)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const N = 4; // signals shown on the homepage

const MONTHS = {
  en: {
    long: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    short:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
  },
  fr: {
    long: ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"],
    short:["janv","fév","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"],
  },
};

const DEFAULT_TAG = { en: "Update", fr: "Mise à jour" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function attr(html, name) {
  const m = html.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// full localized "11 September 2026" -> short "11 Sep 2026"
function shortDate(dateText, lang) {
  const m = dateText.trim().match(/^(\d+)\s+(.+?)\s+(\d{4})$/);
  if (!m) return dateText.trim();
  const [, day, monthName, year] = m;
  const idx = MONTHS[lang].long.findIndex(
    (mn) => mn.toLowerCase() === monthName.toLowerCase()
  );
  if (idx === -1) return dateText.trim();
  return `${day} ${MONTHS[lang].short[idx]} ${year}`;
}

function extractSignals(updatesHtml, lang) {
  // grab each <div class="update-block" ...> ... </div-of-block>
  const blocks = [];
  const re = /<div class="update-block"([^>]*)>([\s\S]*?)(?=<div class="update-block"|<\/section>)/g;
  let mm;
  while ((mm = re.exec(updatesHtml)) !== null) {
    blocks.push({ openAttrs: mm[1], inner: mm[2] });
    if (blocks.length >= N) break;
  }
  return blocks.map((b) => {
    const dateText = (b.inner.match(/<div class="update-date">([\s\S]*?)<\/div>/) || [])[1] || "";
    const strong = (b.inner.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] || "";
    const tag = attr(b.openAttrs, "data-tag") || DEFAULT_TAG[lang];
    const signal =
      attr(b.openAttrs, "data-signal") ||
      strong.replace(/<[^>]+>/g, "").replace(/\.\s*$/, "").trim();
    const linkTag = (b.inner.match(/<a\s[^>]*class="update-link"[^>]*>/) || [])[0] || "";
    const href = linkTag ? attr(linkTag, "href") : null;
    const external = linkTag ? attr(linkTag, "target") === "_blank" : false;
    return { date: shortDate(dateText, lang), tag, signal, href, external };
  });
}

function renderList(signals) {
  const items = signals
    .map((s) => {
      // href is copied verbatim from updates.html, where it is already valid attribute text
      const open = s.href
        ? `<a class="signal-item" href="${s.href}"${s.external ? ' target="_blank" rel="noopener"' : ""}>`
        : `<div class="signal-item">`;
      const close = s.href ? "</a>" : "</div>";
      return `      ${open}
        <div class="signal-date">${esc(s.date)}</div>
        <div class="signal-text"><span class="signal-tag">${esc(s.tag)}</span>${esc(s.signal)}</div>
      ${close}`;
    })
    .join("\n");
  return `    <div class="signal-list">\n${items}\n    </div>`;
}

export { extractSignals, shortDate, renderList };

function buildLang(lang) {
  const updatesPath = join(ROOT, lang, "updates.html");
  const indexPath = join(ROOT, lang, "index.html");
  const signals = extractSignals(readFileSync(updatesPath, "utf8"), lang);
  if (signals.length === 0) throw new Error(`${lang}: no update-blocks found`);

  const index = readFileSync(indexPath, "utf8");
  const marker = /(<!-- signals:auto start[^>]*-->)[\s\S]*?(<!-- signals:auto end -->)/;
  if (!marker.test(index))
    throw new Error(`${lang}/index.html: signals:auto markers not found`);

  const next = index.replace(
    marker,
    (_, start, end) => `${start}\n${renderList(signals)}\n    ${end}`
  );
  writeFileSync(indexPath, next);
  console.log(`${lang}: wrote ${signals.length} signals ->`, signals.map((s) => `${s.date} [${s.tag}]`).join(" | "));
}

// run only when invoked directly (keeps functions importable for tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const lang of ["en", "fr"]) buildLang(lang);
}
