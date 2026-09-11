// Wraps a live PineTS market-data provider and caches every response on disk, so runs against
// different PineTS builds see byte-identical bars (required for differential comparisons).
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

export class CachedProvider {
    constructor(inner, dir) {
        this.inner = inner;
        this.dir = dir;
        mkdirSync(dir, { recursive: true });
    }

    async cached(kind, args, fetch) {
        const key = createHash('sha1').update(JSON.stringify([kind, ...args])).digest('hex');
        const file = join(this.dir, `${kind}-${key}.json`);
        if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
        const value = await fetch();
        // Parallel runs may fetch the same key; write-then-rename keeps readers from seeing a partial file.
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(value));
        renameSync(tmp, file);
        return value;
    }

    getMarketData(tickerId, timeframe, limit, sDate, eDate) {
        return this.cached('klines', [tickerId, timeframe, limit ?? null, sDate ?? null, eDate ?? null], () =>
            this.inner.getMarketData(tickerId, timeframe, limit, sDate, eDate)
        );
    }

    getSymbolInfo(tickerId) {
        return this.cached('syminfo', [tickerId], () => this.inner.getSymbolInfo(tickerId));
    }

    configure(config) {
        this.inner.configure?.(config);
    }
}
