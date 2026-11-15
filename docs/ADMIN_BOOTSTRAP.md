# CQRTV admin access bootstrap

Admin access is deliberately inactive by default. The additive database migration sets `users.is_admin` to `false` for every existing and future account. There is no public bootstrap route, email-domain rule, nickname rule, seeded admin, or committed credential.

## One-time owner-controlled grant

Do not run this procedure until the owner has explicitly approved the bootstrap and supplied the exact existing user ID through the agreed private channel. Never request or place a user's password, session cookie, email address, or personal details in a repository issue or commit.

1. Apply the service migration by deploying the reviewed API version to the intended environment. Startup applies `001_admin_mvp` transactionally and records it in `schema_migrations`.
2. Verify the selected numeric user ID and that their account is active and email-verified through the restricted database console.
3. Connect to the intended environment using its protected `DATABASE_URL`, then run the script from the API container or another approved server-side environment:

   ```sh
   CONFIRM_ADMIN_GRANT=YES node api/scripts/grant-admin.mjs <approved-user-id>
   ```

4. The script changes only the specified verified, active row and prints only the numeric ID. It never sets a password or returns account data. The admin login still requires that user's existing password and verified email.
5. The owner should verify the panel URL and later revoke access through a reviewed database operation if needed. Admin privileges should be granted only to trusted individuals.

This script has not been executed by this change. No administrator is assigned by the migration or normal app startup.

## Rollback

Rolling back the application does not require destructive schema rollback; the new columns and tables are additive. Preserve the migration record and data when rolling back the container image. If the owner later asks to remove the schema, prepare a separate reviewed migration after a database backup; do not drop audit data or privileges as an automatic deploy step.

