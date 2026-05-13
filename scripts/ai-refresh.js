#!/usr/bin/env node
/**
 * ai-refresh.js — Weekly AI-powered refresh of e-commerce platform data.
 *
 * For each platform with a URL, fetches the live page, sends it to Claude Haiku
 * to extract structured pricing/feature info, and updates the PLATFORMS data in
 * index.html. Designed to be conservative — only updates fields that the model
 * confidently extracted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const HTML_PATH = 'index.html';
const MODEL = 'claude-haiku-4-5-20251001';

const PLATFORM_URLS = {
  hemenmagaza: 'https://hemenmagaza.com',
  ikas: 'https://www.ikas.com/tr',
  ticimax: 'https://www.ticimax.com',
  ideasoft: 'https://www.ideasoft.com.tr',
  tsoft: 'https://www.tsoft.com.tr',
  shopify: 'https://www.shopify.com/pricing',
  bigcommerce: 'https://www.bigcommerce.com/essentials/pricing/',
  wix: 'https://www.wix.com/upgrade/website',
  squarespace: 'https://www.squarespace.com/pricing',
  shopiverse: 'https://shopiverse.com.tr',
  faprika: 'https://www.faprika.com'
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; eticaret-bot/1.0)' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
  } catch (err) {
    console.warn(`Fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

async function extractData(platformId, url, pageText) {
  const prompt = `Aşağıdaki "${platformId}" platformunun sayfasından şu bilgileri çıkar.
Sadece SAYFA İÇERİĞİNDE açıkça yer alan bilgiyi ver — uyduruk veri yazma.

İstenen JSON:
{
  "starter_price": "Başlangıç paket fiyatı, örn: '1.490₺/ay' veya 'Free' veya null",
  "growth_price": "Orta paket fiyatı veya null",
  "enterprise_price": "Üst paket fiyatı veya null",
  "trial": "Ücretsiz deneme süresi, örn: '14 gün' veya null",
  "customer_count": "Müşteri/mağaza sayısı, örn: '50.000+' veya null",
  "active_campaign": "Aktif kampanya/indirim bilgisi varsa kısa metin veya null",
  "notes": "Diğer dikkate değer güncel bilgi veya null"
}

Yalnızca JSON döndür, başka metin yok. Veri bulunmuyorsa alanları null bırak.

URL: ${url}

SAYFA İÇERİĞİ:
${pageText}`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    });
    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`AI extraction failed for ${platformId}: ${err.message}`);
    return null;
  }
}

function updatePlatformInHtml(html, platformId, data) {
  // Find the platform object in the PLATFORMS array
  const idRegex = new RegExp(`(id:\\s*'${platformId}'[\\s\\S]*?pricing:\\s*\\{)([^}]*)(\\})`);
  const m = html.match(idRegex);
  if (!m) {
    console.warn(`Platform ${platformId} not found in HTML`);
    return html;
  }

  let pricing = m[2];
  let changed = false;

  if (data.starter_price) {
    pricing = pricing.replace(/starter:\s*'[^']*'/, `starter: '${data.starter_price.replace(/'/g, "\\'")}'`);
    changed = true;
  }
  if (data.growth_price) {
    pricing = pricing.replace(/growth:\s*'[^']*'/, `growth: '${data.growth_price.replace(/'/g, "\\'")}'`);
    changed = true;
  }
  if (data.enterprise_price) {
    pricing = pricing.replace(/enterprise:\s*'[^']*'/, `enterprise: '${data.enterprise_price.replace(/'/g, "\\'")}'`);
    changed = true;
  }

  if (changed) {
    html = html.replace(idRegex, `$1${pricing}$3`);
  }

  // Update trial if found
  if (data.trial) {
    const trialRegex = new RegExp(`(id:\\s*'${platformId}'[\\s\\S]*?trial:\\s*)'[^']*'`);
    html = html.replace(trialRegex, `$1'${data.trial.replace(/'/g, "\\'")}'`);
  }

  // Update customer count if found
  if (data.customer_count) {
    const custRegex = new RegExp(`(id:\\s*'${platformId}'[\\s\\S]*?customers:\\s*)'[^']*'`);
    html = html.replace(custRegex, `$1'${data.customer_count.replace(/'/g, "\\'")}'`);
  }

  return html;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  let html = readFileSync(HTML_PATH, 'utf8');
  let updates = 0;
  const summary = [];

  for (const [platformId, url] of Object.entries(PLATFORM_URLS)) {
    process.stdout.write(`Fetching ${platformId} (${url})... `);
    const pageText = await fetchPage(url);
    if (!pageText) {
      console.log('skip (fetch failed)');
      summary.push(`${platformId}: fetch failed`);
      continue;
    }

    console.log(`got ${pageText.length} chars, extracting...`);
    const data = await extractData(platformId, url, pageText);
    if (!data) {
      summary.push(`${platformId}: extraction failed`);
      continue;
    }

    const before = html;
    html = updatePlatformInHtml(html, platformId, data);
    if (html !== before) {
      updates++;
      summary.push(`${platformId}: updated (${Object.entries(data).filter(([_, v]) => v).map(([k]) => k).join(', ')})`);
    } else {
      summary.push(`${platformId}: no changes`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  if (updates > 0) {
    writeFileSync(HTML_PATH, html, 'utf8');
    console.log(`\n✓ Updated ${updates} platform(s)`);
  } else {
    console.log('\n✓ No updates needed');
  }

  console.log('\n--- Summary ---');
  summary.forEach(s => console.log(`  ${s}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
