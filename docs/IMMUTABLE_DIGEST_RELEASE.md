# CQRTV release deployment notes

PR #11 introduced a Hostinger API based update workflow and digest Compose generator. That path is historical and is not the selected production release interface. Its update call uses the saved Hostinger project Compose; it has no manifest payload. Its latest observed action polling ended in an unknown state. Do not use the legacy Hostinger workflow for an official release.

Deployment V2 is proposed in PR #23 and documented in docs/DEPLOYMENT_V2.md. It disables push-to-main deployment, requires explicit workflow dispatch and protected GitHub Environments, uses one generated digest-pinned Compose artifact, and proposes SSH plus standard Docker Compose after read-only reconciliation.

The repository Compose baseline keeps web/API images pinned by digest and preserves the named PostgreSQL, Caddy and secret volumes. Buildx output digests become the exact refs for a release manifest. The V2 workflow does not use latest tags for production images. It does not automatically edit the Hostinger saved Compose or send application secrets to the VPS.

Historic owner confirmation of old running digests and a PostgreSQL dump restore is not current production inventory. Reconfirm exact live refs, protected backup freshness and Site Control mode before release. The V2 staging tests in GitHub Actions do not establish behavior on the Hostinger VPS.

Never use docker compose down -v or remove/recreate production volumes. API rollback after auth/admin state changes remains forward-fix only unless a separately verified compatibility decision is approved.
