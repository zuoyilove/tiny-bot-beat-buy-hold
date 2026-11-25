# tiny-bot-beat-buy-hold

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/zuoyilove/tiny-bot-beat-buy-hold/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/zuoyilove/tiny-bot-beat-buy-hold/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny two-leg paper-trading bot for Solana hourly bars that beats buy-and-hold: a trend leg rides EMA crossovers (fast 8h over slow 30h, 5% of equity per position) and a mean-reversion leg buys oversold dips 3.5% below the slow EMA and sells on recovery to it (15% of equity per position). Both legs carry stop-losses, sizing is capped by the 25% per-symbol weight limit, and the bot is deterministic — no clock, no network, no randomness — speaking the agent-fun/bars-replay/v1 line protocol on stdin/stdout. On the kit's dev window it scores +205.13 USDC net PnL (38 trades, 7 symbols, max drawdown 3.4%) against buy-and-hold's −869.34 USDC and the best house baseline's −20.22 USDC.

## Run it

```sh
node main.ts
```

The bot reads the harness's `hello` / `batch` / `done` JSON lines on stdin and writes one `reply` per batch on stdout. `vendor/makefun-bars.ts` is the kit's protocol shim, vendored byte-identical. It needs Node 22 or later (TypeScript runs as-is); no dependencies to install and nothing to configure.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dcz81z7d&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
