# Phoenix Trading Bot for Telegram

Multi-user Telegram bot for [Phoenix](https://phoenix.trade) perpetual futures
on Solana. Each user gets a custodial embedded trading wallet operated by the
bot; the bot is registered as a Flight builder with Phoenix and routes orders
through Flight on behalf of users.

## Architecture

- **Telegram layer**: [grammY](https://grammy.dev/) bot with commands, inline
  confirmations, rate limiting, audit log.
- **Phoenix layer**: [`@ellipsis-labs/rise`](https://www.npmjs.com/package/@ellipsis-labs/rise)
  SDK. HTTP for market data + trader state, WebSocket for fills, Flight for
  order routing.
- **Solana layer**: [`@solana/kit`](https://www.npmjs.com/package/@solana/kit)
  for tx assembly, signing, and confirmation.
- **Storage**: SQLite (`better-sqlite3`). Encrypted at-rest per-user wallet
  secrets via libsodium secretbox keyed by `MASTER_ENCRYPTION_KEY`.
- **Deployment**: Docker + Fly.io (sample config) with a persistent volume for
  the SQLite db.

## Custody model

This bot is **custodial** for each user's embedded trading wallet:

- The bot generates a fresh Solana keypair per user on `/start`
- The private key is encrypted with the master key and stored in SQLite
- The user funds that wallet with USDC and SOL (for gas)
- The bot signs all trades and withdrawals with that key
- Users withdraw funds back to a pre-set personal address (`/setwithdraw`)

Phoenix recommends embedded wallets per integration; sharing the user's main
wallet would bleed positions across dapps.

## Setup

```bash
cp .env.example .env
# Fill in TELEGRAM_BOT_TOKEN, PHOENIX_BUILDER_AUTHORITY, PHOENIX_BUILDER_PRIVATE_KEY,
# MASTER_ENCRYPTION_KEY (32 random bytes hex), SOLANA_RPC_URL, PHOENIX_API_KEY

# Generate master key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm install
npm run dev     # local
npm run build && npm start   # production
```

## Phoenix builder setup

Before users can trade, you need to register your bot's builder authority with
Phoenix and obtain an API key. See
[Phoenix docs — Flight routing](https://docs.phoenix.trade/) and the Rise SDK
README for builder registration.

Once registered, set:

```env
PHOENIX_BUILDER_AUTHORITY=<your builder pubkey>
PHOENIX_BUILDER_PRIVATE_KEY=<base58 secret>
PHOENIX_API_KEY=<your service api key>
```

## Deployment to Fly.io

```bash
fly launch --copy-config --no-deploy
fly volumes create phoenix_data --size 1
fly secrets set \
  TELEGRAM_BOT_TOKEN=... \
  PHOENIX_API_KEY=... \
  PHOENIX_BUILDER_AUTHORITY=... \
  PHOENIX_BUILDER_PRIVATE_KEY=... \
  MASTER_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  SOLANA_RPC_URL=...
fly deploy
```

For Railway/Hetzner just `docker build -f docker/Dockerfile -t phoenix-bot .`
and run with the env vars + a mounted `/app/data` volume.

## Commands

See `/help` in the bot. Categories:

- Wallet: `/start`, `/status`, `/balance`, `/setwithdraw`, `/withdraw`, `/tos`, `/unlink`
- Market: `/price`, `/markets`
- Account: `/pos`, `/orders`, `/pnl`, `/funding`
- Trade: `/long`, `/short`, `/limit`, `/close`, `/cancel`, `/cancelall`
- Alerts: `/alert`, `/alerts`, `/delalert`
- Settings: `/confirm`, `/maxnotional`

## Safety and limits

- `MAX_NOTIONAL_USDC` per-trade cap (env default, per-user override with `/maxnotional`)
- `RATE_LIMIT_TRADES_PER_MIN` per-user rate limit
- `WHITELIST_USER_IDS` to restrict access during private rollout
- Inline confirmation on every trade by default (toggle with `/confirm off`)
- Full audit log of every trade attempt in `audit_log` table

## Status

**Beta scaffold.** Phoenix is in private beta and the Rise SDK is at v0.4.x —
some method signatures (cancel-orders builders, PnL/funding history endpoints)
are wrapped defensively and may need adjustment once you point a real builder
key at the live API. The trade flow, key management, audit, and alert
machinery is complete and structured for live use.

## TODO

- Withdraw flow (`/withdraw <amount>`) — needs `buildWithdrawFlow` wiring
- TP/SL orders via `placeIsolatedConditionalOrder`
- Liquidation proximity alerts (margin ratio threshold via WS trader state)
- `/history` recent fills view
- Tests against a Phoenix devnet/sandbox

## License

MIT
