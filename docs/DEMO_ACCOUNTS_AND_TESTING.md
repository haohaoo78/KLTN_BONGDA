# Demo Accounts and Testing Guide

This document describes the development-only demo accounts and testing data seeded into the current Docker stack. It is intended for local validation and demonstration only; it never overwrites real users and it is guarded to run only in `NODE_ENV=development`.

**Current state:** section 11 documents the latest HCMC-specific account/catalog seed and supersedes the older sample-account counts in sections 2–10. Those sections describe the separate legacy general-purpose demo fixture, which remains in place and is not modified by the HCMC seed.

## 1. Roles included

- ADMIN
- BTC
- TEAM_CAPTAIN
- PLAYER
- REFEREE
- VIEWER

## 2. Demo accounts

All accounts below use the same password in development:

- Password: `Demo@123456`

| Role | Email | Status |
|---|---|---|
| ADMIN | admin.demo@football.local | active, verified |
| BTC | btc.demo@football.local | active, verified |
| TEAM_CAPTAIN | captain.demo@football.local | active, verified |
| PLAYER | player.demo@football.local | active, verified |
| REFEREE | referee.demo@football.local | active, verified |
| VIEWER | viewer.demo@football.local | active, verified |

There are also additional seeded demo players and a second captain used for fixture data:

- captain2.demo@football.local
- player2.demo@football.local to player14.demo@football.local

## 3. Safe bootstrap behavior

The demo seed is implemented as a development-only bootstrap script in `services/auth-service/src/db/seedDemo.ts`.

Rules:

- It refuses to run unless `NODE_ENV=development`.
- It refuses to run if `DEMO_ACCOUNT_PASSWORD` is missing or shorter than 8 characters.
- It creates only missing accounts; existing accounts are checked for active/verified state and the expected role, and are never modified.
- A conflicting or inactive existing demo address makes the seed stop rather than changing that account.
- It uses bcryptjs, as the Auth Service does, and stores no plaintext password.
- It is additive and idempotent for the account and fixture IDs.

## 4. Docker steps

From PowerShell:

```powershell
cd "T:\DO AN\BONG DA"

docker compose config --quiet
docker compose --profile apps up --build -d

docker compose ps
```

This starts PostgreSQL, Redis, the five backend services, the API gateway, and the web client.

## 5. Seed demo data

Run the seed script with the local demo password.

```powershell
cd "T:\DO AN\BONG DA"
$env:NODE_ENV = "development"
$env:DEMO_ACCOUNT_PASSWORD = "Demo@123456"
docker compose --profile apps --profile demo run --rm --no-deps demo-seed
Remove-Item Env:DEMO_ACCOUNT_PASSWORD
```

Notes:

- `demo-seed` is a local development-only bootstrap, not a production flow.
- The command assumes `docker compose --profile apps up --build -d` has already completed and the local migration jobs succeeded. `--no-deps` avoids re-running migration jobs during a seed-only run.
- It creates/validates demo users, two institutions, two teams with seven players each, an assigned BTC, an in-progress tournament, approved registrations/rosters, one completed result, standings, and two referee schedules.
- It leaves existing production or real data untouched. Do not copy the demo password into production configuration.

## 6. Login URLs

- Frontend: http://localhost:5173
- API Gateway: http://localhost:8080
- Auth login endpoint: http://localhost:8080/api/auth/login
- After login, the frontend routes users by role: ADMIN `/admin`, BTC `/btc`, TEAM_CAPTAIN `/team`, PLAYER `/player`, REFEREE `/referee`; VIEWER remains on the public competition pages.

## 7. Login test matrix

The following were validated against the live Docker stack:

| Email | Password | Expected result |
|---|---|---|
| admin.demo@football.local | Demo@123456 | success, ADMIN |
| btc.demo@football.local | Demo@123456 | success, BTC |
| captain.demo@football.local | Demo@123456 | success, TEAM_CAPTAIN |
| player.demo@football.local | Demo@123456 | success, PLAYER |
| referee.demo@football.local | Demo@123456 | success, REFEREE |
| viewer.demo@football.local | Demo@123456 | success, VIEWER |

## 8. Role dashboards and authorization checks

The frontend contains role-specific dashboard panels and role-filtered navigation. Earlier browser checks exercised all six role dashboard routes; this run rechecked login and the role-specific dashboard APIs for all six accounts.

