import http from "node:http";
const variant = process.env.STAGING_VARIANT || "unknown";
http.createServer((request, response) => {
  if (request.url === "/api/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true, environment: "staging-only", variant }));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(3000, "0.0.0.0");
