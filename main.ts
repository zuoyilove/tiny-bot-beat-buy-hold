// Tiny two-leg bot: beat buy-and-hold on Solana hourly bars.
//
// Strategy (one paragraph): two independent legs share one account, one
// position slot each per symbol. (1) Trend leg: buy when a symbol's fast EMA
// (8 hourly closes) rises 0.2% above its slow EMA (30 closes), sell when the
// fast EMA falls back below the slow EMA, 5% of equity per position, 8%
// stop-loss. (2) Mean-reversion leg: buy when a symbol's close falls 3.5%
// below its slow EMA (an oversold dip in an otherwise range-bound market),
// sell when the close recovers to the slow EMA, 15% of equity per position,
// 5% stop-loss. The trend leg keeps the bot in rallies, the dip leg harvests
// the bounces a falling market keeps offering; in a broad decline both legs
// sit mostly in cash and the bot loses little more than fees. Nothing is
// curve-fitted to the dev window: all parameters are plain round numbers,
// the rule is identical for every symbol, and no symbol, price level or date
// is hard-coded.
//
// Bookkeeping: fills are the source of truth. Each order carries a
// client_id naming its leg (t = trend, m = dip, x = exit); every batch
// first folds its fills into the legs' quantities and entry costs, so the
// quantities sold are always the quantities actually held. A sell that the
// market rejects leaves the leg held and the exit is simply retried.
//
// Wire protocol: agent-fun/bars-replay/v1, spoken by the vendored shim
// (vendor/makefun-bars.ts, a byte-identical copy of the kit's sdk). The bot
// is deterministic: no clock, no environment, no randomness.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// --- strategy parameters (round numbers, same for every symbol) ---
const FAST_LEN = 8; // fast EMA length in hourly bars
const SLOW_LEN = 30; // slow EMA length in hourly bars
const TREND_ENTRY_BAND = 0.002; // fast must clear slow by 0.2% to enter
const TREND_WEIGHT_BPS = 500; // 5% of equity per trend position
const TREND_STOP_LOSS = 0.08; // trend leg: sell 8% below entry cost
const DIP_BPS = 350; // mean-reversion leg: buy 3.5% below the slow EMA
const MR_WEIGHT_BPS = 1500; // 15% of equity per dip position
const MR_STOP_LOSS = 0.05; // dip leg: sell 5% below entry cost
const MIN_HISTORY_BARS = 12; // closes seen before a symbol may trade
const MAX_SLIPPAGE_BPS = 500; // 5%: wide enough for hourly gaps, still a guard

// Per-symbol trend state, kept across batches.
interface Leg {
  qty: bigint; // units actually held (from fills)
  cost: number; // USDC fill price of the open position (0 when flat)
}
interface Trend {
  fast: number; // fast EMA of the close, in USDC
  slow: number; // slow EMA of the close, in USDC
  seen: number; // closes folded in so far
  trend: Leg; // the trend leg's position
  dip: Leg; // the mean-reversion leg's position
}

const trends = new Map<string, Trend>();
// client_id -> which leg an order belongs to (t = trend buy, m = dip buy,
// x = exit sell, keyed by the leg it closes).
const pending = new Map<string, { symbol: string; leg: 'trend' | 'dip' }>();
let nextId = 1;

function ema(prev: number, price: number, len: number): number {
  const k = 2 / (len + 1);
  return price * k + prev * (1 - k);
}

function toPrice(raw: string, priceScale: number): number {
  return Number(BigInt(raw)) / 10 ** priceScale;
}

