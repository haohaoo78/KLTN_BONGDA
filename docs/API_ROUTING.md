# SFTMS HTTP API routing reference

## Referee portal — 26 November 2026

The official referee area uses six separate pages: `/referee`, `/referee/assignments`, `/referee/assignments/:matchId`, `/referee/matches/:matchId/operation`, `/referee/reports`, and `/referee/reports/:matchId`. Account and notifications retain the shared application pages. The old referee operation JSX has been removed from `MatchOperationsPanel`; its organizer review UI remains unchanged.

| Method | Path under `/api` | Access and data |
|---|---|---|
| GET | `/my/schedules/workspace` | REFEREE; only the authenticated user's current assignments on published schedules, enriched with real teams, tournament, venue, match/result/report and published position capabilities |
| GET | `/matches/:matchId/referee-context` | REFEREE and own active assignment; scoped match context, rules, named crew, lineups, events and server clock |

Both routes are handled by Match Service behind the existing Gateway prefixes. They use the owned Match/Scheduling repositories and existing Tournament/Organization APIs. No migration, test endpoint, new runtime service or browser storage is introduced. Crew names use the persisted publication notification payload; position labels and capabilities come from the published position snapshot, with the existing legacy configuration behavior. Replaced officials lose the detail access and list entry immediately after the committed assignment change.

Operation reuses the existing clock-actions (with expected version), referee-status, match-events, event-void, match-results, match-reports and correction-request APIs. Only the active pre-match/live/post-match stage is rendered. Event forms are modal; final result/report authority is derived from assigned capabilities and `isFinalAuthority`. Live-feed and notification invalidation reload data without silently replacing an open edit. Ordinary result confirmation, organizer exception review, standings and knockout propagation retain their existing backend behavior. A result draft saves scores/notes; additional report fields are saved on report submission, as in the existing contract.

Verification evidence is in `output/referee-portal-qa-20261126/`: live API access checks and actual scoped responses, backend suite log, browser captures. The assigned official test match is still scheduled for 18 December and has no lineups, so official-data kickoff/events/result submission have not been exercised by this UI change. The referee reference image was not present in the request; exact visual comparison remains pending.

### Changed files and page ownership

| File | Responsibility |
|---|---|
| `apps/web-client/src/App.tsx` | Official menu, referee paths, scoped multi-role/deep-link login |
| `apps/web-client/src/components/MatchOperationsPanel.tsx` | Remove old referee JSX; preserve organizer rendering |
| `apps/web-client/src/api/refereePortal.ts` | Typed real read APIs |
| `apps/web-client/src/components/referee/RefereePortal.tsx` | One routed page and real-data loading/error handling |
| `apps/web-client/src/components/referee/RefereeOverviewPage.tsx` | Overview only |
| `apps/web-client/src/components/referee/RefereeAssignmentsPage.tsx` | Assignment list and filters |
| `apps/web-client/src/components/referee/RefereeMatchDetailPage.tsx` | Match identity, rules, lineups and crew |
| `apps/web-client/src/components/referee/RefereeOperationPage.tsx` | Three-stage operations, event modal, result/report actions |
| `apps/web-client/src/components/referee/RefereeReportsPage.tsx` | Report list and read-only report detail |
| `apps/web-client/src/components/referee/RefereeShared.tsx` | Shared cards, badges, dates, links, logos/icons |
| `apps/web-client/src/components/referee/refereeRoutes.ts` | Six route mappings |
| `apps/web-client/src/components/referee/refereeOperation.ts` | Capability-driven actions, clock/event presentation, localized errors |
| `apps/web-client/src/components/referee/useRefereeContext.ts` | Scoped detail refresh without dropping current edits |
| `apps/web-client/src/components/referee/referee-portal.css` | Styles scoped to the referee screens |
| `apps/web-client/scripts/refereePortal.test.cjs` | 15 rendering/filter/route/capability tests; fixtures restricted to tests |
| `services/match-service/src/services/refereePortalService.ts` | Read projection using existing owned repositories and upstream APIs |
| `services/match-service/src/controllers/refereePortalController.ts` | Two authenticated read handlers |
| `services/match-service/src/routes/matchRoutes.ts` | Register the protected read routes |
| `docs/API_ROUTING.md`, `docs/PROJECT_STATUS_OVERVIEW.md` | Contracts, verification and limits |

## Step 6 — publish, replace and delivery tracking (Prompt 4, 26 November 2026)

The fourth tab reuses the same match list/calendar/diagram as manual assignment, in review mode. It provides stage/round/date/status filters, explicit valid-match selection and one primary **Công bố phân công** action. Selection outside the active filters is not published. Per-match menus contain history, replacement and delivery/resend tools.

