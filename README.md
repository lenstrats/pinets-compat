# pinets-compat

Compatibility tests for [PineTS](https://github.com/LuxAlgo/PineTS), checked against TradingView's own Pine Script® compiler and real community indicators.

Every repro in `repros/` compiles without errors on TradingView, so a failure in PineTS is a PineTS bug and not invalid Pine. Run it again after a PineTS release to see what got fixed.

> Not affiliated with LuxAlgo or TradingView. Pine Script® and TradingView® are trademarks of TradingView, Inc.

## Quick start

Requires [Bun](https://bun.sh).

```sh
bun install
bun repro.mjs                  # bug + feature repros: TradingView compiler vs PineTS -> repros/results.json
bun scrape.mjs 1000            # popular open-source indicators + their source -> scripts/ (not committed)
bun run.mjs BTCUSDT 60 1000    # run them through PineTS (Binance data) -> report.md / report.json
bun tv-compile.mjs             # compile the scripts PineTS failed on with TradingView's compiler -> tv-compile.json
```

The PineTS version is pinned in `package.json`. To test another release or a local build, change that dependency (for example `"pinets": "file:../PineTS"`).

## Checking a PineTS change for regressions

This runs every scraped indicator against an unmodified PineTS build and against a patched one, then compares the output.

```sh
# Build each PineTS checkout (run inside the checkout)
FORMAT=es BUILD=dev npx rollup -c ./rollup.config.js

# Baseline: run the unmodified build twice. Scripts whose output differs between
# the two runs (timenow, math.random) are left out of the value comparison.
REPORT_NAME=runs/base-a PINETS_MODULE=../PineTS/dist/pinets.dev.es.js bun run.mjs
REPORT_NAME=runs/base-b PINETS_MODULE=../PineTS/dist/pinets.dev.es.js bun run.mjs

# Candidate: the patched build
REPORT_NAME=runs/candidate PINETS_MODULE=../PineTS-fix/dist/pinets.dev.es.js bun run.mjs

bun compare.mjs runs/base-a.json runs/candidate.json --flaky runs/base-b.json
```

The first run caches market data in `cache/`, so every later run uses identical bars. Each script's output is fingerprinted: every plot value and drawing object, at 10 significant digits. `compare.mjs` exits with code 1 if a script that ran before now fails, or if its output values changed.

Sometimes a change adds a new property to drawing objects, for example a new `text_formatting` field on labels. Every script that draws those objects then gets a different fingerprint. To check that nothing else changed, run the candidate with `FINGERPRINT_IGNORE_KEYS=text_formatting` (a comma-separated list), which leaves those keys out of the fingerprint. If you use this option, run the baseline with the same setting too, because some existing objects (boxes) already have that key.

**Run baseline and candidate close together in time.** Even on cached data, PineTS compares the last bar's close time with the system clock (`barstate.isconfirmed`, `barstate.isrealtime`, `request.security`). A run from before that bar closed and a run from after it can therefore give different output. With 1h data, run both within the same clock hour. Otherwise compare the suspicious scripts back-to-back.

## Contents

| Path | What it does |
|---|---|
| `repro.mjs` | Runs each file in `repros/` through TradingView's compiler and PineTS, and gives a verdict per repro |
| `repros/` | Minimal `.pine` repros for PineTS bugs (`bugNN-*`) and recent Pine v6 features (`feat-*`), plus the last `results.json` |
| `scrape.mjs` | Fetches TradingView's popular open-source indicator list (API caps at 1000) and each script's source |
| `run.mjs` | Runs every scraped script through PineTS in its own process (with timeout); groups errors by signature in `report.md` |
| `tv-compile.mjs` | Compiles scripts with TradingView's compiler to check whether an error also exists on TradingView |
| `compare.mjs` | Compares two `run.mjs` reports and lists regressions, changed output values, fixed scripts and changed errors |
| `cached-provider.mjs` | Caches Binance market data in `cache/`, so runs against different PineTS builds use identical bars |
| `reports/` | Archived runs: indicator names, URLs and results. No script source |

## Results: pinets 0.9.33, 2026-09-11

**Community indicators:** 729 popular open-source indicators, all Pine v6, run on Binance BTCUSDT 1h with 1000 bars.

| Result | Count |
|---|---|
| Ran without errors | 511 |
| Runtime error | 139 |
| Transpile error | 51 |
| No output | 24 |
| Timeout | 4 |

All 218 scripts that failed in PineTS compile without errors on TradingView (`reports/2026-09-11-popular729-tv-compile.json`). See `reports/2026-09-11-popular729.md` for errors grouped by signature, with the affected indicators.

**Repros:** each one below compiles on TradingView and fails or gives a wrong result in PineTS. The Issue column shows the matching GitHub issue as of 2026-09-11; "–" means none was found.

| Repro | PineTS result | Issue |
|---|---|---|
| `bug01-eager-ternary-array-get`, `bug01-eager-and-array-get` | Guarded `array.get` throws out of bounds | [#297](https://github.com/LuxAlgo/PineTS/issues/297) (PR #299) |
| `bug02-security-udf-second-call` | `Kt.params` TypeError | [#278](https://github.com/LuxAlgo/PineTS/issues/278) |
| `bug03-timeframe-480/1440/12M` | `Invalid timeframe` | [#279](https://github.com/LuxAlgo/PineTS/issues/279) |
| `bug04-continuation-starts-with-operator` | Transpile error | [#252](https://github.com/LuxAlgo/PineTS/issues/252) |
| `bug05-tuple-after-switch` | Transpile error | [#255](https://github.com/LuxAlgo/PineTS/issues/255) |
| `bug06-underscore-redeclared` | `Identifier '_' has already been declared` | [#250](https://github.com/LuxAlgo/PineTS/issues/250) (PR #302) |
| `bug07-named-args-nan` | Silently all NaN | [#267](https://github.com/LuxAlgo/PineTS/issues/267) |
| `bug08-method-on-float` | `close.dbl is not a function` | [#267](https://github.com/LuxAlgo/PineTS/issues/267) |
| `bug11-scale-namespace` | `scale is not defined` | – |
| `bug12-comment-indented-deeper` (+ `-udt-field`) | Transpile error (INDENT) | – (related: #253) |
| `bug13-import-library` | Transpile error on `import` | – |
| `bug14-method-as-variable-name` | Transpile error | – |
| `bug15-label-set-text-font-family` | Not a function | – |
| `bug16-udt-method-on-for-in-var` | `z.bump is not a function` | – |
| `bug17-const-inside-udf` | `MAXB is not defined` | – |
| `bug18-enum-as-param-type` | `Mode is not defined` | – |
| `bug19-comma-after-multiline-call` | Transpile error (COMMA) | – |
| `bug20-request-financial/earnings/dividends/currency-rate` | Not a function | – |
| `bug21-table-cell-set-text-formatting` | Not a function | – |
| `bug22-strategy-closedtrades` | `undefined` | – |
| `version-7-accepted` | TradingView rejects (CE10248); PineTS runs it | – |
| `feat-2026-08-once` | Missing (transpile error) | – |
| `feat-2026-08-binary-search-sort-field` | Wrong result, no error | – |
| `feat-2026-04-multiline-string` | Wrong result, no error (length 0) | – |
| `feat-2026-04-array-sort-sort-field` | Wrong result, no error | – |
| `feat-2026-01-request-footprint` | Missing | PR #303 |
| `feat-2025-bid-ask` | Missing | – |

## Caveats

- The TradingView check only compiles scripts. It cannot confirm runtime errors such as an array index out of bounds; those only show up when a script runs on a chart.
- "Ran without errors" does not mean the values match TradingView.
- This repo uses undocumented TradingView endpoints (`pine-facade`, `/api/v1/scripts`). They can change without notice, so keep request rates low.
- Market data comes live from Binance, and some indicators are built for other symbols or timeframes. A few failures are the script's own `runtime.error` guards.
- Scraped script source is not committed: it belongs to its authors under their own licenses.

## License

[MIT](LICENSE) for the tools and repros in this repo. PineTS itself is AGPL-3.0 / commercial by LuxAlgo.