await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];

    // 1. Fold this batch's fills into the legs they belong to.
    for (const fill of batch.fills) {
      if (fill.status !== 'filled') continue;
      const t = trends.get(fill.symbol);
      if (t === undefined) continue;
      const leg = pending.get(fill.client_id)?.leg;
      const qty = BigInt(fill.qty);
      const price = toPrice(fill.price, state.symbols.get(fill.symbol)!.price_scale);
      if (fill.side === 'buy') {
        const l = leg === 'dip' ? t.dip : t.trend;
        // A buy fill adds to its leg; average the entry cost in.
        const prevValue = Number(l.qty) * l.cost;
        l.qty += qty;
        l.cost = l.qty > 0n ? (prevValue + Number(qty) * price) / Number(l.qty) : 0;
      } else {
        // A sell fill closes its own leg; a harness flatten (client_id
        // starting with _) closes whichever leg still holds units.
        const l = leg === 'dip' ? t.dip : leg === 'trend' ? t.trend : t.trend.qty > 0n ? t.trend : t.dip;
        l.qty = l.qty > qty ? l.qty - qty : 0n;
        if (l.qty === 0n) l.cost = 0;
      }
    }

    // 2. Fold this batch's closes into the EMAs.
    for (const { symbol } of state.hello.symbols) {
      const closeRaw = state.close(symbol);
      if (closeRaw === null) continue;
      const price = toPrice(closeRaw, state.symbols.get(symbol)!.price_scale);
      const t = trends.get(symbol);
      if (t === undefined) {
        trends.set(symbol, {
          fast: price, slow: price, seen: 1,
          trend: { qty: 0n, cost: 0 }, dip: { qty: 0n, cost: 0 },
        });
      } else {
        t.fast = ema(t.fast, price, FAST_LEN);
        t.slow = ema(t.slow, price, SLOW_LEN);
        t.seen += 1;
      }
    }

    const orders: Array<BuyInput | SellInput> = [];
    // Cash the reply has not already promised to earlier buys: sells in this
    // reply do not fund buys, and the account only updates next batch.
    let cashLeft = state.cash;
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);

    const sell = (symbol: string, leg: 'trend' | 'dip', qty: bigint): void => {
      const id = `x${nextId++}`;
      pending.set(id, { symbol, leg });
      orders.push({ side: 'sell', symbol, qty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: id });
    };
    const buy = (symbol: string, leg: 'trend' | 'dip', weightBps: number): void => {
      const target = (BigInt(weightBps) * state.equity) / 10000n;
      const room = state.weightRoom(symbol);
      let spend = target < room ? target : room;
      if (spend > cashLeft) spend = cashLeft;
      if (spend < minNotional) return;
      cashLeft -= spend;
      const id = `${leg === 'dip' ? 'm' : 't'}${nextId++}`;
      pending.set(id, { symbol, leg });
      orders.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: id });
    };

    // 3. Exits: trend leg on reversal or stop-loss, dip leg on recovery or stop-loss.
    for (const [symbol, t] of trends) {
      if (t.seen < MIN_HISTORY_BARS) continue;
      const closeRaw = state.close(symbol);
      if (closeRaw === null) continue;
      const price = toPrice(closeRaw, state.symbols.get(symbol)!.price_scale);
      if (t.trend.qty > 0n) {
        const reversed = t.fast < t.slow;
        const stopped = t.trend.cost > 0 && price < t.trend.cost * (1 - TREND_STOP_LOSS);
        if (reversed || stopped) sell(symbol, 'trend', t.trend.qty);
      }
      if (t.dip.qty > 0n) {
        const recovered = price >= t.slow;
        const stopped = t.dip.cost > 0 && price < t.dip.cost * (1 - MR_STOP_LOSS);
        if (recovered || stopped) sell(symbol, 'dip', t.dip.qty);
      }
    }

    // 4. Entries: trend signals first (the scarcer ones), then dips.
    for (const [symbol, t] of trends) {
      if (t.seen < MIN_HISTORY_BARS || t.trend.qty > 0n) continue;
      if (t.fast > t.slow * (1 + TREND_ENTRY_BAND)) buy(symbol, 'trend', TREND_WEIGHT_BPS);
    }
    for (const [symbol, t] of trends) {
      if (t.seen < MIN_HISTORY_BARS || t.dip.qty > 0n) continue;
      const closeRaw = state.close(symbol);
      if (closeRaw === null) continue;
      const price = toPrice(closeRaw, state.symbols.get(symbol)!.price_scale);
      if (price < t.slow * (1 - DIP_BPS / 10000)) buy(symbol, 'dip', MR_WEIGHT_BPS);
    }

    return orders;
  },
});
