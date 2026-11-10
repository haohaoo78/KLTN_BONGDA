# Project audit and implementation status

## Executive summary

The repository is a pnpm TypeScript monorepo with a React web client, an Express API gateway, PostgreSQL databases per legacy service, Redis-backed sessions, and Docker Compose. The agreed target is five backend services. Compose runs five backend application runtimes (Auth, Organization, Tournament, Match and Notification), plus the Gateway, web client, PostgreSQL and Redis. Mailpit has been removed; account emails use configured SMTP in every environment. Auth includes the account modules formerly served by User; Match includes the modules formerly served by Scheduling and Discipline. Their original databases and migration source code remain preserved. Organization is still the old team implementation under a new Compose/Gateway service name and continues to own the unchanged `sfl_team` database. The health-only `media-service` scaffold has been removed because it is outside the five-service MVP and implements no use case; no existing database volume was dropped.

This is not yet a production-ready release. The previous status document overstates completion: service CRUD does not guarantee a secure, end-to-end business workflow, and the 84%/88% figures are not backed by a reproducible test suite.

## Implementation continuation — 07/11/2026

The first SRS-priority pass made these source changes:

- BTC's **Tất cả giải đấu** view queries every published lifecycle state, including completed and cancelled tournaments, with server pagination, search, scope, school, date and sorting filters. Drafts remain in **Giải đấu do tôi tổ chức**; the tournament API already limits draft visibility to the creator.
- ADMIN and BTC can use the read-only club directory. It now includes active and inactive clubs, with server-side school/name/status filters, pagination and name/recent sorting. Team management controls remain limited to the owning captain.
- Match event, match result and referee report submission routes now require `REFEREE`; existing match assignment checks still run in the service. BTC retains report review access.
- Fixed workspace TypeScript errors in form dirty-checking, current-user identity access, and the role-history row ID type.

Verification for this pass: `pnpm run typecheck` and `pnpm run build` passed; Docker images for Web, Organization, Tournament and Match built; Compose recreated those containers without deleting volumes; the Web returned HTTP 200, the public team endpoint returned 7 rows total, and the inactive-team filter returned 0 rows in the current dataset. All five backend health checks were healthy. This does not verify role access through an authenticated session or complete UI workflows.

Still outstanding from the attached SRS: persistent 8-step tournament workflow, roster locking/reopening with audit, complete referee operations dashboard, report revision/history and approval-gated official results, and role-by-role end-to-end acceptance checks. Do not treat this first pass as project completion.

## BTC tournament workflow implementation — 07/11/2026

The BTC tournament area now has three separate levels of navigation:

- **Tất cả giải đấu** is a read-only public catalogue. It has search, filters and tournament detail, but no create, management or workflow controls.
- **Giải đấu của tôi** lists only the tournaments assigned to the logged-in organiser. It provides the create action, search/filter controls, registration count, saved workflow position and a **Quản lý giải đấu** action for each row. Draft visibility remains restricted to its creator by the Tournament API.
- **Quản lý một giải đấu** loads one tournament and keeps an eight-step workflow in that screen only. Selecting a step renders only its own content: publication, registration review, roster lock, draw, scheduling/venue, referee assignment, match report review, or finalisation. The selected step and per-tournament workflow state are persisted through the Tournament API.

The Match API now keeps a referee-entered result and report non-public until BTC approves the report. Public tournament detail reads approved participants, approved results and official standings only. Referees use a separate operations panel for their assigned matches; BTC reviews their reports from step 7 of the selected tournament workflow. Public participant data is exposed through Tournament, which reads approved registrations through the trusted Organization internal route.

Verification for this implementation: workspace typecheck and production build passed; rebuilt Web, Organization, Tournament and Match images; Compose recreated the migration jobs and application containers without deleting volumes. All five backend services, API Gateway, PostgreSQL and Redis reported healthy. `http://localhost:5173/` and `GET /api/tournaments` each returned HTTP 200. Authenticated browser acceptance tests for every workflow branch remain required.

## Competition workflow hardening — 07/11/2026

Extended the tournament lifecycle beyond navigation so registrations and roster approval can drive real progression:

