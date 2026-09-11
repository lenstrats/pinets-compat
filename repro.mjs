// Minimal repros for PineTS bugs and recent Pine v6 features, checked against TradingView's compiler and PineTS.
// Writes repros/<name>.pine (issue-ready) and repros/results.json.
// Usage: bun repro.mjs [name-filter]
import { PineTS, Provider } from 'pinets';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tvCompile } from './tv-compile.mjs';

const OUT = join(import.meta.dir, 'repros');
const I = (body) => `//@version=6\nindicator("repro")\n${body}\n`;
const S = (body) => `//@version=6\nstrategy("repro")\n${body}\n`;
const allNaN = (vals) => (vals.some(Number.isFinite) ? null : 'all values NaN');
const expectLast = (want) => (vals) => (vals.at(-1) === want ? null : `last=${JSON.stringify(vals.at(-1))}, expected ${want}`);

// bug: id from memory catalog pinets-known-bugs; check(values) returns a message when PineTS output is wrong.
const CASES = {
    'bug01-eager-ternary-array-get': { bug: '#297', code: I(`a = array.new<float>()\nx = array.size(a) > 0 ? array.get(a, 0) : 1.0\nplot(x)`) },
    'bug01-eager-and-array-get': { bug: '#297', code: I(`a = array.new<float>()\nok = array.size(a) > 0 and array.get(a, 0) > 0\nplot(ok ? 1 : 0)`) },
    'bug02-security-udf-second-call': { bug: '#278', code: I(`f(tf) => request.security(syminfo.tickerid, tf, close)\na = f("240")\nb = f("D")\nplot(b)`) },
    'bug03-timeframe-480': { bug: '#279', code: I(`plot(request.security(syminfo.tickerid, "480", close))`) },
    'bug03-timeframe-1440': { bug: '#279', code: I(`plot(request.security(syminfo.tickerid, "1440", close))`) },
    'bug03-timeframe-12M': { bug: '#279', code: I(`plot(request.security(syminfo.tickerid, "12M", close))`) },
    'bug04-continuation-starts-with-operator': { bug: '#252', code: I(`x = close\n     + open\nplot(x)`) },
    'bug05-tuple-after-switch': { bug: '#255', code: I(`f(s) =>\n    b = 3\n    a = switch s\n        "A" => 1\n        => 2\n    [a, b]\n[x, y] = f("A")\nplot(x)`) },
    'bug06-underscore-redeclared': { bug: '#250', code: I(`f() => [close, open]\n[_, a] = f()\n[_, b] = f()\nplot(a + b)`) },
    'bug07-named-args-nan': { bug: '#267', code: I(`plot(ta.sma(source = close, length = 5))`), check: allNaN },
    'bug08-method-on-float': { bug: '#267', code: I(`method dbl(float x) => x * 2\nplot(close.dbl())`) },
    'bug11-scale-namespace': { bug: 'new', code: `//@version=6\nindicator("repro", scale = scale.right)\nplot(close)\n` },
    'bug12-comment-indented-deeper': { bug: 'new', code: I(`var float x = 1.0  // first part of a comment\n                  // second part\nplot(x)`) },
    'bug12-comment-indented-deeper-udt-field': { bug: 'new', code: I(`type Z\n    float a = 1.0   // first part\n                    // second part\n    int b = 0\nz = Z.new()\nplot(z.a)`) },
    'bug13-import-library': { bug: 'new', code: I(`import TradingView/ta/9 as tvta\nplot(tvta.dema(close, 10))`) },
    'bug14-method-as-variable-name': { bug: 'new', code: I(`string method = input.string("A", "Method")\nplot(close)`) },
    'bug15-label-set-text-font-family': { bug: 'new', code: I(`if barstate.islast\n    l = label.new(bar_index, high, "x")\n    label.set_text_font_family(l, font.family_monospace)\nplot(close)`) },
    'bug16-udt-method-on-for-in-var': { bug: 'new', code: I(`type Zone\n    float lvl = 0.0\nmethod bump(Zone z) =>\n    z.lvl := close\nvar zones = array.from(Zone.new())\nfor z in zones\n    z.bump()\nplot(zones.get(0).lvl)`) },
    'bug17-const-inside-udf': { bug: 'new', code: I(`const int MAXB = 10\nf() => close[math.min(bar_index, MAXB)]\nplot(f())`) },
    'bug18-enum-as-param-type': { bug: 'new', code: I(`enum Mode\n    a\n    b\nf(Mode m) => m == Mode.a ? 1 : 0\nplot(f(Mode.a))`) },
    'bug19-comma-after-multiline-call': { bug: 'new', code: I(`a = 1\nplot(close, "c",\n     color = color.red), a += 1\nplot(a)`) },
    'bug20-request-financial': { bug: 'new', code: I(`plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FQ", ignore_invalid_symbol = true))`) },
    'bug20-request-earnings': { bug: 'new', code: I(`plot(request.earnings(syminfo.tickerid, earnings.actual, ignore_invalid_symbol = true))`) },
    'bug20-request-dividends': { bug: 'new', code: I(`plot(request.dividends(syminfo.tickerid, dividends.gross, ignore_invalid_symbol = true))`) },
    'bug20-request-currency-rate': { bug: 'new', code: I(`plot(request.currency_rate("EUR", "USD"))`) },
    'bug21-table-cell-set-text-formatting': { bug: 'new', code: I(`var t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "x")\n    table.cell_set_text_formatting(t, 0, 0, text.format_bold)\nplot(close)`) },
    'bug22-strategy-closedtrades': {
        bug: 'new',
        code: S(`f = ta.sma(close, 5)\ns = ta.sma(close, 20)\nif ta.crossover(f, s)\n    strategy.entry("L", strategy.long)\nif ta.crossunder(f, s)\n    strategy.close("L")\nplot(strategy.closedtrades)`),
        check: (vals) => (vals.some((v) => typeof v === 'number' && v > 0) ? null : `closedtrades never > 0 (last=${vals.at(-1)})`),
    },
    'version-7-accepted': { bug: 'new', code: `//@version=7\nindicator("repro")\nplot(close)\n` },
    'feat-2026-08-once': { feature: 'Aug 2026', code: I(`var int n = 0\nonce close > open\n    n += 1\nplot(n)`) },
    'feat-2026-08-binary-search-sort-field': {
        feature: 'Aug 2026',
        code: I(`type P\n    float price\n    int t\narr = array.from(P.new(1.0, 1), P.new(2.0, 2))\nplot(arr.binary_search(2.0, sort_field = "price"))`),
        check: expectLast(1),
    },
    'feat-2026-04-multiline-string': { feature: 'Apr 2026', code: I(`string s = """line one\nline two"""\nplot(str.length(s))`), check: expectLast(17) },
    'feat-2026-04-array-sort-sort-field': {
        feature: 'Apr 2026',
        code: I(`type P\n    float price\n    int t\narr = array.from(P.new(2.0, 1), P.new(1.0, 2))\narr.sort(sort_field = "price")\nplot(arr.get(0).price)`),
        check: expectLast(1),
    },
    'feat-2026-01-request-footprint': { feature: 'Jan 2026', code: I(`footprint fp = request.footprint(1, 70)\nplot(fp.buy_volume())`) },
    'feat-2025-bid-ask': { feature: 'Feb 2025', code: I(`plot(bid)\nplot(ask)`) },
    'feat-2025-syminfo-isin': { feature: 'Nov 2025', code: I(`plot(str.length(syminfo.isin))`) },
    'feat-2025-time-timeframe-bars-back': { feature: 'Oct 2025', code: I(`plot(time("1D", bars_back = 1, timeframe_bars_back = 1))`) },
    'feat-2025-plot-linestyle': { feature: 'Sep 2025', code: I(`plot(close, "c", color.red, 2, linestyle = plot.linestyle_dotted)`) },
    'feat-2025-calc-on-every-history-tick': { feature: 'Jul 2025', code: `//@version=6\nstrategy("repro", calc_on_every_history_tick = true)\nplot(close)\n` },
};

