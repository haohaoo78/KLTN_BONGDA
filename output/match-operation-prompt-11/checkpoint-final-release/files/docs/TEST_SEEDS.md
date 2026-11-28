# Isolated test seed datasets

These commands build a separate Compose project per seed (`sftms-test-seed-1` through `sftms-test-seed-4`) with its own PostgreSQL and Redis volumes. They do not use or delete the regular `student-football-league` volumes. The test-only Compose overlay binds the web app at `http://localhost:15173` and gateway at `http://localhost:18080`.

Run one seed from the repository root in PowerShell:

```powershell
pnpm run seed:test:round-robin-internal
pnpm run seed:test:knockout-internal
pnpm run seed:test:combined-inter-school
pnpm run seed:test:knockout-inter-school
```

The additive Seed 1 cross-tournament player invitation fixture for the currently running development stack is separate from those isolated resettable projects. Run `pnpm run seed:test:player-overlap` after the `apps` services are healthy. It only updates its stable Club 31 and two tournament invitation rows, creates no duplicates, and never resets or deletes a volume. Account emails and the manual test scenario are in [Demo Accounts and Testing Guide](./DEMO_ACCOUNTS_AND_TESTING.md#12-seed-1-overlapping-tournament-roster-fixture).

To add a separate stress-test tournament into an already running Seed 1 project without clearing any volumes or changing the original tournament, run `pnpm run seed:test:expand-1`. It creates 12 applications for an 8-team tournament (minimum 4), then verifies the DEV/TEST close/reopen controls and confirms the applications remain intact. The stress tournament uses a non-overlapping event date window so its shared demo clubs can be approved without violating the cross-tournament schedule conflict rule. The four primary seed tournaments remain 8, 8, 16, and 16 teams.

For a clean environment containing only the expanded fixture, run `powershell -NoProfile -File scripts/test-seeds/Run-TestSeed.ps1 -Seed 1 -Expanded1`. If the isolated `sftms-test-seed-1` project has volumes, the runner requires `RESET sftms-test-seed-1` and removes only those volumes. It then creates 12 demo teams and one round-robin tournament with 12 pending applications, maximum 8 and minimum 4; it does not also create the standard Seed 1 tournament or Seeds 2–4.

The runner verifies Compose configuration, starts only the isolated test project, waits for health, runs migrations through Compose dependencies, runs the seed stages, then checks login/session persistence for ADMIN, assigned and unassigned BTC, TEAM_CAPTAIN, PLAYER, REFEREE, and VIEWER. It checks that the assigned BTC sees the expected pending-registration count, that a different school's BTC is denied, and that the web app responds. The registration seed checks team, member, roster, invitation-response, and pending status counts from the organization database.

If the same test project already has volumes, the runner prints their names and requires the exact phrase `RESET sftms-test-seed-N` before it removes that project's volumes. The regular Compose project and all other projects remain out of scope. Use a different host port only by changing the isolated overlay and this guide together.

## Dataset contents

| Command | Format | Schools | Teams | Players | Captains | Roster submitted | Initial state |
|---|---|---:|---:|---:|---:|---:|---|
| `seed:test:round-robin-internal` | Round robin, one leg | 1 | 8 | 160 | 8 | 14 per team | 8 pending; minimum 4, capacity 8 |
| `seed:test:knockout-internal` | Knockout, 8-team capacity | 1 | 8 | 160 | 8 | 14 per team | 8 pending; minimum 4, capacity 8 |
| `seed:test:combined-inter-school` | Four groups of four, top two advance | 4 | 16 | 320 | 16 | 14 per team | 16 pending; minimum 8, capacity 16 |
| `seed:test:knockout-inter-school` | Knockout, 16-team capacity | 4 | 16 | 320 | 16 | 14 per team | 16 pending; minimum 8, capacity 16 |

Each club has exactly 20 active player accounts. Every submitted roster has valid linked players, accepted tournament invitations, and no pending invitations. Applications start pending so BTC can practice approval, rejection, supplement requests, and capacity overflow in the separate stress fixture. BTC must decide pending applications in ascending server-assigned submission sequence; the current queue head is marked in the review list, later actions are disabled in the UI, and the API rejects out-of-order decisions. Once the queue head receives a decision, the next pending application becomes actionable. Closing registration does not require a minimum number of approvals; the minimum is enforced when locking the final roster. Extra applications beyond capacity remain available to exercise reserve-queue behavior. Tournaments have no draw or match schedule at creation. A separate `dataset.btc02` account is assigned to another school for permission checks. The identity and account records are seeded in their owning services; the organization seed reconciles registration reservations through the tournament service's internal API.

## Demo login

Unless `SEED_TEST_PASSWORD` is set before running the command, every newly seeded account uses `SflTest@2026!`. The runner prints the value used. These credentials are restricted to isolated test datasets and must never be used in production.

| Role | Login |
|---|---|
| ADMIN | `dataset.admin01@football.local` |
| Tournament BTC | `dataset.btc01@football.local` |
| BTC at another school (scope check) | `dataset.btc02@football.local` |
| TEAM_CAPTAIN | `dataset.captain01@football.local` through `dataset.captain08@football.local` (or `16` for inter-school seeds) |
| PLAYER | `dataset.player0001@football.local` onward, 20 per team |
| REFEREE | `dataset.referee01@football.local` |
| VIEWER | `dataset.viewer01@football.local` |

The test overlay sets `NODE_ENV=test`, `ENABLE_MANUAL_REGISTRATION_CONTROL=true`, `EMAIL_VERIFICATION_REQUIRED=false`, and `MAIL_DELIVERY_MODE=disabled`. Manual close/reopen is enabled only when that flag is true in development/test; production always rejects the test API even if the flag is accidentally true. Manual controls are audited and preserve registration records. Automatic deadline closure runs inside tournament-service and reservation writes enforce the actual deadline. Email bypasses remain restricted to test; other attempted email deliveries fail clearly with `EMAIL_DELIVERY_DISABLED` and do not create pending delivery rows.

## Manual workflow

1. Open `http://localhost:15173` and sign in as `dataset.btc01@football.local`.
2. Open **Giải đấu do tôi tổ chức** (or **Giải đấu của tôi**), select the SFTMS Seed tournament, and open **Duyệt đội**.
3. Confirm all 8 or 16 applications are waiting, open an application and inspect the submitted roster and accepted invitation states.
4. Use `dataset.btc02@football.local` to verify the other BTC cannot read or decide applications in this tournament.
5. In the separate stress fixture, use **Đóng đăng ký (Test)** at any time. Verify new registrations are rejected while BTC can still decide the 12 existing applications. Use **Mở lại đăng ký (Test)** before the real deadline to confirm intake can resume. Resolve pending/supplement applications and withdrawal requests before locking fewer than eight approved teams. Production has no manual controls; its intake closes at the configured deadline.
6. To exercise draw, schedule, referee assignment, match results, and completion without consuming the initial fixture, use a second isolated copy. Re-running an existing project asks for its exact reset phrase.

The seed flow creates an ADMIN and BTC accounts for the catalog's draft schools, then activates only the schools required by that dataset through the normal ADMIN API (which enforces that each school has an assigned BTC and records audit history): one school for Seeds 1–2 and four for Seeds 3–4. The command performs automated smoke checks through login and the assigned BTC registration list; it does not claim the full season lifecycle has been executed automatically. Match operations and the remaining end-to-end browser workflow must be checked separately before considering those paths verified.
