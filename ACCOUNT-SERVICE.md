# CQRTV account service

The Docker Compose stack keeps PostgreSQL on an internal-only Docker network and stores data in persistent named volumes. The first start creates a random database password in the private `db_secret` volume; it is never committed to Git.

## SMTP and activation

Set these project environment variables in Hostinger Docker Manager:

- `SMTP_URL`: SMTP connection URL, including its credentials (keep it in Hostinger secrets/environment settings, never in Git or chat).
- `MAIL_FROM`: sender, for example `CQRTV <no-reply@example.com>`.
- `REGISTRATION_ENABLED`: set to `true` only after SMTP has been verified and the privacy notice has been completed.

Until then the API returns a clear unavailable response, so it cannot silently accept registrations without being able to verify them. Database storage survives container/image updates. Back up the `postgres_data` volume before VPS migrations.

## Endpoints

Registration, email confirmation, sign-in, password reset, session lookup, and sign-out are provided under `/api/auth`. The site proxies API traffic to the private API container via Caddy.
