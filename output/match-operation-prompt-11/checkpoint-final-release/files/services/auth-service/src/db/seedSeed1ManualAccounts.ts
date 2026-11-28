import bcrypt from "bcryptjs";
import { Pool } from "pg";

const demoAccounts = [
  { email: "dataset.player0001@football.local", seedKey: "dataset-player-0001" },
  { email: "dataset.player0002@football.local", seedKey: "dataset-player-0002" },
  { email: "dataset.player0241@football.local", seedKey: "dataset-player-0241" },
  { email: "dataset.player0242@football.local", seedKey: "dataset-player-0242" },
  { email: "dataset.player0601@football.local", seedKey: "dataset-player-0601" },
  { email: "dataset.player0611@football.local", seedKey: "dataset-player-0611" },
  { email: "dataset.player0612@football.local", seedKey: "dataset-player-0612" },
  { email: "dataset.player0613@football.local", seedKey: "dataset-player-0613" },
  { email: "dataset.player0616@football.local", seedKey: "dataset-player-0616" },
  { email: "dataset.player0617@football.local", seedKey: "dataset-player-0617" },
  { email: "dataset.player0618@football.local", seedKey: "dataset-player-0618" },
  { email: "dataset.player0619@football.local", seedKey: "dataset-player-0619" },
  { email: "dataset.player0620@football.local", seedKey: "dataset-player-0620" },
  { email: "dataset.captain01@football.local", seedKey: "dataset-captain-01" },
  { email: "dataset.captain13@football.local", seedKey: "dataset-captain-13" },
  { email: "dataset.captain31@football.local", seedKey: "dataset-captain-31" },
  { email: "dataset.btc01@football.local", seedKey: "dataset-btc-01" },
] as const;

async function main(): Promise<void> {
  if (!(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")) throw new Error("Seed 1 demo credentials are restricted to development/test");
  const databaseUrl = process.env.ACCOUNT_DATABASE_URL;
  const password = process.env.SEED1_MANUAL_PASSWORD;
  if (!databaseUrl || !password || password.length < 8) throw new Error("ACCOUNT_DATABASE_URL and an 8+ character SEED1_MANUAL_PASSWORD are required");
  const hash = await bcrypt.hash(password, 10);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sftms-seed1-manual-account-passwords-v1')::bigint)");
      for (const account of demoAccounts) {
        const result = await client.query(
          `UPDATE users AS account SET password_hash=$3
           FROM demo_account_registry registry
           WHERE registry.user_id=account.id AND registry.seed_key=$2 AND LOWER(account.email)=LOWER($1)
           RETURNING account.id`,
          [account.email,account.seedKey,hash],
        );
        if (result.rowCount !== 1) throw new Error(`Refusing to update a missing or non-demo account: ${account.email}`);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    console.log(JSON.stringify({ seed: "Seed 1 manual test accounts", accountsUpdated: demoAccounts.map((account) => account.email), password: "set from SEED1_MANUAL_PASSWORD" }, null, 2));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error: unknown) => { console.error("[seed1-manual-accounts] failed", error); process.exitCode = 1; });