async function runPineTS(code, check) {
    try {
        const ctx = await new PineTS(Provider.Binance, 'BTCUSDT', '60', 300).run(code);
        const first = Object.entries(ctx.plots || {}).find(([k]) => !k.startsWith('__'));
        const vals = first?.[1]?.data?.map((d) => d.value) ?? [];
        const wrong = check?.(vals);
        return wrong ? { status: 'WRONG', detail: wrong } : { status: 'OK', detail: `last=${JSON.stringify(vals.at(-1))}` };
    } catch (e) {
        return { status: 'ERR', detail: String(e?.message ?? e).split('\n')[0].slice(0, 160) };
    }
}

function verdict(c, tv, pt) {
    if (c.bug === undefined && c.feature === undefined) return '?';
    if (c.name === 'version-7-accepted') return !tv.compiles && pt.status === 'OK' ? 'PINETS BUG (accepts invalid version)' : 'no issue';
    if (!tv.compiles) return 'REPRO INVALID ON TV (fix repro)';
    if (pt.status === 'OK') return c.feature ? 'supported' : 'NOT REPRODUCED (fixed?)';
    if (pt.status === 'WRONG') return c.feature ? 'WRONG RESULT IN PINETS' : 'PINETS BUG (valid on TV)';
    return c.feature ? 'MISSING IN PINETS' : 'PINETS BUG (valid on TV)';
}

mkdirSync(OUT, { recursive: true });
const filter = process.argv[2];
const results = [];
for (const [name, c] of Object.entries(CASES).filter(([n]) => !filter || n.includes(filter))) {
    writeFileSync(join(OUT, `${name}.pine`), c.code);
    let tv;
    try {
        tv = await tvCompile(c.code);
    } catch (e) {
        tv = { compiles: false, errors: [`request failed: ${e.message}`] };
    }
    const pt = await runPineTS(c.code, c.check);
    const v = verdict({ ...c, name }, tv, pt);
    results.push({ name, ...(c.bug ? { issue: c.bug } : { feature: c.feature }), tvCompiles: tv.compiles, tvErrors: tv.errors, pinets: pt, verdict: v });
    console.log(`${v.padEnd(34)} ${name}\n     TV: ${tv.compiles ? 'compiles' : tv.errors.join(' | ').slice(0, 160)}\n     PineTS: ${pt.status} ${pt.detail}`);
    await sleep(700);
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
