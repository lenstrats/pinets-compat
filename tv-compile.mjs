// Compile scripts with TradingView's own Pine compiler (pine-facade translate_light) to check whether
// errors PineTS reports also exist on TradingView. Compile-time only: runtime errors can't be checked here.
// Usage: bun tv-compile.mjs [report.json] [--all]   (default: only scripts that were not OK in PineTS)
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DIR = import.meta.dir;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const ENDPOINT = 'https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (e) => `${e.code ?? ''} ${e.start ? `${e.start.line}:${e.start.column} ` : ''}${String(e.message ?? '').replace(/\{(\w+)\}/g, (_, k) => e.ctx?.[k] ?? k)}`.trim();

export async function tvCompile(source) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'User-Agent': UA, Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
            body: new URLSearchParams({ source }),
        });
        if (res.ok) {
            const d = await res.json();
            const r = d.result ?? {};
            const errors = (r.errors2 ?? r.errors ?? []).map(fmt);
            if (!d.success) errors.push(String(d.reason ?? JSON.stringify(d).slice(0, 200)));
            return { compiles: errors.length === 0, errors, warnings: (r.warnings2 ?? r.warnings ?? []).map(fmt) };
        }
        if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`HTTP ${res.status}`);
        await sleep(3000 * attempt);
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const reportPath = args.find((a) => a.endsWith('.json')) ?? join(DIR, 'report.json');
    const { rows } = JSON.parse(readFileSync(reportPath, 'utf8'));
    const targets = rows.filter((r) => args.includes('--all') || r.category !== 'OK');
    const out = [];
    for (const [i, r] of targets.entries()) {
        let tv;
        try {
            tv = await tvCompile(readFileSync(join(DIR, 'scripts', r.file), 'utf8'));
        } catch (e) {
            tv = { compiles: null, errors: [`request failed: ${e.message}`], warnings: [] };
        }
        out.push({ rank: r.rank, name: r.name, url: r.url, pinetsCategory: r.category, pinetsError: r.error, tvCompiles: tv.compiles, tvErrors: tv.errors, tvWarnings: tv.warnings.length });
        const verdict = tv.compiles === null ? 'UNKNOWN ' : tv.compiles ? 'compiles' : 'ERRORS  ';
        console.log(`[${i + 1}/${targets.length}] #${r.rank} TV ${verdict} | PineTS ${r.category}${tv.compiles ? '' : `\n     TV: ${tv.errors.slice(0, 2).join(' | ')}`}`);
        await sleep(700);
    }
    writeFileSync(join(DIR, 'tv-compile.json'), JSON.stringify({ checkedAt: new Date().toISOString(), report: reportPath, rows: out }, null, 2));
    const tally = {};
    for (const o of out) {
        const k = `PineTS ${o.pinetsCategory} → TV ${o.tvCompiles === null ? 'unknown' : o.tvCompiles ? 'compiles' : 'errors'}`;
        tally[k] = (tally[k] || 0) + 1;
    }
    console.log('\n' + Object.entries(tally).map(([k, v]) => `${String(v).padStart(3)}× ${k}`).join('\n') + '\n-> tv-compile.json');
}
