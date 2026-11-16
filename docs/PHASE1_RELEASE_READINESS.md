# CQRTV Phase 1 release readiness

This checklist applies to the approved public-site Phase 1 change in PR #21. PR #21 must remain unmerged until the owner gives a separate release approval. The pre-flight branch based on PR #21 is dependent on it and should be reviewed/merged only after the owner approves the release sequence.

## Confirmed from repository code

- A push to `main` starts `.github/workflows/deploy.yml`; `workflow_dispatch` is also enabled.
- The workflow builds and pushes web and API images, records their build digests, then calls the Hostinger existing-project update endpoint.
- Hostinger's `/update` request contains no replacement Compose document. The client first reads the saved project Compose, checks it, and only then submits the update. The saved Compose must already use the exact digest refs emitted by that workflow run.
- The current source Compose declares named volume `postgres_data` for PostgreSQL. It also declares Caddy and database-secret volumes. A named volume is persistence configuration, not proof of a tested backup.
- The workflow's previous homepage smoke condition expected `Профиль игрока`; that is not a stable signal for the Phase 1 landing page. The replacement check accepts either the approved Phase 1 homepage or the established shared Coming Soon/Maintenance page. The latest production workflow run visible to Codex is run #63 (`b66d804`): image build/push passed, Hostinger action polling returned `unknown state`, and live smoke was skipped. It does not establish current container or site health.
- The workflow performs a read-only `/api/health` check and checks the home icon's HTTP status and MIME type.

## Release checklist

1. Keep PR #21 and this dependent PR open until an explicit owner release decision. Review final PR #21 SHA and run all required CI on that exact SHA.
2. For the release workflow run, record the web and API digests from that run. Use the generated `docker-compose.release.yml` artifact as the handoff; it pins both refs and preserves the repository Compose volume declarations.
3. Before any Hostinger update, an authorized operator must inspect the saved Hostinger project Compose through the Hostinger control panel. Confirm both service image refs exactly match the workflow digests and `pull_policy: always`. The automated preflight fails closed if they do not. The workflow does not edit saved Compose.
4. Confirm a recent database backup exists and that the documented restore procedure has been validated. Confirm the intended Hostinger backup/snapshot covers PostgreSQL data and any required persistent service volumes. Do not remove or recreate `postgres_data`; never use `docker compose down -v`.
5. From the authenticated Site Control screen, record whether the intended public mode is Open, Coming Soon, or Maintenance before release. Do not include credentials, cookies, or tokens in the Issue report.
6. Save the current saved Compose and the currently running web/API immutable refs for rollback. If rollback is needed, restore those old digest refs and update the existing project while preserving the same named volume bindings.
7. After owner-authorized release, verify the workflow's Hostinger action completed and container readback shows the exact expected web/API refs, both running, and health status healthy/none.
8. Run read-only post-release checks: homepage returns HTTP 200 and is either the Phase 1 landing page or the known closed-site gate; `/api/health` returns 200 with `ok`; `/admin/login` and `/auth.html` load; guest routes do not expose private profile fields; the CQRTV home icon returns `image/svg+xml`; no unexpected credentials or private data appear in the HTML.
9. Confirm the public mode still matches the recorded intent after the release. If mode is closed, verify guests receive the gate page while the admin login remains reachable.

## Unverified host state — owner read-only checks required

The connected GitHub tools do not expose Hostinger project/container/backup state. Issue #4 records owner-confirmed historic facts: the running web/API baseline digests were read from Hostinger before the later deployments, and a 2026-11-15 PostgreSQL custom-format dump was restored successfully in isolated PostgreSQL. These do not establish the current post-run-#63 refs/health or that the dump remains available, protected, and fresh. Issue #4 also records that the Hostinger VPS backup panel had no automatic snapshots at the last owner check. Therefore the following remain unknown and must be checked by an authorized owner in Hostinger before release:

- last Hostinger deploy action and its result;
- actual running web/API image refs and container health;
- current Site Control mode;
- whether a recent PostgreSQL and persistent-volume backup exists, and when restore was last tested;
- the exact saved Hostinger Compose and whether its image refs match a release digest.

The report in Issue #4 must distinguish these unknowns from repository-confirmed facts. Do not paste Hostinger API keys, access tokens, database credentials, cookies, or private backup data into GitHub.
