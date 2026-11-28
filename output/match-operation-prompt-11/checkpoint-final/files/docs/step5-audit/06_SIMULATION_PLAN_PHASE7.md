# Stage 7 — Simulation plan lifecycle

## Implemented in this workspace

- Match Service persists automatic planner output in the isolated, versioned `match_schedule_test_snapshots` state. `autoPreview` is the simulation plan; `scheduleByFixture` remains the draft schedule; publication fields remain a separate official projection.
- Automatic planning uses the server snapshot revision and published Step 4 diagram version. The planner saves the plan before replying; the UI then projects the returned plan onto the existing fixture diagram, event calendar, and fixture list. There is no separate results page or “apply to draft” step.
- Replacing an existing plan requires a UI confirmation and an explicit API flag. A stale diagram, snapshot revision, or draft detected after computation is rejected.
- Customize, simulation deletion/cancellation, and locking use Match Service snapshot writes with optimistic revision control. Customized simulation entries remain in `autoPreview`; the lock transition moves only the selected entries into `scheduleByFixture` and removes them from the remaining plan in the same write. Validation has a Match Service endpoint that reads the stored plan/resources, persists its own result, and increments the snapshot revision; clients cannot write a fabricated validation result through the generic save route.
- Server-generated plans cannot be introduced through the generic snapshot save route. Customized plans must retain their source signature, can only remove or edit previously proposed fixtures, and are checked against the shared schedule validator. Schedule/resource changes invalidate saved simulation validation.
- Existing screens have proposal styling across the diagram, calendar, and list. Simulation status is explicitly labeled as unconfirmed; locked and official schedule styles are separate.
- No database migration was needed: the service-owned, versioned snapshot table was already present. No database, volume, teams, SMTP, or official schedule rows were reset by these changes.

## Verification and remaining acceptance work

- Web client and Match Service TypeScript typechecks pass.
- `scheduleTestSnapshot.integration.test.cjs` asserts that draft and simulation data remain separate in Backend storage and retains its compare-and-swap concurrency check. It was run against the existing Docker scheduling DB with one random UUID and passed; its row was deleted by the test.
- The full Match Service suite ran: 79 passed, 22 DB-dependent tests skipped, and 2 existing planner tests failed (`minute-precise scan must keep the only earliest valid kickoff` and `candidate-search cutoff is reported as inconclusive`). No shared scheduling algorithm source was changed in this stage. The failures still need investigation before claiming full acceptance.
- The scheduling engine remains the development/test workflow (`schedulingTestApiEnabled`) and its API is intentionally unavailable in production. The production `schedules` API still has its existing draft/publish lifecycle; this change does not wire simulation plans into that separate production workflow.
- Dependency/cluster impact analysis and atomic group handling for deleting or locking arbitrary dependent fixtures are not fully implemented. The existing validator rejects invalid schedules, but the required impact preview for these operations is still missing.
- Cross-tab writes are protected by server revisions; there is no push channel that refreshes a second already-open tab immediately. Reload/hydration reads the server snapshot.
- Docker `compose --profile apps up --build -d` completed and services reported healthy. The shared browser was logged out and public API calls returned 401 after reload, so no truthful before/after workflow screenshots or authenticated UI end-to-end runs were captured. Partial plans, repeated customize, delete/restore, validation, lock, stale versions, and all three tournament formats remain to be accepted before Prompt 8.

The exact original Prompt 1–6 texts/results are not versioned in this repository; this implementation was checked against the existing stage audit documents and current source.
