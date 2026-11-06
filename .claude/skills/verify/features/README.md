# Rethread feature map

One file per user-facing feature. Each file says how a user reaches the feature, how to drive it with the wmux browser (see `../SKILL.md`), and what end state proves it works.

| Feature | File | Needs |
|---|---|---|
| Scan a care label | [scan.md](scan.md) | none (degraded); Google + Gemini keys for full analysis |
| Result page and outcome | [result-and-outcome.md](result-and-outcome.md) | a scan from the last 30 min; Firebase for credited outcomes |
| Account: login, closet, profile, leaderboard | [account.md](account.md) | Firebase client + admin vars and a Google account |
| Retailer marketplace and admin approval | [retailer.md](retailer.md) | Firebase and an approved retailer account |

Last proven live: 2026-11-06, `scan.md` in degraded mode, against `main` at `837411c`.