Live checks against the current Docker stack:

| Actor and request | Result |
|---|---|
| All six roles log in and read their role-specific dashboard API (`/api/users`, `/api/my/tournaments`, `/api/teams/my`, `/api/my/schedules`, or public `/api/tournaments`) | `200` |
| VIEWER reads `/api/users` | `403` |
| BTC creates a suspension in its assigned tournament with invalid dates | `400` validation; BTC is authorized and no row is written |
| BTC creates a suspension in an unassigned tournament | `403` |
| TEAM_CAPTAIN submits a complaint for its own team with invalid description | `400` validation; ownership is accepted and no row is written |
| TEAM_CAPTAIN submits a complaint for the other team in the match | `403` |
| REFEREE issues an invalid card for an assigned match | `400` validation; assignment is accepted and no row is written |
| TEAM_CAPTAIN tries to register a team into the seeded `IN_PROGRESS` tournament | `409 REGISTRATION_CLOSED` |
| The demo seed is run against the current database | 20 accounts checked, 0 created; existing accounts were not modified |
| Seed integrity queries | 20 active/verified bcrypt accounts; two demo teams have 7 players each; two approved registrations, 14 verified roster entries, two schedules, one result and two standings |

The discipline probes deliberately use invalid input to exercise authorization without adding cards, suspensions, complaints or decisions. These checks are not a complete acceptance test of every business workflow or mutation endpoint.

Email and account flow checks:

- SMTP transport connectivity/authentication (`transport.verify`) succeeded.
- Public ADMIN self-registration and invalid verification/reset tokens were rejected.
- Forgot-password for an unknown email returned the generic success response.
- No verification/reset message was sent to an external mailbox during these checks; inbox delivery and provider acceptance for a real recipient remain unverified.

## 9. Example PowerShell login request

```powershell
$body = @{ email = 'admin.demo@football.local'; password = 'Demo@123456' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:8080/api/auth/login' -Method Post -ContentType 'application/json' -Body $body
```

## 10. Known limitations

- This is a development/demo environment only.
- Real email sending is configured through the service environment, not Mailpit.
- The seed script does not replace user data already present in the database.
- SMTP connectivity was checked, but successful delivery to an actual recipient mailbox was not tested.
- BTC tournament assignment checks cover the paths listed in the API routing reference; the successful tournament/registration lifecycle has not been run end-to-end.
- Referee assignment checks cover schedule reads and tested match mutations; complete update/delete acceptance remains outstanding.
- The live seed tournament is already `IN_PROGRESS`; a successful registration against an `OPEN_REGISTRATION` tournament was not attempted because the current database was not to be altered for a workflow test.
- Complete tournament lifecycle acceptance tests and browser checks for every role remain outstanding.

## 11. Verified TP.HCM school catalog and linked demo dataset

The current HCMC-specific seed is separate from the older general development fixtures:

- Seed source: `services/auth-service/src/db/seedHcmSchoolDemo.ts`
- School catalog: `services/organization-service/src/db/institution-catalog.json`
- Organization catalog migration: versions 7-8; Auth profile/registry migration: version 5
- Run profile: `hcm-demo` (requires the `apps` profile for migration jobs)
- The script aborts unless `NODE_ENV=development`; existing accounts, passwords, reviewed statuses, and existing records are not overwritten.
- New account hashes use the Auth Service's existing bcryptjs work factor. `viewer.pending@football.local` is deliberately unverified and login is rejected; SMTP behavior was not changed or bypassed.
- All evidence/avatar URLs are under the reserved `.invalid` domain and marked DEMO; no real student documents are used.

### School directory

There are **4 University** and **4 College** rows currently verified directly against official institution pages. This is a verified subset, **not an exhaustive list of every university and college in TP.HCM**; no complete authoritative master list was established during this task. No admission code was confirmed, so `admissionCode` is null. `SFL-HCM-*` values are internal database keys, not official school codes.

