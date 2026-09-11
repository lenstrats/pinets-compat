// Compare two run.mjs reports made on the same scripts and cached data, to catch regressions from a PineTS change.
// Usage: bun compare.mjs <baseline.json> <candidate.json> [--flaky <baseline-rerun.json>]
// --flaky: a second run of the baseline; scripts whose output differs between the two (timenow, randomness)
// are excluded from value comparison. Exit code 1 on regressions or changed values.
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const flakyAt = args.indexOf('--flaky');
const flakyPath = flakyAt >= 0 ? args[flakyAt + 1] : null;
const [basePath, candPath] = args.filter((_, i) => flakyAt < 0 || (i !== flakyAt && i !== flakyAt + 1));

const load = (p) => new Map(JSON.parse(readFileSync(p, 'utf8')).rows.map((r) => [r.id ?? r.file, r]));
const ran = (r) => r.status === 'OK';
const signature = (e) => String(e ?? '').replace(/\s*\(In '.*$/, '').replace(/\d+/g, 'N');

const base = load(basePath);
const cand = load(candPath);
const flaky = new Set();
if (flakyPath) {
    for (const [id, r] of load(flakyPath)) {
        const b = base.get(id);
        if (b && (b.status !== r.status || b.fingerprint !== r.fingerprint)) flaky.add(id);
    }
}

const groups = { regression: [], valuesChanged: [], fixed: [], errorChanged: [], flaky: [], unchanged: [] };
for (const [id, b] of base) {
    const c = cand.get(id);
    if (!c) continue;
    if (flaky.has(id)) groups.flaky.push([b, c]);
    else if (ran(b) && !ran(c)) groups.regression.push([b, c]);
    else if (!ran(b) && ran(c)) groups.fixed.push([b, c]);
    else if (ran(b) && b.fingerprint !== c.fingerprint) groups.valuesChanged.push([b, c]);
    else if (!ran(b) && signature(b.error) !== signature(c.error)) groups.errorChanged.push([b, c]);
    else groups.unchanged.push([b, c]);
}

for (const [name, items] of Object.entries(groups)) {
    console.log(`${String(items.length).padStart(4)}× ${name}`);
    if (name === 'unchanged' || name === 'flaky') continue;
    for (const [b, c] of items) {
        console.log(`       #${b.rank} ${b.name}`);
        console.log(`         before: ${b.status}${b.error ? ` ${b.error.slice(0, 110)}` : ''}`);
        console.log(`         after:  ${c.status}${c.error ? ` ${c.error.slice(0, 110)}` : ''}`);
    }
}
process.exit(groups.regression.length || groups.valuesChanged.length ? 1 : 0);
