import crypto from "crypto";

const COOKIE_NAME = "cb_admin_session";
const SESSION_HOURS = 12;

function parseCookies(cookieHeader){
  const out = {};
  if(!cookieHeader) return out;
  for(const part of cookieHeader.split(";")){
    const [k, ...v] = part.trim().split("=");
    if(!k) continue;
    out[k] = decodeURIComponent(v.join("=") || "");
  }
  return out;
}

function safeEqual(a, b){
  try{
    const ba = Buffer.from(String(a != null ? a : ""));
    const bb = Buffer.from(String(b != null ? b : ""));
    if(ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  }catch{
    return false;
  }
}

function base64urlJson(obj){
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function decodeBase64urlJson(str){
  return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
}

function sign(bodyB64, secret){
  return crypto.createHmac("sha256", secret).update(bodyB64).digest("base64url");
}

export function createSessionToken(secret){
  const now = Date.now();
  const payload = {
    iat: now,
    exp: now + SESSION_HOURS * 60 * 60 * 1000,
  };
  const body = base64urlJson(payload);
  const sig = sign(body, secret);
  return `${body}.${sig}`;
}

export function verifySessionToken(token, secret){
  if(!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if(!body || !sig) return null;
  const expected = sign(body, secret);
  if(!safeEqual(sig, expected)) return null;

  let payload;
  try{
    payload = decodeBase64urlJson(body);
  }catch{
    return null;
  }

  if(payload && payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

export function verifyPassword(inputPassword){
  const secret = process.env.ADMIN_PASSWORD;
  if(!secret) return false;
  return safeEqual(String(inputPassword || ""), String(secret));
}

export function getAdminSession(request){
  const secret = process.env.ADMIN_PASSWORD;
  if(!secret){
    return { ok: false, status: 500, error: "Missing ADMIN_PASSWORD env var" };
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[COOKIE_NAME];
  const payload = verifySessionToken(token, secret);
  if(!payload){
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true, payload };
}

function isHttps(request){
  try{
    const url = new URL(request.url);
    if(url.protocol === "https:") return true;
  }catch{}
  const proto = request.headers.get("x-forwarded-proto");
  return proto === "https";
}

export function makeAdminSetCookie(token, request){
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_HOURS * 60 * 60}`,
  ];
  if(isHttps(request)) attrs.push("Secure");
  return attrs.join("; ");
}

export function makeAdminClearCookie(request){
  const attrs = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if(isHttps(request)) attrs.push("Secure");
  return attrs.join("; ");
}
