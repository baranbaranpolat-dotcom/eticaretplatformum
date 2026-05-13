#!/usr/bin/env node
/**
 * daily-update.js — updates the "Son güncelleme" banner date in index.html.
 * Runs every day via GitHub Actions cron. No external API calls.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HTML_PATH = 'index.html';
const html = readFileSync(HTML_PATH, 'utf8');

const today = new Date().toLocaleDateString('tr-TR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Europe/Istanbul'
});

// Update the inline last-update text rendered at runtime
// We bake today's date into the static HTML so it shows even without JS executing.
const bannerRegex = /(<span id="lastUpdate">)[^<]*(<\/span>)/;
if (!bannerRegex.test(html)) {
  console.error('Could not find lastUpdate span in index.html');
  process.exit(1);
}

const updated = html.replace(bannerRegex, `$1${today}$2`);

if (updated === html) {
  console.log('No date change needed — already up to date.');
  process.exit(0);
}

writeFileSync(HTML_PATH, updated, 'utf8');
console.log(`Updated last-update banner to: ${today}`);
