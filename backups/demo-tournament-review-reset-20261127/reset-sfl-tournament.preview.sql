BEGIN;

LOCK TABLE tournaments, tournament_workflow_state, tournament_registration_reservations,
  tournament_player_participation_reservations, tournament_player_participation_claims,
  tournament_draw_versions, tournament_draw_assignments, tournament_draw_groups,
  tournament_live_draw_sessions, tournament_live_draw_events, tournament_live_draw_picks,
  tournament_roster_lock_snapshots, tournament_registration_control_audit,
  tournament_roster_withdrawal_adjustments
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM tournaments
  WHERE id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND status='PREPARING';
  IF n <> 3 THEN RAISE EXCEPTION 'The three demo tournaments are not all PREPARING; aborting reset'; END IF;

  SELECT count(*) INTO n FROM tournament_registration_reservations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  );
  IF n <> 40 THEN RAISE EXCEPTION 'Expected 40 Tournament reservations, found %', n; END IF;

  SELECT count(*) INTO n FROM tournament_player_participation_claims
  WHERE tournament_id='9f765a91-b8ab-4716-a083-0cf8a113db1b' AND state='RELEASED';
  IF n <> 80 THEN RAISE EXCEPTION 'Expected 80 released HCMC invitation claims to restore, found %', n; END IF;

  IF (SELECT count(*) FROM regulations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) <> 3 THEN RAISE EXCEPTION 'Expected the three existing regulation records; aborting to preserve them'; END IF;

  IF (SELECT count(*) FROM regulation_versions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) <> 6 THEN RAISE EXCEPTION 'Regulation versions changed from the backed-up baseline; aborting'; END IF;

  IF EXISTS (
    SELECT 1 FROM registration_periods p JOIN tournaments t ON t.id=p.tournament_id
    WHERE p.tournament_id IN (
      '248006af-5af3-4ff5-8486-47b80fc269b9',
      '9f765a91-b8ab-4716-a083-0cf8a113db1b',
      'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
    ) AND p.end_date <= NOW()
  ) THEN RAISE EXCEPTION 'A registration period has expired; do not reopen it by this reset'; END IF;
END $$;

DELETE FROM tournament_registration_control_audit WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_roster_withdrawal_adjustments WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_roster_lock_snapshots WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DELETE FROM tournament_player_participation_reservations WHERE registration_id IN (
  SELECT registration_id FROM tournament_registration_reservations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);

UPDATE tournament_player_participation_claims
SET state='ACTIVE',released_at=NULL,updated_at=NOW()
WHERE tournament_id='9f765a91-b8ab-4716-a083-0cf8a113db1b' AND state='RELEASED';

UPDATE tournament_registration_reservations
SET status='PENDING',persisted_in_organization=TRUE,expires_at='infinity'::timestamptz,
    conflict_details='[]'::jsonb,updated_at=NOW()
WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DELETE FROM tournament_draw_assignments WHERE draw_version_id IN (
  SELECT id FROM tournament_draw_versions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM tournament_draw_groups WHERE draw_version_id IN (
  SELECT id FROM tournament_draw_versions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM draws WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM groups WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_draw_test_configs WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_draw_test_snapshots WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_live_draw_events WHERE session_id IN (
  SELECT id FROM tournament_live_draw_sessions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM tournament_live_draw_picks WHERE session_id IN (
  SELECT id FROM tournament_live_draw_sessions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM tournament_live_draw_sessions WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_draw_versions WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

UPDATE tournaments SET status='OPEN_REGISTRATION',updated_at=NOW()
WHERE id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
UPDATE tournament_workflow_state state
SET current_step=2,updated_by=t.created_by,updated_at=NOW()
FROM tournaments t
WHERE state.tournament_id=t.id AND t.id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tournaments WHERE id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND status<>'OPEN_REGISTRATION') THEN RAISE EXCEPTION 'A target tournament did not reopen'; END IF;
  IF EXISTS (SELECT 1 FROM tournament_registration_reservations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND (status<>'PENDING' OR persisted_in_organization<>TRUE)) THEN RAISE EXCEPTION 'A reservation is not synchronized to pending'; END IF;
  IF (SELECT count(*) FROM tournament_player_participation_claims WHERE tournament_id='9f765a91-b8ab-4716-a083-0cf8a113db1b' AND state='ACTIVE')<>400 THEN RAISE EXCEPTION 'HCMC accepted-player claims were not restored to 400'; END IF;
  IF EXISTS (SELECT 1 FROM regulation_versions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) GROUP BY tournament_id HAVING count(*)<>2) THEN RAISE EXCEPTION 'Published regulation versions changed'; END IF;
END $$;

ROLLBACK;