import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import nodemailer from "nodemailer";
import { passwordError } from "./password-policy.mjs";
import { createAdminRoutes } from "./admin-routes.mjs";

const { Pool } = pg;
const origin = process.env.APP_ORIGIN || "https://playcqrtv.com";
const enabled = process.env.REGISTRATION_ENABLED === "true";
const smtpUrl = process.env.SMTP_URL || "";
const mailFrom = process.env.MAIL_FROM || "";
const dbPassword = process.env.DATABASE_URL ? undefined : fs.readFileSync(process.env.DB_PASSWORD_FILE || "/run/db-secret/password", "utf8").trim();
export const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, max: 12, connectionTimeoutMillis: 5000 } : {host:"db",port:5432,database:"cqrtv",user:"cqrtv",password:dbPassword,max:12,connectionTimeoutMillis:5000});
const roles = new Set(["rifler","entry","support","awper","igl","lurker","anchor","flex"]);
const rates = new Map();
const emailer = smtpUrl && mailFrom ? nodemailer.createTransport(smtpUrl,{connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000}) : null;
const json = (res,status,data,headers={})=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers});res.end(JSON.stringify(data));};
const tokenHash = value=>crypto.createHash("sha256").update(value).digest("hex");
function sessionToken(req){return (req.headers.cookie||"").split(";").map(v=>v.trim()).find(v=>v.startsWith("cqrtv_session="))?.slice(14)||"";}
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
function rateLimit(req,key,max,windowMs){const ip=(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown").toString().split(",")[0].trim();const id=key+":"+ip,now=Date.now(),item=rates.get(id);if(!item||item.until<now){rates.set(id,{count:1,until:now+windowMs});return false;}item.count++;return item.count>max;}
async function body(req){let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw Object.assign(new Error("Request too large"),{status:413});}try{return JSON.parse(raw||"{}");}catch{throw Object.assign(new Error("Invalid JSON"),{status:400});}}
function checkOrigin(req){const value=req.headers.origin;if(value&&value!==origin)throw Object.assign(new Error("Origin rejected"),{status:403});}
async function hashPassword(password){const salt=crypto.randomBytes(16);const key=await new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(e,k)=>e?reject(e):resolve(k)));return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;}
async function verifyPassword(password,encoded){const [kind,saltHex,keyHex]=String(encoded).split("$");if(kind!=="scrypt"||!saltHex||!keyHex)return false;const salt=Buffer.from(saltHex,"hex"),expected=Buffer.from(keyHex,"hex");const actual=await new Promise((resolve,reject)=>crypto.scrypt(password,salt,expected.length,{N:32768,r:8,p:1,maxmem:64*1024*1024},(e,k)=>e?reject(e):resolve(k)));return crypto.timingSafeEqual(actual,expected);}
function validCountry(code){if(typeof code!=="string"||!/^[A-Z]{2}$/.test(code))return false;try{const name=new Intl.DisplayNames(["en"],{type:"region"}).of(code);return !!name&&name!==code;}catch{return false;}}
async function mail(to,subject,text){if(!emailer||!mailFrom)throw new Error("Email delivery is not configured");await emailer.sendMail({from:mailFrom,to,subject,text});}
function token(){return crypto.randomBytes(32).toString("base64url");}
async function createAuthLink(purpose,email,displayName,tx){const raw=token();await tx.query("INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) SELECT $1,id,$2,now()+interval '1 hour' FROM users WHERE email=$3",[tokenHash(raw),purpose,email]);const path=purpose==="verify"?"verify":"reset";const link=`${origin}/auth.html?mode=${path}&token=${encodeURIComponent(raw)}`;const title=purpose==="verify"?"Подтвердите email CQRTV":"Восстановление пароля CQRTV";const text=purpose==="verify"?`Здравствуйте, ${displayName}!\n\nЧтобы подтвердить email, откройте ссылку:\n${link}\n\nСсылка действует 1 час. Если вы не создавали аккаунт, проигнорируйте письмо.`:`Здравствуйте, ${displayName}!\n\nЧтобы задать новый пароль, откройте ссылку:\n${link}\n\nСсылка действует 1 час. Если вы не запрашивали восстановление, проигнорируйте письмо.`;await mail(email,title,text);}
export async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,nickname VARCHAR(24) NOT NULL UNIQUE,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,country CHAR(2) NOT NULL,primary_role TEXT NOT NULL,secondary_roles TEXT[] NOT NULL DEFAULT '{}',email_verified BOOLEAN NOT NULL DEFAULT false,nickname_changed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_changed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_ci_unique ON users (lower(trim(nickname)));
CREATE TABLE IF NOT EXISTS auth_tokens(token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS auth_tokens_expiry_idx ON auth_tokens(expires_at);CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);`);
await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
const migrationId = "001_admin_mvp";
const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE id=$1", [migrationId]);
if (!applied.rowCount) {
 const client = await pool.connect();
 try { await client.query("BEGIN"); await client.query(fs.readFileSync(new URL("./migrations/001_admin_mvp.sql", import.meta.url), "utf8")); await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [migrationId]); await client.query("COMMIT"); }
 catch (error) { await client.query("ROLLBACK"); throw error; }
 finally { client.release(); }
}
}
async function handle(req,res){const url=new URL(req.url,"http://localhost");if(req.method==="GET"&&url.pathname==="/api/health"){return json(res,200,{ok:true});}

if(!url.pathname.startsWith("/api/"))return json(res,404,{error:"Not found"});
if(req.method==="POST")try{checkOrigin(req);}catch(e){return json(res,e.status||403,{error:e.message});}
try{
if(await adminRoutes(req,res))return;
if(req.method==="POST"&&url.pathname==="/api/account/nickname"){
if(rateLimit(req,"nickname-change",5,3600000))return json(res,429,{error:"Слишком много попыток. Попробуйте позже."});
const raw=sessionToken(req);if(!raw)return json(res,401,{error:"Войдите в аккаунт, чтобы изменить никнейм."});
const b=await body(req),nickname=String(b.nickname||"").normalize("NFKC").trim();
if(nickname.length<3||nickname.length>24||!/^[\p{L}\p{N}_ .-]+$/u.test(nickname))return json(res,400,{error:"Никнейм: 3–24 символа, буквы, цифры, пробел, точка, дефис или _."});
const client=await pool.connect();try{await client.query("BEGIN");const current=await client.query("SELECT u.id,u.nickname,u.nickname_changed_at,u.nickname_changed_at + interval '3 months' AS nickname_available_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.email_verified=true AND u.account_status='active' FOR UPDATE OF u",[tokenHash(raw)]);if(!current.rowCount){await client.query("ROLLBACK");return json(res,401,{error:"Войдите в подтверждённый аккаунт."});}
if(current.rows[0].nickname.toLocaleLowerCase("en-US")===nickname.toLocaleLowerCase("en-US")){await client.query("COMMIT");return json(res,200,{message:"Этот никнейм уже установлен.",nickname:current.rows[0].nickname});}
const availableAt=current.rows[0].nickname_available_at?new Date(current.rows[0].nickname_available_at):null;if(availableAt&&availableAt>Date.now()){await client.query("ROLLBACK");return json(res,429,{error:"Бесплатно менять никнейм можно раз в 3 месяца.",nicknameAvailableAt:availableAt.toISOString()});}
const used=await client.query("SELECT 1 FROM users WHERE lower(trim(nickname))=lower($1) AND id<>$2",[nickname,current.rows[0].id]);if(used.rowCount){await client.query("ROLLBACK");return json(res,409,{error:"Этот игровой никнейм уже занят. Выберите другой."});}
const changed=await client.query("UPDATE users SET nickname=$1,nickname_changed_at=now() WHERE id=$2 RETURNING nickname,nickname_changed_at + interval '3 months' AS nickname_available_at",[nickname,current.rows[0].id]);await client.query("COMMIT");return json(res,200,{message:"Игровой никнейм изменён.",nickname:changed.rows[0].nickname,nicknameAvailableAt:changed.rows[0].nickname_available_at});
}catch(e){await client.query("ROLLBACK");if(e.code==="23505")return json(res,409,{error:"Этот игровой никнейм уже занят. Выберите другой."});throw e;}finally{client.release();}
}
if(req.method==="GET"&&url.pathname==="/api/auth/nickname-availability"){
if(rateLimit(req,"nickname-check",60,3600000))return json(res,429,{error:"Слишком много проверок. Попробуйте позже."});
const nickname=String(url.searchParams.get("nickname")||"").normalize("NFKC").trim();
if(nickname.length<3||nickname.length>24||!/^[\p{L}\p{N}_ .-]+$/u.test(nickname))return json(res,400,{available:false,error:"Никнейм: 3–24 символа, буквы, цифры, пробел, точка, дефис или _."});
const taken=await pool.query("SELECT 1 FROM users WHERE lower(trim(nickname))=lower($1)",[nickname]);
return json(res,200,{available:!taken.rowCount});
}
if(req.method==="POST"&&url.pathname==="/api/auth/register"){
if(!enabled||!emailer||!mailFrom)return json(res,503,{error:"Регистрация временно закрыта: подключение почты ещё не завершено."});
if(rateLimit(req,"register",5,3600000))return json(res,429,{error:"Слишком много попыток. Попробуйте позже."});
const b=await body(req),nickname=String(b.nickname||"").normalize("NFKC").trim(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||""),country=String(b.country||"").toUpperCase(),primaryRole=String(b.primaryRole||""),secondary=Array.isArray(b.secondaryRoles)?[...new Set(b.secondaryRoles.map(String))]:[];
if(nickname.length<3||nickname.length>24||!/^[\p{L}\p{N}_ .-]+$/u.test(nickname))return json(res,400,{error:"Никнейм: 3–24 символа, буквы, цифры, пробел, точка, дефис или _."});
if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(res,400,{error:"Проверьте адрес email."});
const passwordIssue=passwordError(password);if(passwordIssue)return json(res,400,{error:passwordIssue});
if(!validCountry(country))return json(res,400,{error:"Выберите страну из списка."});
if(!roles.has(primaryRole)||secondary.length>2||secondary.some(x=>!roles.has(x)||x===primaryRole))return json(res,400,{error:"Проверьте выбранные игровые роли."});
if(b.acceptRules!==true)return json(res,400,{error:"Для регистрации нужно принять правила и политику конфиденциальности."});
const hash=await hashPassword(password),client=await pool.connect();try{await client.query("BEGIN");const exists=await client.query("SELECT 1 FROM users WHERE email=$1 OR lower(nickname)=lower($2)",[email,nickname]);if(exists.rowCount)return (await client.query("ROLLBACK"),json(res,409,{error:"Этот email или никнейм уже используется."}));await client.query("INSERT INTO users(nickname,email,password_hash,country,primary_role,secondary_roles) VALUES($1,$2,$3,$4,$5,$6)",[nickname,email,hash,country,primaryRole,secondary]);await createAuthLink("verify",email,nickname,client);await client.query("COMMIT");return json(res,201,{message:"Аккаунт сохранён. Проверьте почту и подтвердите email."});}catch(e){await client.query("ROLLBACK");if(e.code==="23505")return json(res,409,{error:"Этот email или никнейм уже используется."});throw e;}finally{client.release();}
}
if(req.method==="POST"&&url.pathname==="/api/auth/login"){
if(rateLimit(req,"login",12,900000))return json(res,429,{error:"Слишком много попыток входа. Попробуйте позже."});const b=await body(req),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");const found=await pool.query("SELECT id,password_hash,email_verified,account_status FROM users WHERE email=$1",[email]);if(!found.rowCount||!(await verifyPassword(password,found.rows[0].password_hash)))return json(res,401,{error:"Неверный email или пароль."});const user=found.rows[0];if(user.account_status!=="active")return json(res,401,{error:"Неверный email или пароль."});if(!user.email_verified)return json(res,403,{error:"Сначала подтвердите email по ссылке из письма."});const raw=token(),expires=new Date(Date.now()+30*86400000);await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",[tokenHash(raw),user.id,expires]);return json(res,200,{message:"Вы вошли."},{"Set-Cookie":cookie("cqrtv_session",raw,2592000)});
}
if(req.method==="POST"&&url.pathname==="/api/auth/verify"){
const b=await body(req),raw=String(b.token||"");if(raw.length<32)return json(res,400,{error:"Ссылка недействительна или устарела."});const client=await pool.connect();try{await client.query("BEGIN");const r=await client.query("DELETE FROM auth_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>now() RETURNING user_id",[tokenHash(raw)]);if(!r.rowCount){await client.query("ROLLBACK");return json(res,400,{error:"Ссылка недействительна или уже использована."});}await client.query("UPDATE users SET email_verified=true WHERE id=$1",[r.rows[0].user_id]);await client.query("COMMIT");return json(res,200,{message:"Email подтверждён. Теперь можно войти."});}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
if(req.method==="POST"&&url.pathname==="/api/auth/forgot"){
if(rateLimit(req,"forgot",5,3600000))return json(res,429,{error:"Слишком много запросов. Попробуйте позже."});const b=await body(req),email=String(b.email||"").trim().toLowerCase();if(emailer&&mailFrom&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){const client=await pool.connect();try{await client.query("BEGIN");const q=await client.query("SELECT nickname FROM users WHERE email=$1 AND email_verified=true AND account_status='active'",[email]);if(q.rowCount){await client.query("DELETE FROM auth_tokens WHERE user_id=(SELECT id FROM users WHERE email=$1) AND purpose='reset'",[email]);await createAuthLink("reset",email,q.rows[0].nickname,client);}await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}return json(res,200,{message:"Если подтверждённый аккаунт с таким email существует, мы отправили письмо."});
}
if(req.method==="POST"&&url.pathname==="/api/auth/reset"){
const b=await body(req),raw=String(b.token||""),password=String(b.password||"");const passwordIssue=passwordError(password);if(passwordIssue)return json(res,400,{error:passwordIssue});const hash=await hashPassword(password),client=await pool.connect();try{await client.query("BEGIN");const q=await client.query("DELETE FROM auth_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>now() RETURNING user_id",[tokenHash(raw)]);if(!q.rowCount){await client.query("ROLLBACK");return json(res,400,{error:"Ссылка недействительна или устарела."});}await client.query("UPDATE users SET password_hash=$1 WHERE id=$2",[hash,q.rows[0].user_id]);await client.query("DELETE FROM sessions WHERE user_id=$1",[q.rows[0].user_id]);await client.query("DELETE FROM admin_sessions WHERE user_id=$1",[q.rows[0].user_id]);await client.query("DELETE FROM auth_tokens WHERE user_id=$1",[q.rows[0].user_id]);await client.query("COMMIT");return json(res,200,{message:"Пароль изменён. Теперь войдите с новым паролем."});}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
if(req.method==="POST"&&url.pathname==="/api/auth/logout"){const raw=sessionToken(req);if(raw)await pool.query("DELETE FROM sessions WHERE token_hash=$1",[tokenHash(raw)]);return json(res,200,{message:"Вы вышли."},{"Set-Cookie":cookie("cqrtv_session","",0)});}
if(req.method==="GET"&&url.pathname==="/api/auth/me"){const raw=sessionToken(req);if(!raw)return json(res,200,{user:null});const q=await pool.query("SELECT u.nickname,u.country,u.primary_role,u.secondary_roles,u.nickname_changed_at,u.nickname_changed_at + interval '3 months' AS nickname_available_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.email_verified=true AND u.account_status='active'",[tokenHash(raw)]);return json(res,200,{user:q.rows[0]||null});}
return json(res,404,{error:"Not found"});
}catch(e){console.error("API request failed:",e.message);return json(res,e.status||500,{error:e.status===400?"Некорректный запрос.":e.status===413?"Слишком большой запрос.":"Не удалось выполнить запрос. Попробуйте позже."});}}
const dummyPasswordHash = "scrypt$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
const adminRoutes = createAdminRoutes({ pool, json, body, tokenHash, cookie, sessionToken, verifyPassword, dummyPasswordHash, rateLimit, origin });
export function createHttpServer(){return http.createServer((req,res)=>{handle(req,res);});}
if(process.env.NODE_ENV !== "test") {
 await init();
 setInterval(()=>pool.query("DELETE FROM auth_tokens WHERE expires_at<now(); DELETE FROM sessions WHERE expires_at<now(); DELETE FROM admin_sessions WHERE expires_at<now()").catch(e=>console.error("Cleanup failed:",e.message)),6*60*60*1000).unref();
 createHttpServer().listen(3000,"0.0.0.0",()=>console.log("CQRTV auth API listening on port 3000"));
}

