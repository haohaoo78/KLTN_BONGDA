BEGIN;
LOCK TABLE team_registrations IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM team_registrations
  WHERE tournament_id IN ('248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68')
    AND status='PENDING'
    AND (notes ILIKE '%chờ suất không được chọn%' OR notes ILIKE '%chưa hoàn thành bổ sung trước khi giải đấu đóng%');
  IF n <> 3 THEN RAISE EXCEPTION 'Expected exactly 3 stale post-review notes, found %; aborting',n; END IF;
END $$;
UPDATE team_registrations SET notes=NULL
WHERE tournament_id IN ('248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68')
  AND status='PENDING'
  AND (notes ILIKE '%chờ suất không được chọn%' OR notes ILIKE '%chưa hoàn thành bổ sung trước khi giải đấu đóng%');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM team_registrations WHERE tournament_id IN ('248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68') AND status='PENDING' AND (notes ILIKE '%chờ suất không được chọn%' OR notes ILIKE '%chưa hoàn thành bổ sung trước khi giải đấu đóng%')) THEN RAISE EXCEPTION 'Stale review notes remain'; END IF;
END $$;
ROLLBACK;