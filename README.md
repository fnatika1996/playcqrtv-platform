# CQRTV Matchmaking

Private source repository for the CQRTV CS2 matchmaking platform.

## Hosting

- Domain: `playcqrtv.com`
- Host: Hostinger VPS, VM ID `2150572`
- Web container: Caddy, with automatic HTTPS certificates
- Deployment: GitHub Actions on pushes to `main`

## GitHub Actions setup

Add the repository secret `HOSTINGER_API_KEY` under **Settings → Secrets and variables → Actions**. The workflow targets VM `2150572`.

Because this repository is private, configure a read-only GitHub deploy key on the VPS for Hostinger Docker Manager to fetch the Compose file. Generate the key on the VPS and add only its public key under **Repository Settings → Deploy keys**. Keep the private key on the VPS.

The workflow deploys the Docker Compose project from the repository root. The VPS firewall allows TCP ports 80 and 443 for web traffic and certificate issuance, plus TCP port 22 for SSH access.

## Current scope

The initial page is a responsive UI prototype. Account sign-in, Steam linking, matchmaking, match servers, and live ELO data still need implementation.
