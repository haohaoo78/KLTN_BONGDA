BEGIN;

LOCK TABLE notifications, delivery_logs, referee_assignment_email_deliveries
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM referee_assignment_email_deliveries
  WHERE event_key IN (
    'referee-assignment:775c09bd-9a0d-468f-a651-7678c4adb8d5',
    'referee-assignment:be179b59-b108-4c7b-ac8a-6fb94e7ed565',
    'referee-assignment:ddd39e3a-5f58-4efb-85ed-a6ade71ef6a1',
    'referee-assignment:bebe8863-7098-46ee-85a7-dc107e27b78d'
  );
  IF n <> 4 THEN RAISE EXCEPTION 'Expected 4 backed-up referee assignment delivery keys, found %', n; END IF;
END $$;

DELETE FROM delivery_logs WHERE notification_id IN (
  SELECT id FROM notifications WHERE
    data::text ILIKE ANY (ARRAY[
      '%248006af-5af3-4ff5-8486-47b80fc269b9%',
      '%9f765a91-b8ab-4716-a083-0cf8a113db1b%',
      '%d9fe5a04-5e71-41ec-b85c-f4567b294c68%'
    ])
    OR title ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%'])
    OR body ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%'])
);
DELETE FROM notifications WHERE
  data::text ILIKE ANY (ARRAY[
    '%248006af-5af3-4ff5-8486-47b80fc269b9%',
    '%9f765a91-b8ab-4716-a083-0cf8a113db1b%',
    '%d9fe5a04-5e71-41ec-b85c-f4567b294c68%'
  ])
  OR title ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%'])
  OR body ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%']);

DELETE FROM referee_assignment_email_deliveries WHERE event_key IN (
  'referee-assignment:775c09bd-9a0d-468f-a651-7678c4adb8d5',
  'referee-assignment:be179b59-b108-4c7b-ac8a-6fb94e7ed565',
  'referee-assignment:ddd39e3a-5f58-4efb-85ed-a6ade71ef6a1',
  'referee-assignment:bebe8863-7098-46ee-85a7-dc107e27b78d'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE
    data::text ILIKE ANY (ARRAY[
      '%248006af-5af3-4ff5-8486-47b80fc269b9%',
      '%9f765a91-b8ab-4716-a083-0cf8a113db1b%',
      '%d9fe5a04-5e71-41ec-b85c-f4567b294c68%'
    ])
    OR title ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%'])
    OR body ILIKE ANY (ARRAY['%DEMO IUH League 2026%','%DEMO HCMC Student Champions Cup 2026%','%DEMO Student Knockout Cup 2026%'])
  ) THEN RAISE EXCEPTION 'Scoped notifications remain'; END IF;
  IF EXISTS (SELECT 1 FROM referee_assignment_email_deliveries WHERE event_key IN (
    'referee-assignment:775c09bd-9a0d-468f-a651-7678c4adb8d5',
    'referee-assignment:be179b59-b108-4c7b-ac8a-6fb94e7ed565',
    'referee-assignment:ddd39e3a-5f58-4efb-85ed-a6ade71ef6a1',
    'referee-assignment:bebe8863-7098-46ee-85a7-dc107e27b78d'
  )) THEN RAISE EXCEPTION 'Scoped referee assignment delivery keys remain'; END IF;
END $$;

ROLLBACK;