- Tournament status changes now follow an explicit server-side transition map. Locking rosters requires no pending team applications, the tournament minimum team count, approved active teams from the correct institution scope, and an adequate roster of BTC-verified players. Starting play requires every match to have a published schedule and assigned referee. Completing the tournament requires each match to be final with an approved report and result.
- Workflow-step writes are checked against persisted tournament status; opening a later step in the browser cannot bypass server-side readiness checks. Pause/cancellation transitions remain gated because the application does not yet collect their required reason/audit workflow.
- Added Organization migration 13 for per-player tournament roster review status, reviewer, time and note. Existing verified roster rows are backfilled as approved. The migration is additive and Compose applied it against the current preserved volume.
- Team captains can see past registrations for their own team and submit a tournament roster, update evidence, or remove players while roster registration is open. BTC assigned to the tournament can approve a player, request corrections or reject the player with a required note. The Organization service checks tournament ownership and editability on every mutation.
- Tournament preparation and start actions are available at the corresponding workflow steps; their API transition checks enforce draw publication and complete schedules/referee assignments.

Verification for this continuation: TypeScript checks passed for Web, Organization and Tournament. Docker built Web, Organization and Tournament; the Organization and Tournament migration jobs exited successfully; the web client, organization and tournament health checks returned HTTP 200, and Compose reported application/infrastructure services healthy. Authenticated end-to-end role workflows and actual match-report completion were not exercised in this pass.

## Runtime and integration verification

Verified locally after the latest service-boundary changes:

- Workspace TypeScript typecheck and production build pass.
- Docker images build and the development Compose stack starts; all application and infrastructure containers reported healthy.
- Registration through the Gateway sends a verification email to local Mailpit through Notification and does not return the verification token.
- An unverified account is rejected at login; verification activates the account; a verified account can log in and load its protected profile through the Gateway.
- Viewer access to the Admin user-list endpoint is denied; password reset sends a Mailpit email, rejects token replay, accepts the new password, and logout clears the test session.
- E2E-created user and Auth rows were removed after the checks. Mailpit is local-only; no external inbox was used.
- Match schedule/venue/discipline route smoke checks and five backend health checks passed after the Compose cutover.

These are historical local-mailbox tests, not evidence of delivery to an external inbox. The current local `.env` contains SMTP settings; credentials and their values are intentionally not included in this report. A recipient-specific external SMTP test is still required.

## Confirmed findings

| Priority | Finding | Evidence / impact |
|---|---|---|
| Addressed (High) | Notification list and per-ID operations now require a trusted gateway request and are scoped by the authenticated user. Sending is restricted to ADMIN/BTC. | `services/notification-service/src/routes/notificationRoutes.ts`, `controllers/notificationController.ts`, `repositories/notificationRepository.ts` |
| Partially addressed (High) | Core team/player changes, rosters, player requests, and registrations enforce captain ownership or staff role; captain reassignment is staff-only. Other organization and cross-service authorization still requires end-to-end review. | `services/organization-service/src/routes/teamRoutes.ts`, `controllers/teamController.ts`, `controllers/institutionController.ts` |
| Addressed (High) | Result writes and standings recomputation are transactional; edits replace the aggregate instead of double-counting, and canceling a completed match removes it from standings. | `services/match-service/src/services/matchService.ts`, `repositories/matchRepository.ts` |
| High | Important workflows are not fully connected: team registration does not check the tournament registration window; match card events do not call discipline; schedules do not validate match/tournament references against their owning services. | `services/organization-service/src/services/teamService.ts`, `services/match-service/src/services/lineupService.ts`, `services/match-service/src/scheduling/services/schedulingService.ts` |
| Medium | Schedule conflict checks are vulnerable to concurrent double-booking and do not account for venue-availability records. | `services/match-service/src/scheduling/services/schedulingService.ts`, `repositories/schedulingRepository.ts` |
| Partially addressed (Medium) | Each database now has a transactional version-1 baseline migration and a Compose one-shot migration job; application startup no longer performs DDL. Existing notification schema files still differ, and upgrading every legacy schema/data shape has not yet been verified. There are no down migrations; backup/restore is the rollback strategy. | Service `src/db/migrate.ts`, `docker-compose.yml`, notification `src/db/schema.ts` / `schema.sql` |
| Partially addressed (Medium) | Auth verification/reset emails now go through Notification SMTP and versioned delivery logs. Other business notifications remain in-app records; provider delivery outside Mailpit is not verified. | `services/notification-service/src/services/emailDeliveryService.ts`, `services/notification-service/src/db/migrate.ts` |
| Medium | Authentication currently uses Redis session cookies and opaque refresh tokens, not the requested JWT access-token architecture. The opaque refresh flow is now hashed at rest, HttpOnly-cookie based, rotated, and revocable, but it does not satisfy the JWT access-token requirement. | `services/auth-service/src/services/authService.ts`, API gateway session middleware |
| Medium | RabbitMQ and WebSocket infrastructure are not present. The current API Gateway is Express; Nginx serves the web-client container rather than acting as the API Gateway. | `docker-compose.yml`, `apps/api-gateway`, `apps/web-client/Dockerfile` |
| Medium | No generated or maintained OpenAPI specification is currently wired into the gateway or service routes. | `apps/api-gateway`, service route definitions |
| Medium | The frontend is a functional MVP dashboard but does not yet expose the full end-to-end administration workflow for institutions, player rosters, tournament registrations/approvals, scheduling, referees, match operations, discipline, and notifications. | `apps/web-client/src/App.tsx` and API clients |

