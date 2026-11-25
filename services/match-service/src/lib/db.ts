import { Pool } from "pg";
import { config } from "../config";

let pool: Pool | null = null;
let schedulingPool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export function getSchedulingPool(): Pool {
  if (!schedulingPool) schedulingPool = new Pool({ connectionString: config.schedulingDatabaseUrl });
  return schedulingPool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (schedulingPool) {
    await schedulingPool.end();
    schedulingPool = null;
  }
}
