import { getDb } from "./db";
import { ensureProductionSchema } from "./schema";

export async function recordAdminAction(
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await ensureProductionSchema();
  const sql = getDb();
  await sql`
    insert into spin_admin_audit_log (action, metadata)
    values (${action.slice(0, 80)}, ${JSON.stringify(metadata)}::jsonb)
  `;
}
