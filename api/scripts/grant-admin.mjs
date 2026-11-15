import pg from "pg";

const userId = process.argv[2] || "";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL for the intended environment.");
if (process.env.CONFIRM_ADMIN_GRANT !== "YES") throw new Error("Set CONFIRM_ADMIN_GRANT=YES only after explicit owner approval.");
if (!/^[1-9][0-9]{0,17}$/.test(userId)) throw new Error("Pass the exact existing numeric user ID as the first argument.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  const result = await pool.query(
    "UPDATE users SET is_admin=true WHERE id=$1 AND email_verified=true AND account_status='active' RETURNING id",
    [userId]
  );
  if (!result.rowCount) throw new Error("No verified active user with that ID was granted access.");
  console.log(`Admin access granted to existing user ID ${result.rows[0].id}.`);
} finally {
  await pool.end();
}

