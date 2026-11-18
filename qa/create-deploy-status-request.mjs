const runId = process.env.GITHUB_RUN_ID || "";
if (!/^[1-9][0-9]{0,19}$/.test(runId)) {
  console.error("Could not create a valid CQRTV status request.");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ schema_version: 1, operation: "status", run_id: runId }) + "\n");