| Method | Path under `/api/tournaments/:id/referee-team/assignments` | Operation |
|---|---|---|
| POST | `/publish` | Atomically publish the selected saved crews |
| POST | `/:matchId/replace` | Replace one official with an eligible person and a required reason |
| GET | `/:matchId/history` | Immutable crew versions, actor/time and any correction audit metadata |
| POST | `/:matchId/resend-email` | Explicit safe resend/reconciliation for the current version |

All routes require authenticated BTC access and service-side tournament ownership. Publication accepts `{ requestId, matches: [{ matchId, expectedRevision, configurationRevision, scheduleSignature }] }`. Each crew must be nonempty and fill all required positions with unique eligible people, exactly one configured final authority and no mandatory conflict. Empty crews are permitted only for drafts. A failed match rolls back the entire selected batch. Same-request replays return the existing result; a new request cannot republish an official crew.

Replacement accepts `{ requestId, expectedPublicationRevision, scheduleSignature, position, oldRefereeId, newRefereeId, reason }`. It rechecks the whole crew and occupied-time/rest/availability rules under sorted person locks, saves a new version, deactivates the old active crew, activates the new one and synchronizes the protected source draft in one transaction. Ordinary draft writes remain blocked for published crews. No schedule column, including `referee_id`, is changed. Step 7 authorization reads the active crew and its published position/capability snapshot; referee schedule/authorization queries accept only PUBLISHED schedules. Started matches and terminal tournaments reject changes.

Scheduling migrations **1012/1013** add publication versions, message outbox, email attempts and correction audit metadata. No applied migration was rewritten. Migration 1013 only adds metadata: it does not change any data by itself. During negative testing, a reused legacy validator incorrectly accepted one empty crew. The validator now explicitly rejects empty publication; the exact DEMO test record was voided with actor/time/reason after an additional backup, without deleting its history, touching the valid publication or changing the schedule. There is no general-purpose void UI or new workflow.

The existing Match process dispatches committed message outbox records with bounded concurrency. GET/reload never enqueues or sends email. Notification migration **8** adds an idempotent SMTP ledger. Internal `POST /internal/email/referee-assignment` requires the existing internal API key, validates content and reuses the real SMTP configuration. Email contains actual tournament/match/position/date/time/venue/location and website access guidance. Replacement notifies old and new referees. SMTP acceptance records SENT; definitive failure records FAILED; uncertain outcomes remain PENDING and reuse the same delivery key. Explicit retries after known failures create one new attempt; repeated request IDs or SENT events never send again. Failed email does not roll back official assignment. SMTP acceptance does not prove inbox delivery.

Runtime evidence: [Prompt 4 report](./step6-publication-qa-20261125/report.html). Official Docker/browser tests published one DEMO match, sent its email, replaced its referee, sent both replacement notices and verified old rights revoked/new rights active. The other 30 hybrid matches remain unpublished. No match was started and no Step 7 UI was built.

## Step 6 — manual referee drafts and suggestions (Prompt 3, 25 November 2026)

The **Phân công** tab reads only officially published schedules from Match Service. All four routes use the existing referee-team Gateway mapping, require authenticated BTC access, and recheck tournament ownership in Match Service:

| Method | Path under `/api` | Operation |
|---|---|---|
| GET | `/tournaments/:id/referee-team/assignments` | Published matches, effective positions, saved draft state and metrics |
| GET | `/tournaments/:id/referee-team/assignments/:matchId` | Match detail and ranked eligible/ineligible candidates; optional `search` |
| POST | `/tournaments/:id/referee-team/assignments/:matchId/suggestions` | Read-only preview for edited match positions; never assigns people |
| PUT | `/tournaments/:id/referee-team/assignments/:matchId` | Save the whole match draft and optional match configuration override atomically |

PUT accepts `{ slots: [{ position, refereeId }], expectedRevision, configurationRevision, scheduleSignature, matchPositions? }`. It rejects schedule fields, publication flags, duplicate people/positions, stale versions, changed schedule signatures, started matches and published/legacy active crews. Incomplete or empty drafts are allowed. Suggestions never preselect a person. The same backend eligibility checks run at save time against canonical Auth identities and the tournament referee team: active/verified REFEREE, format, professional position/capabilities, unavailability, occupied match time including setup/transition, global reservations, optional configured minimum rest and travel buffer. User locks serialize simultaneous assignment writes across tournaments.

