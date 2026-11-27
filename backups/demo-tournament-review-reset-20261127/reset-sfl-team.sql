BEGIN;

LOCK TABLE team_registrations, rosters, tournament_player_invitations,
  team_registration_versions, team_registration_decision_outbox,
  team_registration_approval_reviews, team_registration_approval_review_events,
  team_registration_change_requests, team_registration_change_request_events,
  team_registration_withdrawal_requests, tournament_player_withdrawal_requests,
  tournament_registration_drafts, organization_notification_outbox
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM team_registrations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  );
  IF n <> 40 THEN RAISE EXCEPTION 'Expected 40 scoped registrations, found %', n; END IF;

  SELECT count(*) INTO n FROM rosters WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  );
  IF n <> 664 THEN RAISE EXCEPTION 'Expected 664 submitted roster rows, found %', n; END IF;

  SELECT count(*) INTO n FROM tournament_player_invitations i
  WHERE i.tournament_id='9f765a91-b8ab-4716-a083-0cf8a113db1b'
    AND i.status='WITHDRAWN'
    AND EXISTS (SELECT 1 FROM team_registrations r WHERE r.tournament_id=i.tournament_id AND r.team_id=i.team_id);
  IF n <> 80 THEN RAISE EXCEPTION 'Expected the 80 invitations belonging to the four previously rejected HCMC dossiers, found %', n; END IF;

  SELECT count(*) INTO n FROM team_registration_versions v
  JOIN team_registrations r ON r.id=v.registration_id
  WHERE r.tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND v.action='SUBMITTED';
  IF n <> 40 THEN RAISE EXCEPTION 'Expected one submitted snapshot for each dossier, found %', n; END IF;

  IF EXISTS (
    SELECT 1 FROM organization_notification_outbox
    WHERE (data::text ILIKE ANY (ARRAY[
      '%248006af-5af3-4ff5-8486-47b80fc269b9%',
      '%9f765a91-b8ab-4716-a083-0cf8a113db1b%',
      '%d9fe5a04-5e71-41ec-b85c-f4567b294c68%'
    ]) OR title ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%'])
      OR body ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%']))
      AND state IN ('PENDING','PROCESSING')
  ) THEN RAISE EXCEPTION 'A scoped organization notification is still pending/processing; stop and let its current delivery finish before resetting'; END IF;
END $$;

DELETE FROM organization_notification_outbox
WHERE data::text ILIKE ANY (ARRAY[
    '%248006af-5af3-4ff5-8486-47b80fc269b9%',
    '%9f765a91-b8ab-4716-a083-0cf8a113db1b%',
    '%d9fe5a04-5e71-41ec-b85c-f4567b294c68%'
  ])
  OR title ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%'])
  OR body ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%']);

DELETE FROM team_registration_decision_outbox WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM team_registration_approval_review_events WHERE registration_id IN (
  SELECT id FROM team_registrations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM team_registration_approval_reviews WHERE registration_id IN (
  SELECT id FROM team_registrations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM team_registration_change_request_events WHERE request_id IN (
  SELECT id FROM team_registration_change_requests WHERE registration_id IN (
    SELECT id FROM team_registrations WHERE tournament_id IN (
      '248006af-5af3-4ff5-8486-47b80fc269b9',
      '9f765a91-b8ab-4716-a083-0cf8a113db1b',
      'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
    )
  )
);
DELETE FROM team_registration_change_requests WHERE registration_id IN (
  SELECT id FROM team_registrations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM team_registration_withdrawal_requests WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_player_withdrawal_requests WHERE invitation_id IN (
  SELECT id FROM tournament_player_invitations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM tournament_registration_drafts WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM team_registration_versions WHERE registration_id IN (
  SELECT id FROM team_registrations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
) AND action <> 'SUBMITTED';

UPDATE tournament_player_invitations
SET status='ACCEPTED',status_reason=NULL,conflict_tournament_id=NULL,conflict_tournament_name=NULL,updated_at=NOW()
WHERE tournament_id='9f765a91-b8ab-4716-a083-0cf8a113db1b' AND status='WITHDRAWN'
  AND team_id IN (SELECT team_id FROM team_registrations WHERE tournament_id='9f765a91-b8ab-4716-a083-0cf8a113db1b');

UPDATE rosters SET review_status='PENDING',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL
WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

UPDATE team_registrations
SET status='PENDING',approved_at=NULL,approved_by=NULL,locked_at=NULL,
    supplement_deadline=NULL,supplement_completed_at=NULL,adjustment_deadline=NULL,
    resubmission_allowed=FALSE,waitlist_reason=NULL,registration_conflicts='[]'::jsonb,
    version=1
WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM team_registrations WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND status='PENDING';
  IF n <> 40 THEN RAISE EXCEPTION 'Expected 40 pending dossiers after reset, found %', n; END IF;
  SELECT count(*) INTO n FROM rosters WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND review_status='PENDING';
  IF n <> 664 THEN RAISE EXCEPTION 'Expected all 664 dossier roster rows pending review, found %', n; END IF;
  SELECT count(*) INTO n FROM team_registration_versions v JOIN team_registrations r ON r.id=v.registration_id
  WHERE r.tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND v.action='SUBMITTED';
  IF n <> 40 THEN RAISE EXCEPTION 'Submitted dossier snapshots were not preserved: %', n; END IF;
  SELECT count(*) INTO n FROM tournament_player_invitations i JOIN team_registrations r ON r.team_id=i.team_id AND r.tournament_id=i.tournament_id
  WHERE i.tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  ) AND i.status='ACCEPTED';
  IF n <> 664 THEN RAISE EXCEPTION 'Expected all 664 submitted-roster invitations accepted, found %', n; END IF;
END $$;

COMMIT;
