# Phoenixchan Bot

A Telegram bot for trading [Phoenix](https://phoenix.trade) perpetual futures
on Solana, with custodial embedded wallets, inline TP/SL, live fill alerts and
auto-detection of deposits.

**Try it:** [t.me/phoenixtradechanbot](https://t.me/phoenixtradechanbot)
*(Phoenix is in private beta — you need an access/invite/referral code to use it.)*

---

## Features

### Trading
- `/long /short [symbol] [usdc] [leverage]` — market orders
- `/limit [symbol] [side] [usdc] [price] [lev]` — limit orders
- Inline TP/SL on every order: `/long SOL 100 5 tp=160 sl=130`
- Standalone TP/SL on existing positions: `/tp /sl /tpsl`
- `/close [symbol] [pct]` — partial or full close
- `/cancel /cancelall` — single or bulk cancel
- Inline confirmation buttons before execution (toggleable)

### Account
- `/pos` with inline action buttons (close 25/50/100%, +TP, +SL, refresh)
- `/balance` — collateral + uPnL + equity
- `/orders` — open orders
- `/pnl [7d|30d]` — realized PnL window
- `/history [7d|30d]` — recent trades with realized PnL, fees, win rate
- `/funding` — current funding rates across all markets

### Wallet
- `/start` creates a per-user embedded Solana wallet (custodial)
- `/register [code]` activates the trader account on Phoenix
- `/deposit` shows address + instructions; `/deposit [amount]` credits USDC as Phoenix collateral
- `/withdraw [amount]` — pulls from Phoenix collateral and SPL-transfers to the user's personal pubkey
- `/setwithdraw [pubkey]` — sets the withdrawal destination
- `/exportkey` — escape hatch: returns the private key in 3 formats (Phantom-compatible base58, JSON byte array, 32-byte seed). Self-destructs after 90s.

### Alerts (live via Phoenix WebSocket)
- Fill notifications — pinged on every market/limit/TP/SL fill
- Liquidation alerts — special icon + tx link
- Sharp collateral drop warnings (>30%)
- Auto-detected deposits — bot tells you when new USDC lands and offers a one-tap credit button
- Custom price alerts: `/alert SOL > 150`

### Safety
- AES-GCM encryption at rest for embedded wallet keys (32-byte master key)
- Per-user rate limiting
- Per-user notional cap
- Optional whitelist mode
- Full audit log of every trade attempt

---

## Architecture

```
Telegram ──▶ grammY ──▶ commands ──▶ Phoenix Rise SDK ──▶ Phoenix API + WS
                            │                            │
                            ▼                            ▼
                       SQLite (WAL,                  Solana RPC (Triton)
                       AES-GCM secrets)              ──▶ Phoenix Eternal program
```

- **Bot framework:** [grammY](https://grammy.dev/)
- **Phoenix SDK:** [`@ellipsis-labs/rise`](https://www.npmjs.com/package/@ellipsis-labs/rise)
- **Solana:** [`@solana/kit`](https://www.npmjs.com/package/@solana/kit)
- **Storage:** [`better-sqlite3`](https://www.npmjs.com/package/better-sqlite3) with WAL
- **Hosting:** Docker + Fly.io (sample config included)

---

## Custody model

This bot is **custodial** over each user's embedded trading wallet:

1. The bot generates a Solana keypair per user on `/start`.
2. The private key is AES-GCM encrypted with a master key (env var, never logged) and stored in SQLite.
3. The user funds that wallet with USDC and SOL (for gas).
4. The bot signs orders/withdrawals on the user's behalf.
5. Users can withdraw funds back to a pre-set personal address via `/withdraw` at any time.
6. Users can export the private key via `/exportkey` and take full self-custody.

Phoenix recommends embedded wallets per integration; sharing the user's main
wallet would bleed positions across dapps.

---

## Self-hosting

```bash
git clone https://github.com/Sugusdaddy/phoenixchan-bot.git
cd phoenixchan-bot
cp .env.example .env
# Fill in:
#   TELEGRAM_BOT_TOKEN (from @BotFather)
#   PHOENIX_BUILDER_AUTHORITY + PHOENIX_BUILDER_PRIVATE_KEY (from flight.phoenix.trade)
#   MASTER_ENCRYPTION_KEY (random 32 bytes hex: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
#   SOLANA_RPC_URL (Helius / Triton / QuickNode — public RPC will not work)

npm install
npm run build
npm start
```

For 24/7 hosting on Fly.io:

```bash
flyctl launch --copy-config --no-deploy
flyctl volumes create phoenix_data --size 1 --region <yours>
flyctl secrets set TELEGRAM_BOT_TOKEN=... PHOENIX_BUILDER_AUTHORITY=... ...
flyctl deploy --remote-only
```

---

## Builder fees (Flight)

The bot is designed to route orders through Phoenix [Flight](https://docs.phoenix.trade/phoenix/flight) so the configured builder authority can collect builder fees on every fill. Set `PHOENIX_DISABLE_FLIGHT=false` once you register your builder at [flight.phoenix.trade](https://flight.phoenix.trade) and supply real `PHOENIX_BUILDER_AUTHORITY` + `PHOENIX_BUILDER_PRIVATE_KEY`.

If `PHOENIX_DISABLE_FLIGHT=true`, orders are placed natively without Flight wrapping (no builder fees but useful for testing).

---

## Status

Early beta. Functional end-to-end on Phoenix mainnet. Not audited.

Trade perpetual futures responsibly — liquidation can occur faster than you can react. Use at your own risk.

---

## License

MIT