Scheduling migration **1011** adds only `schedule_referee_drafts` and `schedule_referee_draft_slots` to `sfl_scheduling`. Drafts reserve referee time but do not create active crews, set `schedules.referee_id`, grant Step 7 rights, publish assignments or send email. Existing scheduling/crew writes check draft reservations. Configuration changes protect filled saved draft positions; an edited match override and its new slots are saved in one transaction. Optional `configuration.minimumRestMinutes` is preserved by the existing configuration API; absent means no separate referee rest requirement, not an invented default.

List/calendar/diagram read the same response and selected match. List groups reuse Step 5 presentation; diagram reuses Step 4 in read-only official mode, projected only from official draw/fixture APIs. No test storage is read or written. Tab 4 remains unimplemented. Evidence and limitations: [Prompt 3 report](./step6-assignment-qa-20261125/report.html).

## Step 6 — referee configuration (Prompt 2, 25 November 2026)

Tab **Cấu hình trọng tài** uses `GET` and `PUT /api/tournaments/:id/referee-team/configuration`, routed through the existing referee-team Gateway rule to Match Service. Both require an authenticated BTC and service-side tournament ownership. Writes additionally require complete published Step 5 schedules and a nonterminal tournament.

PUT accepts `{ expectedRevision, configuration: { defaultPositions, overrides } }`. Each position contains a stable `code`, editable `label`, `required` flag and explicit capabilities: `RECORD_EVENT`, `EDIT_EVENT`, `MANAGE_REPORT`, `FINALIZE`. Exactly one **required** position must have FINALIZE. Quick templates 1–4 are editable suggestions; custom positions are supported, with a payload resource limit of 64 positions rather than a four-person role limit. No configuration is automatically persisted on read.

Overrides replace the full position list in their scope: `STAGE` with `stage`, `ROUND` with `stage` and `roundNumber`, or `MATCH` with `matchId`. Precedence is match > round > stage > tournament; targets are validated against official published fixtures. When no configuration has been saved, existing crew authorization is preserved until BTC explicitly saves one.

Scheduling migration **1010** adds only `tournament_referee_configurations` in `sfl_scheduling`. Saves use optimistic revision checks and a tournament advisory transaction lock shared with crew writes. Existing assignments are never deleted by configuration changes. Changes which remove assigned positions, omit required positions, change the assigned final authority or alter an assigned official's capabilities return `409 REFEREE_CONFIG_ASSIGNMENTS_AFFECTED` with affected match IDs and reasons. BTC must review affected assignments before changing such configuration. Assignment writes recheck the effective configuration under the same lock.

Match service authorization reads the effective configuration for event entry/correction, report submission and final confirmation. A report-only official cannot automatically confirm a result: their submission is forced into pending review. Existing legacy crew behavior is retained where no configuration has been saved. This prepares backend capabilities; Prompt 2 does not implement assignment/publication tabs or the Step 7 interface.

Evidence, API tests and limitations: [Prompt 2 report](./step6-config-qa-20261125/report.html). Browser visual/reload testing remains **NOT TESTED** because browser host access failed and native Chrome access approval timed out. API reload and a fresh authenticated session were tested against Docker/PostgreSQL.

## Step 6 — referee team (Prompt 1, 25 November 2026)

Prompt 1 introduced the four-tab workspace and **Đội ngũ trọng tài** operations below. Prompt 2 adds configuration and Prompt 3 adds manual assignment drafts as documented above; the publication tab remains unimplemented. These Gateway paths route to Match Service, require an authenticated BTC, and recheck tournament ownership in the service:

| Method | Path under `/api` | Operation |
|---|---|---|
| GET | `/tournaments/:id/referee-team` | Canonical Auth identities, persisted tournament profiles and actual assignment counts |
| GET | `/tournaments/:id/referee-team/account-lookup?email=…` | Exact case-insensitive Auth account lookup and membership check |
| POST | `/tournaments/:id/referee-team` | Add an existing/new account with an explicit UUID `requestId`; persist membership before email |
| PATCH | `/tournaments/:id/referee-team/:memberId` | Update tournament-scoped `profile` only; never overwrite account identity |
| POST | `/tournaments/:id/referee-team/:memberId/resend-access` | Explicit new email attempt with UUID `requestId`; same request never resends |

Writes require the official Step 5 schedule to be published and reject completed/cancelled tournaments. Inactive, unverified accounts may join the team; locked/disabled accounts cannot be activated implicitly. New accounts have a random unusable password and a hashed, expiring, single-use setup link. Existing account passwords and other roles are preserved.

