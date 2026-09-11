// Run every scraped script through PineTS, each in its own process, and write report.json + report.md.
// Usage: [CONCURRENCY=4] bun run.mjs [symbol=BTCUSDT] [timeframe=60] [bars=1000]
import { PineTS, Provider } from 'pinets';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DIR = import.meta.dir;
const SCRIPTS = join(DIR, 'scripts');
const TIMEOUT_MS = 120_000;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

async function runOne(file, symbol, tf, bars) {
    const res = {};
    const t0 = performance.now();
    try {
        const ctx = await new PineTS(Provider.Binance, symbol, tf, Number(bars)).run(readFileSync(join(SCRIPTS, file), 'utf8'));
        const plots = Object.entries(ctx.plots || {});
        const series = plots.filter(([k]) => !k.startsWith('__'));
        const hasNumbers = (data = []) => data.some((d) => typeof d?.value === 'number' && Number.isFinite(d.value));
        res.status = 'OK';
        res.plots = series.length;
        res.plotsWithNumbers = series.filter(([, p]) => hasNumbers(p.data)).length;
        res.drawings = Object.fromEntries(
            plots
                .filter(([k]) => k.startsWith('__'))
                .map(([k, p]) => [k.replaceAll('_', ''), (p.data?.at(-1)?.value || []).length])
                .filter(([, n]) => n > 0)
        );
    } catch (e) {
        res.status = 'ERR';
        res.error = String(e?.message ?? e).split('\n')[0].slice(0, 240);
    }
    res.ms = Math.round(performance.now() - t0);
    console.log('__RESULT__' + JSON.stringify(res));
}

function category(r) {
    if (r.status === 'OK') return r.plotsWithNumbers || Object.keys(r.drawings).length ? 'OK' : 'OK, no output';
    if (/Unsupported Pine Script version/.test(r.error)) return 'unsupported version';
    if (/Failed to transpile/.test(r.error)) return 'transpile error';
    return { SKIP: 'not scraped', TIMEOUT: 'timeout' }[r.status] ?? 'runtime error';
}

// Groups errors that differ only in numbers (indices, line:col, temp var ids) or engine detail.
const signature = (error) => error.replace(/\s*\(In '.*$/, '').replace(/\d+/g, 'N');

if (process.argv[2] === '--one') {
    await runOne(...process.argv.slice(3));
    process.exit(0);
}

const [symbol = 'BTCUSDT', tf = '60', bars = '1000'] = process.argv.slice(2);
const index = JSON.parse(readFileSync(join(SCRIPTS, 'index.json'), 'utf8'));
const pinetsVersion = JSON.parse(readFileSync(join(DIR, 'node_modules/pinets/package.json'), 'utf8')).version;

async function runChild(s) {
    if (s.error) return { status: 'SKIP', error: s.error };
    const p = Bun.spawn(['bun', import.meta.path, '--one', s.file, symbol, tf, bars], { stdout: 'pipe', stderr: 'pipe' });
    let timedOut = false;
    const timer = setTimeout(() => ((timedOut = true), p.kill()), TIMEOUT_MS);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(timer);
    const line = out.split('\n').find((l) => l.startsWith('__RESULT__'));
    if (line) return JSON.parse(line.slice('__RESULT__'.length));
    return timedOut
        ? { status: 'TIMEOUT', error: `timeout after ${TIMEOUT_MS / 1000}s` }
        : { status: 'CRASH', error: err.trim().split('\n').at(-1)?.slice(0, 240) };
}

const rows = new Array(index.scripts.length);
let next = 0;
let done = 0;
await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
        while (next < index.scripts.length) {
            const i = next++;
            const s = index.scripts[i];
            const r = await runChild(s);
            rows[i] = { ...s, ...r, category: category(r) };
            done++;
            console.log(`[${done}/${rows.length}] #${s.rank} v${s.pineVersion ?? '?'} ${rows[i].category.padEnd(20)} ${s.name}${r.error ? `\n     ${r.error}` : ''}`);
        }
    })
);

const tally = (key) => Object.entries(rows.reduce((m, r) => ((m[key(r)] = (m[key(r)] || 0) + 1), m), {})).map(([k, v]) => `${k}: ${v}`).join(' · ');
const esc = (s) => String(s ?? '').replaceAll('|', '\\|');
const groups = {};
for (const r of rows.filter((r) => r.error)) (groups[signature(r.error)] ??= []).push(r);

const md = [
    `# PineTS run: ${index.sort} top ${rows.length} open-source indicators`,
    '',
    `Scraped ${index.scrapedAt} · run ${new Date().toISOString()} · pinets ${pinetsVersion} · Binance ${symbol} ${tf} · ${bars} bars`,
    '',
    `**Result:** ${tally((r) => r.category)}`,
    '',
    `**Pine versions:** ${tally((r) => `v${r.pineVersion ?? '?'}`)}`,
    '',
    '## Errors by signature',
    '',
    ...Object.entries(groups)
        .sort((a, b) => b[1].length - a[1].length)
        .flatMap(([sig, rs]) => [`### ${rs.length}× ${esc(sig)}`, '', ...rs.map((r) => `- #${r.rank} [${esc(r.name)}](${r.url}) [${esc(r.author)}]`), '']),
    '## All scripts',
    '',
    '| # | Script | Pine | Result | Plots (numeric) | Drawings | ms | Error |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(
        (r) =>
            `| ${[
                r.rank,
                `[${esc(r.name)}](${r.url})`,
                r.pineVersion ?? '?',
                r.category,
                r.plots == null ? '' : `${r.plots} (${r.plotsWithNumbers})`,
                Object.entries(r.drawings ?? {}).map(([k, n]) => `${k} ${n}`).join(', '),
                r.ms ?? '',
                esc(r.error),
            ].join(' | ')} |`
    ),
];
writeFileSync(join(DIR, 'report.json'), JSON.stringify({ symbol, tf, bars, pinetsVersion, rows }, null, 2));
writeFileSync(join(DIR, 'report.md'), md.join('\n') + '\n');
console.log(`\n${tally((r) => r.category)}\n-> report.md, report.json`);