| Type | Institution | DB key | Address evidence | Official source |
|---|---|---|---|---|
| University | Đại học Công nghiệp Thành phố Hồ Chí Minh (IUH) | `SFL-HCM-IUH` | Two TP.HCM campuses listed; non-city campuses excluded | [Introduction](https://iuh.edu.vn/vi/ve-chung-toi.html) |
| University | Trường Đại học Công nghệ Thành phố Hồ Chí Minh (HUTECH) | `SFL-HCM-HUTECH` | Four TP.HCM locations from the official overview | [Overview](https://www.hutech.edu.vn/homepage/gioi-thieu/tong-quan) |
| University | Trường Đại học Kinh tế - Tài chính Thành phố Hồ Chí Minh (UEF) | `SFL-HCM-UEF` | Head office and campus in TP.HCM | [Contact](https://www.uef.edu.vn/gioi-thieu/lien-he) |
| University | Đại học Kinh tế Thành phố Hồ Chí Minh (UEH) | `SFL-HCM-UEH` | Address left null; source verifies the institution, not a current street address | [Introduction](https://ueh.edu.vn/gioi-thieu) |
| College | Trường Cao đẳng Kỹ thuật Cao Thắng | `SFL-HCM-CAOTHANG` | 65 Huỳnh Thúc Kháng, TP.HCM | [Introduction](https://caothang.edu.vn/Gioi-thieu-Truong-CDKT-Cao-Thang.html) |
| College | Trường Cao đẳng Công Thương Thành phố Hồ Chí Minh (HITU) | `SFL-HCM-HITU` | Address left null until an authoritative current address is verified | [Official website](https://hitu.edu.vn) |
| College | Trường Cao đẳng Công nghệ Thủ Đức (TDC) | `SFL-HCM-TDC` | 53 Võ Văn Ngân, TP.HCM | [Contact](https://tdc.edu.vn/lien-he.html) |
| College | Trường Cao đẳng Giao thông Vận tải | `SFL-HCM-HCMCT` | Three TP.HCM sites listed | [Official website/contact details](https://www.hcmct.edu.vn) |

`GET /api/institutions` now returns only active institutions whose city is TP.HCM, so the role-application forms share this catalog. Two older demo institutions remain untouched in the database but are not returned by the school-directory endpoint.

### Current HCMC seed accounts and status

Shared local development password for the accounts below: **`Demo@123456`**. Do not use it in production.

| Role / application | Email | School and linked data | Status |
|---|---|---|---|
| ADMIN | `admin.hcm.demo@football.local` | Global administration | New, active, verified |
| ADMIN (pre-existing) | `admin.demo@football.local` | Existing legacy account; not changed | Login tested; active |
| BTC | `btc.iuh@football.local` | IUH; sees IUH queue | New, active, verified |
| BTC | `btc.hutech@football.local` | HUTECH; sees HUTECH queue | New, active, verified |
| BTC | `btc.uef@football.local` | UEF; assigned to UEF | New, active, verified |
| BTC | `btc.ueh@football.local` | UEH; assigned to UEH | New, active, verified |
| TEAM_CAPTAIN | `captain.iuh@football.local` | IUH Eagles; manages own team | Approved |
| TEAM_CAPTAIN | `captain.hutech@football.local` | HUTECH Tigers; manages own team | Approved |
| TEAM_CAPTAIN | `captain.uef@football.local` | UEF United request | Role application and club request pending; Viewer access only |
| TEAM_CAPTAIN | `captain.ueh@football.local` | UEH FC request | Role application and club request pending; Viewer access only |
| TEAM_CAPTAIN | `captain.rejected@football.local` | IUH | Role application rejected; Viewer access only |
| PLAYER | `player.iuh@football.local` | IUH Eagles | Approved, team member |
| PLAYER | `player.iuh2@football.local` | IUH Eagles; approved same-team join history | Approved, team member |
| PLAYER | `player.iuh3@football.local` | IUH Eagles | Approved, team member |
| PLAYER | `player.hutech@football.local` | HUTECH Tigers | Approved, team member |
| PLAYER | `player.hutech2@football.local` | HUTECH Tigers | Approved, team member |
| PLAYER | `player.hutech3@football.local` | HUTECH Tigers; additional account to ensure 3 players beyond captain | Approved, team member |
| PLAYER | `player.uef@football.local` | UEF | Application pending; Viewer access only |
| PLAYER | `player.ueh@football.local` | UEH | Application pending; Viewer access only |
| PLAYER | `player.pending@football.local` | IUH | Application pending; Viewer access only |
| PLAYER | `player.new@football.local` | HUTECH | New application pending; Viewer access only |
| PLAYER | `player.join@football.local` | Requests IUH Eagles; not yet a member | Approved PLAYER; team request pending |
| PLAYER | `player.free@football.local` | No active team; request to HUTECH Tigers was rejected | Approved PLAYER, unassigned |
| PLAYER | `player.rejected@football.local` | IUH | Application rejected; Viewer access only |
| VIEWER | `viewer.demo2@football.local` | Public competitions and teams | New, active, verified |
| VIEWER | `viewer.demo3@football.local` | Public competitions and teams | New, active, verified |
| VIEWER | `viewer.pending@football.local` | Email-verification test account | New, intentionally unverified; login returns 403 |
| REFEREE (pre-existing) | `referee.demo@football.local` | Existing legacy match fixture; two assigned schedules | Not changed; login and schedules tested |
| VIEWER (pre-existing) | `viewer.demo@football.local` | Existing legacy account; not changed | Login tested; active |

The HCMC seed creates **26 accounts**: ADMIN 1, BTC 4, TEAM_CAPTAIN applications 5 (2 approved, 2 pending, 1 rejected), PLAYER applications 13 (8 approved, 4 pending, 1 rejected), plus 3 Viewer-only accounts (2 verified, 1 unverified). Approved captain/player accounts also retain their base VIEWER role. Pre-existing ADMIN, REFEREE, and VIEWER accounts are outside the 26 and were not altered.

The organization fixtures contain 8 unique catalog rows, 2 approved clubs and 4 pending club requests. Both approved teams have 3 approved PLAYER members plus a captain. There are PENDING, APPROVED, and REJECTED player-join records; `player.free` remains outside every active team. The one-active-team database index and API guard remain enabled.

### PowerShell seed instructions

Run from the project root after Docker is installed and the project is configured:

```powershell
docker compose --profile apps up --build -d
docker compose ps
docker compose --profile apps --profile hcm-demo config --quiet
docker compose --profile apps run --rm auth-migrate
docker compose --profile apps run --rm organization-migrate
docker compose --profile apps --profile hcm-demo run --rm -e DEMO_ACCOUNT_PASSWORD=Demo@123456 hcm-school-demo-seed
```

The migration jobs are additive; they do not reset a database or remove a volume. The seed command passes the password to the one-shot container and does not edit `.env`. Re-running it is safe: the verified rerun created zero additional accounts and preserved status/password values. `NODE_ENV` must be `development`; the seed exits before database writes otherwise.

### Current verification

| Check | Result |
|---|---|
| Full workspace TypeScript typecheck and build | Passed |
| Docker Compose configuration | Passed |
| Auth v5 and Organization v7-v8 migrations on current databases | Passed; no reset or volume deletion |
| HCMC seed first run / idempotent rerun | Passed; 26 curated accounts after the final addition / 0 new accounts on rerun |
| Account login | 26 new accounts tested: 25 verified accounts returned 200; intentionally unverified Viewer returned 403. Existing `admin.demo`, `viewer.demo`, and `referee.demo` logins also returned 200 |
| School directory API | 8 results; 4 universities, 4 colleges, 0 non-TP.HCM results |
| Admin user API | 200 |
| IUH/HUTECH BTC pending queues | Each returned only the one pending club request from its own school |
| IUH BTC attempting HUTECH request review | 403 |
| IUH captain viewing own club requests | 200; two own requests |
| IUH captain editing HUTECH team | 403 |
| Player viewing join requests | 200 |
| Existing member requesting a second team | 409 `PLAYER_ALREADY_IN_TEAM` |
| Viewer public team list / management API | Public list 200; management queue and Admin user API 403 |
| Existing referee assigned schedules | 200; two schedules |
| Frontend | `http://localhost:5173` returned 200; browser login displayed the matching ADMIN, BTC, TEAM_CAPTAIN, PLAYER, REFEREE, and VIEWER dashboards |

No email was sent by this seed. It marks ordinary demo accounts verified only in the seed data; SMTP registration, verification, and password-reset flows are unchanged. `.invalid` evidence links are placeholders, not deliverable documents. Catalog coverage is partial as stated above, and the newly seeded HCMC teams are not represented as a new tournament registration.