Match calls Auth's trusted internal referee-account lookup, resolve, ensure and access-email routes. Auth independently checks the actual actor's active/verified BTC account and Tournament manager-access. Auth sends tokens only to Notification's trusted `POST /internal/email/referee-team-access`; tokens are never returned to BTC. Notification also creates idempotent in-app SYSTEM notices through its existing internal API.

Email has durable PENDING/SENT/FAILED state in each owning service. SENT means SMTP accepted the recipient/message, not that Gmail inbox delivery was confirmed. Reads/reloads do not send messages. An unknown result remains PENDING and requires deliberate retry; use the latest setup link after a resend. Existing SMTP settings are retained, including display-name sender address parsing.

Additive migrations: Auth account v9, Match scheduling v1009, Notification v7. Evidence and current SMTP limitation: [Step 6 QA report](./step6-referee-team-qa-20261125/report.html).

## Gateway

- Local base URL: `http://localhost:8080`
- Health: `GET /health`
- All business API requests use `/api`.
- The React application calls the Gateway rather than individual backend ports.
- The Gateway validates the session for protected paths, then forwards the authenticated user context and its own internal shared-key header. Services must still enforce role and resource ownership.

## Route groups and ownership

| Public path | Runtime owner now | Route handlers |
|---|---|---|---|
| `/api/auth/**` | Auth | Register, login/logout, current session, verification/resend, verified email change, forgot/reset password, refresh and staff account activation |
| `/api/users/**` | Auth | Self profile, verified email-change request, password change, Admin user/staff account management, and role applications |
| `/api/public/teams`, `/api/public/teams/:id` | Organization | Public active-team directory and safe team/player detail DTOs; excludes account identifiers and private contact/evidence fields |
| `/api/tournaments/:id` | Tournament | Public tournament details, rules, dates, eligibility, and permitted institutions |
| `/api/tournaments/:id/regulations` | Tournament | Public regulation documents for a tournament |
| `/api/tournaments/:id/regulation-versions` | Tournament | Public regulation version history |
| `GET /api/institutions` | Organization | Public list of ACTIVE TP.HCM schools with at least one assigned BTC account |
| `POST /api/institutions`, `GET /api/institutions/manage`, `PATCH /api/institutions/:id`, `PATCH /api/institutions/:id/status`, `GET /api/institutions/:id/history` | Organization | ADMIN-only school catalog management, lifecycle changes, and change history |
| `/api/teams/**`, `/api/players/**`, `/api/player-requests/**`, `/api/player-leave-requests/**` | Organization | Team/profile and player operations, scoped team reads, join/leave requests, review decisions and membership history. An owning captain may link an unlinked team only to the verified school on their account through `POST /api/teams/:id/link-verified-school`. `GET /api/teams/my/registrations` returns tournament registrations only for teams the authenticated user captains or actively plays for. |
| `/api/club-requests/**` | Organization | Team Captain submits and tracks school-scoped club requests; BTC reviews requests for its assigned school |
| `/api/registrations/**`, `/api/rosters/**`, `/api/tournaments/{id}/registrations/**`, `/api/tournaments/{id}/rosters/**`, `/api/tournaments/{id}/withdrawal-requests`, `/api/withdrawal-requests/**` | Organization | Team Captain submits or withdraws registrations and cancels their pending withdrawal request; BTC reviews registrations and approved-team withdrawal requests only for assigned tournaments |
| `/api/tournaments/**` except the nested registrations/rosters paths above; `/api/seasons/**`, `/api/registration-periods/**`, `/api/regulation-versions/**`, `/api/regulations/**`, `/api/groups/**`, `/api/draws/**`, `/api/my/tournaments` | Tournament | Competition setup, rules, registration windows, groups/draws and assigned BTC tournament list |
| `/api/matches/**`, `/api/match-results/**`, `/api/lineups/**`, `/api/match-events/**`, `/api/match-reports/**`, `/api/pause-requests/**` | Match | Public match reads; BTC-scoped tournament operations; referee match assignment; ADMIN pause requests reviewed by the assigned BTC |
| `/api/tournaments/{id}/bracket`, `/api/tournaments/{id}/knockout-stage/**` | Match | Knockout bracket reads, playoff generation, and audited group tie-break draws |
| `/api/tournaments/{id}/fixtures/**` | Match | BTC-only fixture generation/read/publish. Generation uses the latest official Tournament draw and its pinned regulation snapshot; `POST /fixtures/publish` atomically validates and publishes every required stage for that draw version. The published fixtures are the stable match IDs consumed by later scheduling. |
| `/api/venues/**`, `/api/schedules/**`, `/api/venue-availability/**`, `/api/tournaments/{id}/schedules/**`, `/api/my/schedules` | Match | Venues, availability, schedules, conflict checks, referee assignments and own assigned schedules |
| `/api/cards/**`, `/api/suspensions/**`, `/api/complaints/**`, `/api/disciplinary-decisions/**`, `/api/players/{id}/tournaments/{id}/suspension` | Match | Cards, suspensions, complaints and decisions |
| `/api/notifications/**` | Notification | User-scoped inbox with search/read/date filters and pagination, unread count, read/delete and staff send |

