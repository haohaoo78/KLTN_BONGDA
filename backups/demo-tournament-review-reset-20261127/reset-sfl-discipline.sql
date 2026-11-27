BEGIN;

LOCK TABLE cards, suspensions, complaints, complaint_appeals, disciplinary_decisions
  IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM complaint_appeals WHERE complaint_id IN (
  SELECT id FROM complaints WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM disciplinary_decisions WHERE complaint_id IN (
  SELECT id FROM complaints WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
) OR suspension_id IN (
  SELECT id FROM suspensions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM suspensions WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM cards WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM complaints WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cards WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) OR EXISTS (SELECT 1 FROM suspensions WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) OR EXISTS (SELECT 1 FROM complaints WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) THEN RAISE EXCEPTION 'Scoped disciplinary rows remain'; END IF;
END $$;

COMMIT;
