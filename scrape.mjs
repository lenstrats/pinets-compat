// Scrape the top-N popular open-source TradingView indicators and their Pine source.
// Usage: bun scrape.mjs [N=30] [sort=latest_popular|recent]
// Output: scripts/<rank>-<name>.pine + scripts/index.json (the listing API caps at 1000 results)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const N = Number(process.argv[2] ?? 30);
const SORT = process.argv[3] ?? 'latest_popular';
const OUT = join(import.meta.dir, 'scripts');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const OPEN_SOURCE = 1; // script_access: 1 = open source, other values have no public source

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function getJson(url) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.tradingview.com/' } });
        if (res.ok) return res.json();
        if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`HTTP ${res.status} ${url}`);
        await sleep(2000 * attempt);
    }
}

// Static scan; note TradingView's `version` fields are publication revisions, not the Pine version.
function scan(src) {
    return {
        pineVersion: Number(src.match(/^\s*\/\/@version=(\d+)/m)?.[1]) || null,
        kind: src.match(/^\s*(indicator|strategy|library|study)\s*\(/m)?.[1] ?? null,
        imports: (src.match(/^\s*import\s+\S+/gm) || []).map((s) => s.trim().split(/\s+/)[1]),
        usesSecurity: /request\.security/.test(src),
        lines: src.split('\n').length,
    };
}

// The .pine files are generated output; clear them so stale ranks from an earlier scrape don't linger.
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT).filter((f) => f.endsWith('.pine'))) rmSync(join(OUT, f));

const picked = [];
const seen = new Set(); // rankings shift while paging, so the same script can show up twice
let skippedClosed = 0;
for (let page = 1; picked.length < N; page++) {
    const d = await getJson(`https://www.tradingview.com/api/v1/scripts/?script_type=indicators&sort=${SORT}&page=${page}&per_page=24`);
    for (const r of d.results) {
        if (picked.length >= N) break;
        if (seen.has(r.script_id_part)) continue;
        seen.add(r.script_id_part);
        if (r.script_access === OPEN_SOURCE) picked.push(r);
        else skippedClosed++;
    }
    if (!d.next) break;
    await sleep(500);
}

const scripts = [];
for (const [i, r] of picked.entries()) {
    const rank = String(i + 1).padStart(3, '0');
    const entry = { rank: i + 1, name: r.name, author: r.user?.username, likes: r.likes_count, url: r.chart_url, id: r.script_id_part, file: `${rank}-${slugify(r.name)}.pine` };
    try {
        const f = await getJson(`https://pine-facade.tradingview.com/pine-facade/get/${r.script_id_part}/last`);
        if (!f.source) throw new Error(`no source (scriptAccess=${f.scriptAccess})`);
        writeFileSync(join(OUT, entry.file), f.source);
        Object.assign(entry, scan(f.source));
    } catch (e) {
        entry.error = e.message;
    }
    scripts.push(entry);
    console.log(`${rank} v${entry.pineVersion ?? '?'} ${entry.error ? `ERR ${entry.error} ` : ''}${r.name} [${entry.author}]`);
    await sleep(400);
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify({ scrapedAt: new Date().toISOString(), sort: SORT, skippedClosed, scripts }, null, 2));
console.log(`\n${scripts.length} scripts -> scripts/index.json (skipped ${skippedClosed} closed-source)`);