Nested `/api/tournaments/{id}/...` routes are dispatched by resource: `matches`, `bracket`, `standings`, `schedules`, `cards`, `suspensions`, `complaints`, and `knockout-stage` go to Match; `registrations` and `rosters` go to Organization; other tournament resources go to Tournament.

The public tournament-detail view uses `GET /api/tournaments/{id}/draw-public` from Tournament for the single `PUBLISHED` draw version, `GET /api/tournaments/{id}/live-draw` plus `/live-draw/stream` for the public ceremony snapshot/events, and `GET /api/tournaments/{id}/fixtures/public` from Match for fixture stages published against that exact draw version. The Match endpoint returns no draft stages and no draft bracket slots; when no draw has been published it returns an empty bundle. Published match results are fetched through `GET /api/matches/{matchId}/result`, which redacts pending or rejected results. Viewer clients must show API errors separately from the valid empty/unpublished state.

## Authentication expectations

Auth routes are reachable without an existing session where necessary. Gateway-protected user, registration, team, match operations, schedule administration, disciplinary mutations and user notification routes require a valid session. Public reads such as institution listing, venues, schedules, tournament discipline lists, and disciplinary decisions remain public where defined by service routers. Role and ownership checks are implemented in backend services and must not be replaced by Gateway-only checks.

ADMIN can read competition, team, match, schedule and standings data, but cannot create or operate tournaments, approve team registrations, edit club/member data, schedule matches, assign referees, or record results. `POST /api/matches/:matchId/pause-requests` is ADMIN-only and requires a reason. `GET /api/matches/:matchId/pause-requests` is available to ADMIN and the BTC assigned to that match's tournament. `PUT /api/pause-requests/:id/review` is BTC-only and assignment-scoped; approval marks the match `POSTPONED`, while rejection requires a reason. A pending request does not stop or change a match.

Tournament mutations tied to a tournament are BTC-only and require an organizer assignment for that tournament. Global season creation/activation is BTC-only and does not require a tournament assignment because seasons are not linked to an individual tournament. Organization team mutations and per-tournament roster submission are TEAM_CAPTAIN-only and additionally verify `captain_id`; registration approval and tournament roster reads are BTC-only and assignment-scoped. Match/scheduling mutations are BTC-only and assigned-tournament-scoped, except referee actions, which require that referee to be assigned to the specific match.

Tournament creation records both the authenticated BTC user (`created_by`) and the BTC's verified school (`organizing_institution_id`). Legacy tournaments created by the signed-in BTC that predate school attribution are backfilled on that BTC's own tournament-list request, using the current trusted school assignment and never changing another creator's records. `SINGLE_INSTITUTION` registration accepts clubs only from the configured organizing school; `INTER_SCHOOL` registration applies the configured allowed schools/education levels and per-school override or default team limit, alongside the tournament-wide cap.

Match dispatches scheduling and discipline requests only to their matching route groups. This prevents either legacy router's router-wide authentication middleware from intercepting public routes owned by the other group.

Admin staff provisioning is limited to BTC and REFEREE. Auth sends the recipient a role-specific activation message through Notification's internal `POST /internal/email/send` endpoint; the recipient sets their own password through `POST /api/auth/activate-account`. Activation tokens are single-use, time-limited, and stored as hashes. These activation paths retain the configured SMTP provider; they are not exposed as direct Notification routes through the API Gateway.

Public `POST /api/auth/register` creates a VIEWER account only. After email verification, a user can submit `POST /api/users/me/role-applications` for PLAYER or TEAM_CAPTAIN and read their own applications at `GET /api/users/me/role-applications`. The owner can edit a PENDING application with `PATCH /api/users/me/role-applications/:id` or cancel it with `POST /api/users/me/role-applications/:id/withdraw`; ownership and PENDING status are checked transactionally, and canceled applications are retained as WITHDRAWN history. Edits keep the requested role fixed and revalidate the complete profile and ACTIVE school. TEAM_CAPTAIN applications collect representative type, faculty/department, team position, and proof/commitment; a representative student ID is optional, while PLAYER applications require student ID and student eligibility data. ADMIN/BTC may list applications with `GET /api/users/role-applications` and decide them with `PATCH /api/users/role-applications/:id`; approval adds the requested role in the same Auth database transaction as recording the decision. A new login is needed for the updated role set to be reflected in the current session.

