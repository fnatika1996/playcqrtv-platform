# CQRTV Matchmaking

Private source repository for the CQRTV CS2 matchmaking platform.

## Hosting

- Domain: `playcqrtv.com`
- Host: Hostinger VPS, VM ID `2150572`
- Web container: Caddy, with automatic HTTPS certificates
- Deployment: GitHub Actions on pushes to `main`, using Hostinger's official deploy action

## GitHub Actions setup

Add these repository secrets under **Settings  Secrets and variables  Actions**:

- `HOSTINGER_API_KEY`: API key generated in the Hostinger dashboard
- `PERSONAL_ACCESS_TOKEN`: fine-grained GitHub token with read-only access to this repository, required because the repository is private

The workflow deploys the Docker Compose project from the repository root. The Hostinger VPS must have Docker available, and inbound ports 80 and 443 must be allowed for HTTPS certificate issuance and web traffic.

## Current scope

The initial page is a responsive UI prototype. Account sign-in, Steam linking, matchmaking, match servers, and live ELO data still need implementation.