## Work completed in this continuation

### Five-service refactor progress

- Added `PROJECT_OVERVIEW.md`, `docs/REFACTOR_8_TO_5.md`, and `docs/API_ROUTING.md` with source-service-to-target mapping, local table inventory, route ownership, logical relationships, event boundaries, and a non-destructive migration sequence.
- Updated the architecture and status documents to describe the five-service target and explicitly distinguish it from the current transition runtime.
- Renamed the Compose runtime key/image from `team-service` to `organization-service` while keeping the legacy source directory and `sfl_team` database unchanged. Updated Gateway route target, service health/log identity and migration job name.
- Corrected Gateway session gating for `GET /api/institutions`: the Organization router defines institution listing as public, so the Gateway now permits that read without a session. Institution creation remains role-protected by the service.
- Kept all legacy databases and their version metadata. No table-copy, table-drop or database-drop operation was performed.
- `pnpm run typecheck`, targeted Docker builds for Organization and Gateway, Compose validation, and Compose startup passed. Organization, Gateway and frontend health returned HTTP 200; `GET /api/institutions` returned HTTP 200 and protected `GET /api/teams` without a session returned HTTP 401. The eight source databases continue to report migration version 1. This only validates the renamed Organization runtime and route compatibility; the other four target boundaries and full SRS workflow remain pending.