Account self-service is available at `GET/PATCH /api/users/me`, `GET /api/users/me/profile-history`, `PATCH /api/users/me/change-password`, and `POST /api/users/me/email-change`. Self-service profile updates allow name, phone, and contact address only; verified student identity, school, roles and permissions cannot be changed through this endpoint. Email change requires the current password and remains unchanged until the user confirms the expiring link sent to the new address through `POST /api/auth/confirm-email-change/:token`; the token is stored hashed, single-use, and confirmation revokes existing sessions. Both initiation and delivery use the configured Notification SMTP integration.

Notification inbox `GET /api/notifications` supports `limit`, `offset`, `search`, `read=true|false`, `from=YYYY-MM-DD`, and `to=YYYY-MM-DD`; results are always scoped to the authenticated recipient. `GET /api/notifications/unread-count`, `GET /api/notifications/:id`, `POST /api/notifications/:id/read`, and `POST /api/notifications/mark-all-read` are also recipient-scoped. The web client shows the latest ten in the authenticated bell and provides a paginated, searchable inbox; anonymous sessions do not request personal notifications.

The public Organization directory accepts `limit`, `offset`, `institutionId`, and `search`. `GET /api/public/teams/:id` returns only active team display details, the institution name, approved tournament IDs, public representative name, and active roster display data (name, jersey number, position, team role). It does not expose player email, phone, date of birth, student ID, evidence, address, account IDs, or credentials. Public roster photos and match statistics are not currently stored by Organization and are therefore not returned.

PLAYER team-join flows use Organization: `POST /api/player-requests`, `GET /api/player-requests/my`, `POST /api/player-requests/:id/withdraw`, `GET /api/teams/:teamId/player-requests` and `PUT /api/player-requests/:id`. Rejection requires a reason; the request records reviewer and decision reason. Captain approval creates membership transactionally, enforces one active team per account and checks team capacity. Captain-owned team scope is checked by Organization.

PLAYER leave requests use `POST /api/player-leave-requests`, `GET /api/player-leave-requests/my`, and `POST /api/player-leave-requests/:id/withdraw`. Team representatives review through `GET /api/teams/:teamId/player-leave-requests` and `PATCH /api/player-leave-requests/:id`; rejection requires a reason, reviewer/time/reason are stored, and membership remains active until approval. Approval is blocked while the player is on a roster for a tournament not marked COMPLETED/CANCELLED. BTC can list and intervene only on requests pending at least 3 days, in a team/school they can manage and a tournament assigned to them. Organization periodically reminds the representative after 3 days; no automatic removal is performed.

Active account-linked membership cannot be ended through direct `PUT /api/players/:id` (`leftAt`) or `DELETE /api/players/:id`; both are rejected with `409 LEAVE_REQUEST_REQUIRED`. This prevents bypassing the leave-request approval/audit flow.

Organization sends membership notifications to Notification's internal `POST /internal/notifications` endpoint using the shared internal API key. Notification stores these in the recipient's in-app inbox at `/api/notifications`; users can read and mark their own notifications only.

Club creation is a separate approval flow. A verified TEAM_CAPTAIN submits `POST /api/club-requests`; the school ID and applicant identity come from the Gateway-validated Auth session, not the request body. `GET /api/club-requests/my` returns only that applicant's requests. ADMIN can list/review requests across schools; BTC can list/review only requests matching the school assignment in its Auth profile. `PATCH /api/club-requests/:id` atomically records the decision and, on approval, creates the team. Direct `POST /api/teams` is ADMIN-only. Legacy demo BTC/captain accounts may not have a school assignment; the HCMC demo BTC accounts are school-assigned and their cross-school review attempts return 403.

Existing API response structures and URL paths should remain stable through the consolidation. User, schedule, venue, and discipline endpoints now route to the consolidated runtimes without path changes. Registration/roster endpoints still route to Organization and have not yet moved to Tournament.

Organization and Match call Tournament's internal `GET /internal/tournaments/:tournamentId/manager-access` to verify BTC assignment. Team Captains query `GET /api/tournaments/registration-options?institutionId=...`; Tournament combines each tournament's education-level/allowlist/limit policy with Organization registration counts to show eligible choices and disqualification reasons. `POST /api/registrations` derives the school from the owned team, obtains an atomic reservation from Tournament, then stores the registration in Organization. Reservations are serialized per tournament and account for pending/approved registrations, including requests not yet persisted in Organization, so concurrent submissions cannot exceed global or per-school capacity. Organization synchronizes reservation states after persistence, approval, rejection or removal. `GET /api/tournaments/{id}/registrations` accepts `status`, `institutionId` and `search` filters and returns per-school pending/approved totals. Applications are attached to their tournament and are never routed to the school's BTC. Match calls Organization's internal `GET /internal/teams/:teamId/captain-access` before accepting a captain's complaint. These calls use the shared internal key and are not exposed as frontend Gateway paths.

