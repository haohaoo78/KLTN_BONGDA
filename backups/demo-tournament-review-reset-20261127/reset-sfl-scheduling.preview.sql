BEGIN;

LOCK TABLE schedules, schedule_change_history, schedule_referee_assignment_history,
  schedule_referee_assignments, schedule_referee_drafts, schedule_referee_draft_slots,
  schedule_referee_publications, referee_assignment_messages, referee_assignment_email_attempts,
  referee_team_access_emails, tournament_referee_team, tournament_referee_configurations,
  tournament_schedule_resources, match_schedule_test_snapshots
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  );
  IF n <> 58 THEN RAISE EXCEPTION 'Expected 58 backed-up schedules, found %; aborting reset', n; END IF;
  SELECT count(*) INTO n FROM schedule_referee_assignments a JOIN schedules s ON s.id=a.schedule_id
  WHERE s.tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  );
  IF n <> 3 THEN RAISE EXCEPTION 'Referee assignment count changed from backed-up 3; aborting reset'; END IF;
END $$;

DELETE FROM referee_assignment_email_attempts WHERE message_id IN (
  SELECT id FROM referee_assignment_messages WHERE schedule_id IN (
    SELECT id FROM schedules WHERE tournament_id IN (
      '248006af-5af3-4ff5-8486-47b80fc269b9',
      '9f765a91-b8ab-4716-a083-0cf8a113db1b',
      'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
    )
  )
);
DELETE FROM referee_assignment_messages WHERE schedule_id IN (
  SELECT id FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM schedule_referee_draft_slots WHERE schedule_id IN (
  SELECT id FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM schedule_referee_drafts WHERE schedule_id IN (
  SELECT id FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM schedule_referee_publications WHERE schedule_id IN (
  SELECT id FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM schedule_change_history WHERE schedule_id IN (
  SELECT id FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM schedule_referee_assignment_history WHERE schedule_id IN (
  SELECT id FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM schedule_referee_assignments WHERE schedule_id IN (
  SELECT id FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM schedules WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DELETE FROM referee_team_access_emails WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_referee_team WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_referee_configurations WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM tournament_schedule_resources WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM match_schedule_test_snapshots WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schedules WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) THEN RAISE EXCEPTION 'Target schedules remain'; END IF;
  IF EXISTS (SELECT 1 FROM tournament_referee_team WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) THEN RAISE EXCEPTION 'Target referee team entries remain'; END IF;
END $$;

ROLLBACK;