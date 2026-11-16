export function classifyHomepage(html) {
  if (typeof html !== "string" || !html.includes("<html") || html.includes("�")) throw new Error("Invalid or corrupted CQRTV homepage HTML.");
  if (/id=["']heading["'][^>]*>\s*CQRTV скоро откроется\s*</i.test(html)) return "closed-gate";
  if (/id=["']home-title["'][^>]*>\s*CQRTV\s*[—-]\s*твоя платформа для CS2\s*</i.test(html)) return "phase1-public";
  if (html.includes("<title>CQRTV - CS2 Matchmaking</title>") && html.includes("Профиль игрока")) return "current-main-public";
  throw new Error("Unexpected or private homepage response.");
}

export async function verifyPublicSurface(baseUrl, fetchImpl = fetch) {
  const root=baseUrl.replace(/\/+$/,"");
  const page=await fetchImpl(root+"/",{redirect:"follow",cache:"no-store"});
  if(!page.ok)throw new Error("Homepage did not return HTTP 200.");
  const mode=classifyHomepage(await page.text());
  const [health,auth,adminLogin,icon]=await Promise.all([
    fetchImpl(root+"/api/health",{redirect:"follow",cache:"no-store"}),
    fetchImpl(root+"/auth.html",{redirect:"follow",cache:"no-store"}),
    fetchImpl(root+"/admin/login",{redirect:"follow",cache:"no-store"}),
    fetchImpl(root+"/assets/icons/cqrtv/ui/home.svg",{redirect:"follow",cache:"no-store"})
  ]);
  if(!health.ok||!/ok/i.test(await health.text()))throw new Error("API health smoke failed.");
  if(!auth.ok||!/text\/html/i.test(auth.headers.get("content-type")||""))throw new Error("Player auth route is unavailable.");
  if(!adminLogin.ok||!/text\/html/i.test(adminLogin.headers.get("content-type")||""))throw new Error("Admin login route is unavailable.");
  if(!icon.ok||!/image\/svg\+xml/i.test(icon.headers.get("content-type")||""))throw new Error("CQRTV icon route or SVG MIME check failed.");
  return {homepageMode:mode,authStatus:auth.status,adminLoginStatus:adminLogin.status,iconMime:icon.headers.get("content-type")};
}

if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
  try{
    const baseUrl=process.argv[2];
    if(!baseUrl||!/^https:\/\//i.test(baseUrl))throw new Error("Usage: node qa/deployment-v2-smoke.mjs https://playcqrtv.com");
    process.stdout.write(JSON.stringify(await verifyPublicSurface(baseUrl))+"\n");
  }catch(error){console.error(error.message);process.exitCode=1;}
}