Organization team detail/player-list reads are available to the owning captain, an active player linked to that team, Admin, or BTC assigned to a tournament with that team's registration. Team-wide profile/player membership changes are restricted to Admin or the owning captain; BTC works with tournament-scoped registrations and rosters instead. The frontend BTC team list is built from assigned tournaments rather than the public all-team listing.

Match resolves the parent match before authorizing cards and validates that the supplied tournament matches the match record. BTC suspension creation/lifting, complaint review and disciplinary decisions are scoped to assigned tournaments. Referee card creation requires an assigned match. A BTC decision must reference a complaint so its tournament scope can be resolved. Captain complaint submission is limited to the captain's team and a team that participated in the selected match. These checks complement the role middleware; they do not replace it.

The web-client registration, role-application, player-join, tournament-registration, and BTC registration-review panels call these APIs. Their presence does not indicate that unimplemented tournament gates (for example final roster locking or verified result publication) are complete.

The Gateway sends its internal key as a fixed proxy header and attaches session-validated user ID, email, roles, and school assignment separately. The UTF-8 full name is base64url-encoded in `x-user-name` to keep non-ASCII names safe in HTTP headers; Organization decodes it after validating the Gateway internal key. Services still verify the key and apply their own role and resource authorization.

The public `GET /api/institutions` directory is restricted to active institutions with `city = 'TP. Hồ Chí Minh'`. It returns source, website, institution type, address and data-collection metadata where available; the seeded catalog is a verified subset, not a claim of exhaustive city coverage.

School management is ADMIN-only. `GET /api/institutions/manage` supports search, institution type and `DRAFT`/`ACTIVE`/`SUSPENDED` filters. `POST /api/institutions` creates a `DRAFT` school; `PATCH /api/institutions/:id` edits its details; `PATCH /api/institutions/:id/status` changes lifecycle state; and `GET /api/institutions/:id/history` returns the audit log. Activation requires at least one BTC role assignment for that `institution_id`. Admin can provision a BTC account for a draft school through the existing `POST /api/users` staff flow, which sends the real activation email through the configured SMTP provider, or assign an existing BTC account using `PATCH /api/users/:id`. Moving/removing a school's last BTC assignment is rejected. School suspension retains existing school/team/account data; new registration and school selection are blocked.

Organization verifies the school state through Auth's internal `POST /internal/institutions/btc-assignments` lookup when determining whether a school has assigned BTC accounts. Auth validates role applications through Organization's internal school-verification endpoint. These service calls use the Gateway shared key and are not public Gateway routes. Role applications and club requests have separate review APIs and school scope: `GET/PATCH /api/users/role-applications` is owned by Auth, while `GET/PATCH /api/club-requests` is owned by Organization. Join/leave membership requests remain in Organization's team-membership routes and are decided by the team representative, with BTC intervention restricted to eligible overdue leave requests. The frontend separates these request types and applies search, status/date filters, pagination, details and decision history without changing ownership rules.

## Current documentation limit

### Official Step 4 fixture diagrams (24/11/2026)

The BTC fixture diagram now uses the restored Step 4 visual workspace for both drafts and published fixtures. Its official path does not call the test snapshot/configuration endpoints.

- `POST /api/tournaments/:tournamentId/fixtures/generate`: generate or reread a persisted draft from Tournament Service's published draw; retries preserve Match IDs. Allowed in `ROSTER_LOCKED` and `PREPARING`.
- `GET /api/tournaments/:tournamentId/fixtures/manage`: read draft/published stages and bracket relationships from Match Service.
- `POST /api/tournaments/:tournamentId/fixtures/validate`: run the publication guards without publishing. Checks official draw membership/positions, stage counts, duplicate group pairings/round appearances and knockout source links.
- `GET /api/tournaments/:tournamentId/fixtures/group-standings`: read standings calculated from approved, verified/locked results using the pinned regulation criteria. Unresolved ties remain unranked; this read does not qualify teams.
- `POST /api/tournaments/:tournamentId/fixtures/publish`: validate and publish the required stages transactionally. Retries retain the original publication timestamp and Match IDs.

