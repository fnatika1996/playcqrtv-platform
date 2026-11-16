import fs from "node:fs";

export function classifyLiveHomepage(html) {
  if (typeof html !== "string" || !html.includes("<html") || html.includes("�")) {
    throw new Error("Homepage response is not valid CQRTV HTML.");
  }

  const publicHome =
    /<main\b[^>]*\bid=["']home["'][^>]*>/i.test(html) &&
    /<h1\b[^>]*\bid=["']home-title["'][^>]*>\s*CQRTV\s*[—-]\s*твоя платформа для CS2\s*<\/h1>/i.test(html);
  if (publicHome) return "open";

  const closedGate =
    /<main\b[^>]*\bid=["']scene["'][^>]*>/i.test(html) &&
    /<h1\b[^>]*\bid=["']heading["'][^>]*>\s*CQRTV скоро откроется\s*<\/h1>/i.test(html);
  if (closedGate) return "coming-soon-or-maintenance";

  throw new Error("Homepage is neither the approved CQRTV Phase 1 landing page nor the known closed-site gate.");
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try {
    const htmlPath = process.argv[2];
    if (!htmlPath) throw new Error("Usage: node qa/live-home-smoke.mjs <downloaded-homepage.html>");
    const html = fs.readFileSync(htmlPath, "utf8");
    process.stdout.write(classifyLiveHomepage(html) + "\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
