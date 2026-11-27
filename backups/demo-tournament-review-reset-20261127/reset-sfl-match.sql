BEGIN;

LOCK TABLE matches, lineups, match_bracket_slots, match_bracket_qualification_sources,
  match_clock_action_history, match_clock_states, match_demo_time_history, match_demo_times,
  match_event_discipline_outbox, match_event_history, match_events, match_fixture_generations,
  match_forfeit_decisions, match_group_lot_draws, match_knockout_qualifications,
  match_operation_rule_bindings, match_pause_requests, match_preparation_issues,
  match_realtime_events, match_report_reviews, match_reports, match_result_correction_requests,
  match_results, match_shootout_history, match_shootouts, match_squad_history, match_squads, standings
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM matches WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  );
  IF n <> 58 THEN RAISE EXCEPTION 'Expected 58 backed-up fixtures, found %; aborting reset', n; END IF;
END $$;

DELETE FROM match_event_discipline_outbox WHERE event_id IN (
  SELECT e.id FROM match_events e JOIN matches m ON m.id=e.match_id WHERE m.tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DELETE FROM match_event_history WHERE match_id IN (
  SELECT id FROM matches WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);

DO $$
DECLARE removed integer;
BEGIN
  LOOP
    DELETE FROM match_events e
    WHERE e.match_id IN (
      SELECT id FROM matches WHERE tournament_id IN (
        '248006af-5af3-4ff5-8486-47b80fc269b9',
        '9f765a91-b8ab-4716-a083-0cf8a113db1b',
        'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
      )
    ) AND NOT EXISTS (
      SELECT 1 FROM match_events child WHERE child.supersedes_event_id=e.id
        AND child.match_id IN (SELECT id FROM matches WHERE tournament_id IN (
          '248006af-5af3-4ff5-8486-47b80fc269b9',
          '9f765a91-b8ab-4716-a083-0cf8a113db1b',
          'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
        ))
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    EXIT WHEN removed=0;
  END LOOP;
  IF EXISTS (SELECT 1 FROM match_events e JOIN matches m ON m.id=e.match_id WHERE m.tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) THEN RAISE EXCEPTION 'Cyclic or cross-scoped event revision remains; aborting'; END IF;
END $$;

DELETE FROM match_bracket_qualification_sources WHERE slot_id IN (
  SELECT id FROM match_bracket_slots WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )
);
DO $$
DECLARE removed integer;
BEGIN
  LOOP
    DELETE FROM match_bracket_slots slot
    WHERE slot.tournament_id IN (
      '248006af-5af3-4ff5-8486-47b80fc269b9',
      '9f765a91-b8ab-4716-a083-0cf8a113db1b',
      'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
    ) AND NOT EXISTS (
      SELECT 1 FROM match_bracket_slots child WHERE child.tournament_id=slot.tournament_id
        AND (child.home_source_slot_id=slot.id OR child.away_source_slot_id=slot.id)
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    EXIT WHEN removed=0;
  END LOOP;
  IF EXISTS (SELECT 1 FROM match_bracket_slots WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) THEN RAISE EXCEPTION 'Cyclic bracket source remains; aborting'; END IF;
END $$;

DELETE FROM match_report_reviews WHERE report_id IN (
  SELECT id FROM match_reports WHERE match_id IN (
    SELECT id FROM matches WHERE tournament_id IN (
      '248006af-5af3-4ff5-8486-47b80fc269b9',
      '9f765a91-b8ab-4716-a083-0cf8a113db1b',
      'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
    )
  )
);
DELETE FROM match_forfeit_decisions WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM match_pause_requests WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_result_correction_requests WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_forfeit_decisions WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_results WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_reports WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM lineups WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_squad_history WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_squads WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_shootout_history WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_shootouts WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_clock_action_history WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DO $$
DECLARE n integer; trigger_enabled boolean;
BEGIN
  SELECT count(*) INTO n FROM match_demo_time_history h JOIN matches m ON m.id=h.match_id
  WHERE m.tournament_id IN ('248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68');
  IF n <> 12 THEN RAISE EXCEPTION 'Expected 12 scoped demo-time audit rows, found %; aborting',n; END IF;
  SELECT tgenabled='O' INTO trigger_enabled FROM pg_trigger WHERE tgname='protect_match_demo_time_history' AND tgrelid='public.match_demo_time_history'::regclass;
  IF trigger_enabled IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Append-only audit trigger is not enabled; aborting'; END IF;
END $$;
-- Scoped history is included in the requested reset and has been backed up. The table is locked;
-- disable only its append-only guard for this transaction, delete the three-tournament rows,
-- then restore the guard before any commit. Any error rolls the transaction back.
ALTER TABLE match_demo_time_history DISABLE TRIGGER protect_match_demo_time_history;
DELETE FROM match_demo_time_history WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
ALTER TABLE match_demo_time_history ENABLE TRIGGER protect_match_demo_time_history;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='protect_match_demo_time_history' AND tgrelid='public.match_demo_time_history'::regclass AND tgenabled<>'O') THEN RAISE EXCEPTION 'Append-only audit trigger was not restored'; END IF;
  IF EXISTS (SELECT 1 FROM match_demo_time_history h JOIN matches m ON m.id=h.match_id WHERE m.tournament_id IN ('248006af-5af3-4ff5-8486-47b80fc269b9','9f765a91-b8ab-4716-a083-0cf8a113db1b','d9fe5a04-5e71-41ec-b85c-f4567b294c68')) THEN RAISE EXCEPTION 'Scoped demo-time history remains'; END IF;
END $$;
DELETE FROM match_demo_times WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_clock_states WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_preparation_issues WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_operation_rule_bindings WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM match_fixture_generations WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM match_group_lot_draws WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM match_knockout_qualifications WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);
DELETE FROM match_realtime_events WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
));
DELETE FROM standings WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DELETE FROM matches WHERE tournament_id IN (
  '248006af-5af3-4ff5-8486-47b80fc269b9',
  '9f765a91-b8ab-4716-a083-0cf8a113db1b',
  'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM matches WHERE tournament_id IN (
    '248006af-5af3-4ff5-8486-47b80fc269b9',
    '9f765a91-b8ab-4716-a083-0cf8a113db1b',
    'd9fe5a04-5e71-41ec-b85c-f4567b294c68'
  )) THEN RAISE EXCEPTION 'Target fixture rows remain'; END IF;
END $$;

COMMIT;

