import { getPool as getMatchPool } from "../../lib/db";
import { issueCard, retractEventCard } from "./disciplineService";

type OutboxEvent = {
  id: string;
  action: "ISSUE_CARD" | "VOID_CARD";
  payload: Record<string, unknown>;
  attempts: number;
};

let timer: NodeJS.Timeout | null = null;
let processing = false;

export async function processMatchEventDisciplineOutbox(batchSize = 20): Promise<number> {
  if (processing) return 0;
  processing = true;
  const pool = getMatchPool();
  try {
    const client = await pool.connect();
    let events: OutboxEvent[];
    try {
      await client.query("BEGIN");
      const claimed = await client.query<OutboxEvent>(
        `WITH available AS (
           SELECT id FROM match_event_discipline_outbox
           WHERE processed_at IS NULL AND available_at <= NOW()
             AND (claimed_until IS NULL OR claimed_until < NOW())
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE match_event_discipline_outbox AS outbox
         SET claimed_until = NOW() + INTERVAL '60 seconds', attempts = attempts + 1
         FROM available
         WHERE outbox.id = available.id
         RETURNING outbox.id, outbox.action, outbox.payload, outbox.attempts`,
        [batchSize],
      );
      events = claimed.rows;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    for (const event of events) {
      try {
        if (event.action === "ISSUE_CARD") {
          const sourceEvent = await pool.query<{ is_voided: boolean }>(
            "SELECT voided_at IS NOT NULL AS is_voided FROM match_events WHERE id = $1",
            [String(event.payload.eventId)],
          );
          if (!sourceEvent.rowCount || sourceEvent.rows[0].is_voided) {
            await pool.query(
              `UPDATE match_event_discipline_outbox
               SET processed_at = NOW(), claimed_until = NULL, last_error = NULL
               WHERE id = $1`,
              [event.id],
            );
            continue;
          }
          await issueCard({
            playerId: String(event.payload.playerId),
            matchId: String(event.payload.matchId),
            tournamentId: String(event.payload.tournamentId),
            teamId: String(event.payload.teamId),
            cardType: event.payload.cardType as "YELLOW" | "RED",
            minute: typeof event.payload.minute === "number" ? event.payload.minute : undefined,
            reason: typeof event.payload.reason === "string" ? event.payload.reason : undefined,
            sourceEventId: String(event.payload.eventId),
          }, String(event.payload.issuedBy));
        } else {
          await retractEventCard(String(event.payload.eventId), String(event.payload.actorId), String(event.payload.reason));
        }
        await pool.query(
          `UPDATE match_event_discipline_outbox
           SET processed_at = NOW(), claimed_until = NULL, last_error = NULL
           WHERE id = $1`,
          [event.id],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown discipline sync error";
        await pool.query(
          `UPDATE match_event_discipline_outbox
           SET claimed_until = NULL, last_error = $2,
               available_at = NOW() + LEAST(300, POWER(2, LEAST(attempts, 8))) * INTERVAL '1 second'
           WHERE id = $1`,
          [event.id, message],
        );
        console.error(`[match-service] discipline outbox event ${event.id} failed; retry scheduled`);
      }
    }
    return events.length;
  } finally {
    processing = false;
  }
}

export function startMatchEventDisciplineOutboxWorker(): () => void {
  if (timer) return () => stopMatchEventDisciplineOutboxWorker();
  void processMatchEventDisciplineOutbox().catch(() => {
    console.error("[match-service] discipline outbox polling failed; retrying");
  });
  timer = setInterval(() => {
    void processMatchEventDisciplineOutbox().catch(() => {
      console.error("[match-service] discipline outbox polling failed; retrying");
    });
  }, 5000);
  return () => stopMatchEventDisciplineOutboxWorker();
}

export function stopMatchEventDisciplineOutboxWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