All managed endpoints require BTC role and tournament management authorization in Match Service. Knockout positions come from the published draw and are not seeded again. Structural BYEs, including empty branches, do not produce playable matches. Hybrid sources retain their group/rank mapping until real results and the existing qualification API resolve them.

Verification and remaining limits: [Step 4 report](./step4-official-qa-20261124/README.md). Step 5 was not implemented as part of this change.

### Development scheduling engine (non-persistent)

Match Service exposes `POST /api/schedules/engine/test/validate`, `POST /api/schedules/engine/test/manual-candidates`, `POST /api/schedules/engine/test/automatic-preview`, and `POST /api/schedules/engine/test/referee-preview` only when `SCHEDULING_TEST_API_ENABLED=true` and `NODE_ENV` is not `production`. These routes require an authenticated BTC and verify tournament manager access through Tournament Service. They run the shared scheduling/referee engine against a bounded request snapshot and do not write to any database. The caller must retain test drafts locally. The request's `diagramVersion` is an isolation/freshness label in this stateless development API; it is not server-verified against an authoritative published draw. Never use these routes for official publication.

This is a route ownership/compatibility reference, not a complete OpenAPI contract. The repository does not yet maintain a generated OpenAPI specification with request/response schemas. The service route modules remain the executable source of truth; an OpenAPI document should be added with the relevant endpoint migration and validated against those handlers.

## Viewer, Team Captain and Player workspaces (27/11/2026)

The public competition views and the signed-in personal workspaces read the same published fixture and schedule records. A fixture is shown only when it belongs to a published fixture stage and has a `PUBLISHED` scheduling record. Public schedule projections omit referee/account assignment fields and include the venue name/location. Draft fixture stages, draft schedules and unpublished results are not a source for the public competition screens.

| Method | Path under `/api` | Owner and scope |
|---|---|---|
| GET | `/tournaments/:tournamentId/fixtures/public` | Match Service; published fixture stages and bracket only, public-tournament gated |
| GET | `/tournaments/:tournamentId/fixtures/group-standings/public` | Match Service; standings derived from published fixtures and approved results using the Step 4 ranking rules; returns zero-stat rows before completed results |
| GET | `/tournaments/:tournamentId/schedules` | Match Service; only PUBLISHED schedules for a non-DRAFT tournament, projected without private referee assignment fields and enriched with venue display data |
| GET | `/tournaments/:tournamentId/approved-teams` | Organization Service; approved participants and display identity for published tournament views |
| GET | `/matches/:matchId/live-state`, `/matches/live`, `/matches/live/stream`, `/matches/:matchId/stream` | Match Service; public live state/SSE for published fixtures; unapproved result records are redacted |
| GET | `/matches/:matchId/result` | Match Service; returns only an approved official result for a public fixture |
| GET | `/tournament-invitations/my` | Organization Service; invitations belonging to the authenticated player |
| GET | `/players/:playerId/tournaments/:tournamentId/suspension` | Match Service; PLAYER role only and verifies the player record maps to the authenticated account through Organization's trusted internal ownership lookup |
| GET/PUT | `/matches/:matchId/squads/:teamId` | Match Service; captain-owned team squad workspace and save; write authorization also verifies captain ownership and match/tournament eligibility |

The Viewer match list joins the Match fixture response to PUBLISHED Scheduling rows by stable `matchId`, then joins team IDs to the approved-participant display list. It does not synthesize labels from UUID prefixes or use a caller's private `my teams` list as the identity source. Team Captain navigation separates the public competition directory from `Giải đấu của đội tôi` and `Lịch của đội tôi`; the latter is filtered to teams for which the authenticated account is captain. Its match-squad action calls the existing Match squad API and does not grant roster/team-wide access by virtue of viewing a public match. Player participation is read-only and uses the player's accepted tournament invitations, approved team registration, published fixtures/schedules, public match state and the self-scoped suspension read.

Public tournament detail and standings views share the published draw/fixture identity. Round-robin and group-stage standings use Match Service's ranking calculation so zero-played teams still appear; knockout views retain unresolved source slots rather than assigning an invented winner. SSE invalidation uses the existing Match event stream and does not issue writes or email.

No migration, runtime service, fixture, schedule, roster or result data was created or rewritten for this portal integration. Route-level read projections were changed to enforce public publication boundaries; the lineup/suspension UI remains backed by the existing official Match/Organization APIs.

At the Gateway, only `GET /api/tournaments/:id/schedules` uses optional session middleware. Manager routes such as `/schedules/manage`, scheduling context, draft save, validation, publication, locks and referee operations continue through required session middleware and service-side BTC authorization.