1. Replaced the SMTP credential that had been present in the root environment example with empty development-safe placeholders. Configure a newly rotated provider credential only in an ignored local `.env` or deployment secret store.
2. The initial local development setup used Mailpit. It has now been removed at the user's request; Compose and Notification use the configured real SMTP provider in every environment.
3. Completed the email-verification integration: validate email input, create unverified accounts, send verification links, prevent unverified login, resend with a cooldown, and avoid returning raw verification tokens from public APIs.
4. Hash verification, password-reset, and refresh tokens in their databases. Password-reset consumption and password update occur in one transaction. Refresh uses an HttpOnly cookie, profile restoration, atomic rotation, replay rejection, and revocation on logout/reset. Auth delegates verification/reset email to Notification via a shared-key internal route; Notification records accepted/failed delivery status.
5. Added frontend forgot-password and reset-password flows. Bound the user-service controller methods that depend on `this`, including the existing change-password handler.
6. Added the `PLAYER` role while retaining `VIEWER` as the spectator role, and added a case-insensitive unique email index.
7. Updated the root README to require real SMTP configuration for every environment.
8. The root `.env` remains local and ignored by Git. It has configured SMTP credentials and a sender address; values are not copied into source or docs. `EMAIL_FROM` is supported for compatibility with the existing local configuration.
9. Notification now reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` (or legacy `EMAIL_FROM`) in every environment; Gmail requires an App Password. SMTP provider acceptance is required before account registration reports email success.
10. Expanded `.gitignore` to ignore `.env*` while explicitly allowing `.env.example`; `.dockerignore` already excludes runtime `.env` files.
11. Added shared-secret gateway-to-service header checks wherever services trust forwarded user headers. The gateway overwrites the internal-key header, so callers cannot supply their own user identity headers through the public gateway.
12. Scoped notification read/update/delete operations to the authenticated user and restricted notification creation to ADMIN/BTC.
13. Scoped team and player updates, deletes, roster access, player requests, and tournament registration to the owning captain or tournament staff. Team captain reassignment is limited to ADMIN/BTC; player request identities are taken from the authenticated session.
14. Replaced incremental standings updates with a transaction that stores/updates a match result and recomputes standings from all finished, verified, or locked match results. Match status changes recalculate standings in the same transaction; an advisory transaction lock serializes recalculation per tournament.
15. Rebuilt all Compose application images using the root `.env`; Compose validation passed and all application/infrastructure containers reported healthy.
16. Workspace `pnpm run typecheck` and `pnpm run build` passed after the changes. Direct unauthenticated requests to each user-context service returned HTTP 401; Gateway/Auth/Web health returned HTTP 200.
17. Docker integration checks passed: non-owner team update and captain reassignment returned HTTP 403; a team service request without the gateway key returned HTTP 401; notification owner read/delete worked while another user received HTTP 404; an edited match remained one played game with recalculated 1-point draws; canceling it removed standings rows. Temporary records were removed.
18. Auth registration/reset workflows were previously verified through Mailpit; that local mail transport has now been removed. This is not evidence of external SMTP delivery.
19. Added transactional, versioned baseline migrations for the original database schemas. Application entrypoints no longer create or alter schema. Each database uses a database advisory lock and records migration history in `sfl_schema_migrations`.
20. Notification has version 2 for account email delivery logs; Tournament has version 2 for tournament configuration. The existing database volumes and records remain preserved.
21. Removed the Mailpit Compose service, its development SMTP environment variables, and its profile from the local `.env`; notification email configuration now always uses the supplied real SMTP provider.

### Latest five-runtime consolidation

- Auth and User code were combined in `services/auth-service`; `/api/users/**` routes to Auth, and Auth reads/writes `sfl_user` through its account repository. The former User package and directory are removed.
- Scheduling and Discipline code were merged under `services/match-service`; their paths are routed through Match, and the former packages/directories are removed.
- The Organization implementation now lives under `services/organization-service`; the former Team path/package is removed.
- Auth account email templates and SMTP delivery moved to Notification. Notification has a protected internal email endpoint and an additive version-2 delivery-log migration.
- Compose keeps five backend runtimes and five target-owned one-shot migration jobs. Auth migration handles `sfl_auth` and `sfl_user`; Match migration handles `sfl_match`, `sfl_scheduling`, and `sfl_discipline`. All original databases are preserved; no cross-database table-copy has been performed.
- Tournament registration/roster ownership is still in Organization and is not yet a completed target boundary.

## Implementation plan and remaining release gates

1. **Security and authorization:** notification and core team/player ownership checks are implemented, but institution and tournament ownership, all service authorization paths, internal API exposure, sensitive endpoint rate limits, session/refresh lifecycle, CORS, and production secrets still need a full test review.
2. **Identity architecture:** decide and implement JWT access tokens with secure refresh-token rotation/revocation, or explicitly approve keeping session cookies. The current implementation does not meet the JWT requirement.
3. **Business consistency:** result edits and match-status changes now recalculate standings transactionally. Still validate registration periods and tournament eligibility, connect match cards to discipline, verify scheduling references, and test the 3/1/0 point rule against each tournament's regulations.
4. **Database operations:** baseline migrations and Compose migration jobs are implemented and have been run twice against the existing local volume. Still reconcile notification schemas, add versioned migrations for future changes, verify a clean-volume deployment and older production schema variants, and rehearse backup/restore. No destructive down migration is provided.
5. **Messaging/realtime/API contracts:** add RabbitMQ and WebSocket only where required by the approved MVP; publish OpenAPI documentation and define service-to-service contracts. These are currently absent.
6. **Frontend:** complete role-aware workflows and cover all implemented API states with loading, empty, success, and failure handling.
7. **Production Docker and end-to-end QA:** require strong secrets, secure cookies, a verified sender/domain and HTTPS `CLIENT_URL`; run tests against a clean database volume and a real SMTP provider; exercise all 15 requested workflows and negative cases.

Do not treat a phase as complete until its tests pass. Production delivery remains unverified until real SMTP credentials/provider configuration are supplied and the remaining high-priority workflow and authorization issues are fixed.
