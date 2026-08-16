import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { recommendRoute } from "./recommender.js";
import { getProviderConfig, loadLocalEnv } from "./config.js";
import { fetchProviderRoutes } from "./providers/index.js";
import { discoverPlaces, suggestNearbyPlaces, suggestPlaces } from "./providers/search.js";
import { fetchWazeWarnings } from "./providers/waze.js";
import { fetchTrafficSignals } from "./providers/signals.js";

loadLocalEnv();
const port = Number(process.env.PORT ?? 3000);
const config = getProviderConfig();
const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const envFile = path.resolve(publicDirectory, "../.env");
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/premium.css", ["premium.css", "text/css; charset=utf-8"]],
  ["/voice-setup.html", ["voice-setup.html", "text/html; charset=utf-8"]],
  ["/grok-setup.html", ["grok-setup.html", "text/html; charset=utf-8"]],
  ["/testadores", ["testadores.html", "text/html; charset=utf-8"]],
  ["/assets/rota-inteligente-logo.png", ["assets/rota-inteligente-logo.png", "image/png"]]
]);
const sessions = new Map();
const loginAttempts = new Map();

function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").filter(Boolean).map((part) => {
    const [name, ...value] = part.trim().split("=");
    return [name, decodeURIComponent(value.join("="))];
  }));
}

function authenticated(req) {
  const session = sessions.get(cookies(req).route_session);
  if (!session || session.expiresAt < Date.now()) return false;
  return true;
}

function safeEqual(left = "", right = "") {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function testerAccounts() {
  try {
    const accounts = JSON.parse(process.env.TESTER_ACCOUNTS_JSON ?? "[]");
    return Array.isArray(accounts) ? accounts : [];
  } catch {
    return [];
  }
}

function authenticateCredentials(username = "", password = "") {
  if (safeEqual(username, process.env.AUTH_USERNAME) && safeEqual(password, process.env.AUTH_PASSWORD)) {
    return { username, role: "admin" };
  }
  const passwordHash = createHash("sha256").update(password).digest("hex");
  const account = testerAccounts().find((candidate) =>
    safeEqual(username, candidate.username) &&
    safeEqual(passwordHash, candidate.passwordHash) &&
    (!candidate.expiresAt || Date.parse(candidate.expiresAt) > Date.now())
  );
  return account ? { username: account.username, role: "tester" } : null;
}

function sendJson(res, statusCode, value) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function escapeXml(value) {
  return String(value).replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;"
  })[character]);
}

async function synthesizeAzureSpeech(text) {
  if (!config.azureSpeechKey || !config.azureSpeechRegion) throw new Error("azure speech is not configured");
  const endpoint = `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const voice = config.azureSpeechVoice;
  const ssml = `<speak version="1.0" xml:lang="pt-BR"><voice name="${escapeXml(voice)}"><prosody rate="-4%">${escapeXml(text)}</prosody></voice></speak>`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.azureSpeechKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "RotaInteligente"
    },
    body: ssml,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`azure speech unavailable (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 50_000) throw new Error("request is too large");
  }
  return JSON.parse(body);
}

async function saveAzureSpeechConfig(key, region) {
  let contents = "";
  try {
    contents = await readFile(envFile, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const values = { AZURE_SPEECH_KEY: key, AZURE_SPEECH_REGION: region, AZURE_SPEECH_VOICE: "pt-BR-FranciscaNeural" };
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}${contents.trim() ? "\n" : ""}${line}\n`;
  }
  await writeFile(envFile, contents, { encoding: "utf8", mode: 0o600 });
  Object.assign(config, { azureSpeechKey: key, azureSpeechRegion: region, azureSpeechVoice: values.AZURE_SPEECH_VOICE });
}

async function saveGrokConfig(key, model) {
  let contents = "";
  try { contents = await readFile(envFile, "utf8"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const values = { XAI_API_KEY: key, XAI_MODEL: model };
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}${contents.trim() ? "\n" : ""}${line}\n`;
  }
  await writeFile(envFile, contents, { encoding: "utf8", mode: 0o600 });
  Object.assign(config, { grokApiKey: key, grokModel: model });
}

async function askGrok(messages, context = {}, conversationId = "") {
  if (!config.grokApiKey) throw new Error("Grok ainda não está configurado");
  const system = "Você é o Copiloto, assistente brasileiro de viagens de carro e moto. Responda em português do Brasil, de forma natural, útil e breve para ser ouvida durante uma viagem. Pode usar humor leve ocasionalmente. Nunca invente trânsito, acidentes, limites, estabelecimentos ou localização em tempo real. Use somente o contexto fornecido para dados atuais. Não incentive interação manual enquanto o veículo estiver em movimento. Para mudanças de destino, peça confirmação clara antes de afirmar que a rota será alterada.";
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.grokApiKey}`,
      "content-type": "application/json",
      ...(conversationId ? { "x-grok-conv-id": conversationId } : {})
    },
    body: JSON.stringify({
      model: config.grokModel,
      messages: [
        { role: "system", content: system },
        { role: "system", content: `Contexto atual do aplicativo: ${JSON.stringify(context)}` },
        ...messages
      ],
      temperature: 0.6,
      max_tokens: 220
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? `Grok indisponível (${response.status})`);
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Grok não retornou uma resposta");
  return reply;
}

export const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (req.method === "POST" && pathname === "/local/setup/azure-speech") {
    const remoteAddress = req.socket.remoteAddress ?? "";
    const localRequest = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
    if (!localRequest || config.azureSpeechKey) {
      sendJson(res, 403, { error: "configuração local indisponível" });
      return;
    }
    try {
      const request = await readJson(req);
      const key = typeof request.key === "string" ? request.key.trim() : "";
      const region = typeof request.region === "string" ? request.region.trim().toLowerCase() : "";
      if (key.length < 20 || !/^[a-z0-9-]+$/.test(region)) throw new Error("configuração de voz inválida");
      await saveAzureSpeechConfig(key, region);
      sendJson(res, 200, { configured: true, provider: "Azure Speech", tier: "Free F0" });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/local/setup/grok") {
    const remoteAddress = req.socket.remoteAddress ?? "";
    const localRequest = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
    if (!localRequest || config.grokApiKey) { sendJson(res, 403, { error: "configuração local indisponível" }); return; }
    try {
      const request = await readJson(req);
      const key = typeof request.key === "string" ? request.key.trim() : "";
      const model = typeof request.model === "string" ? request.model.trim() : "grok-4.5";
      if (key.length < 20 || !/^grok-[a-z0-9.-]+$/i.test(model)) throw new Error("configuração do Grok inválida");
      await saveGrokConfig(key, model);
      sendJson(res, 200, { configured: true, provider: "xAI", model });
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  if (req.method === "GET" && staticFiles.has(pathname)) {
    const [filename, contentType] = staticFiles.get(pathname);
    try {
      res.setHeader("content-type", contentType);
      res.setHeader("cache-control", "no-cache");
      res.end(await readFile(path.join(publicDirectory, filename)));
    } catch {
      sendJson(res, 500, { error: "interface unavailable" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/auth/session") {
    sendJson(res, 200, { authenticated: authenticated(req) });
    return;
  }

  if (req.method === "POST" && pathname === "/auth/login") {
    try {
      const client = req.socket.remoteAddress ?? "local";
      const attempt = loginAttempts.get(client) ?? { count: 0, blockedUntil: 0 };
      if (attempt.blockedUntil > Date.now()) {
        sendJson(res, 429, { error: "Muitas tentativas. Aguarde um minuto." });
        return;
      }
      const credentials = await readJson(req);
      const identity = authenticateCredentials(credentials.username, credentials.password);
      if (!identity) {
        attempt.count += 1;
        if (attempt.count >= 5) Object.assign(attempt, { count: 0, blockedUntil: Date.now() + 60_000 });
        loginAttempts.set(client, attempt);
        sendJson(res, 401, { error: "Usuário ou senha inválidos." });
        return;
      }
      loginAttempts.delete(client);
      const token = randomBytes(32).toString("base64url");
      const maxAge = Math.max(1, Number(process.env.SESSION_HOURS ?? 12)) * 3600;
      sessions.set(token, { ...identity, expiresAt: Date.now() + maxAge * 1000 });
      res.setHeader("set-cookie", `route_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
      sendJson(res, 200, { authenticated: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/auth/logout") {
    sessions.delete(cookies(req).route_session);
    res.setHeader("set-cookie", "route_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if ((pathname.startsWith("/v1/") || pathname === "/health") && !authenticated(req)) {
    sendJson(res, 401, { error: "authentication required" });
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      mode: config.mode,
      configuredProviders: [config.googleMapsApiKey && "google", config.wazeDataFeedUrl && "waze-alerts", config.salvadorSignalFeedUrl && "semaforos-salvador", config.feiraSignalFeedUrl && "semaforos-feira", config.hereApiKey && "here", config.tomtomApiKey && "tomtom", config.valhallaBaseUrl && "valhalla", config.azureSpeechKey && "azure-speech"].filter(Boolean)
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/admin/voice") {
    sendJson(res, 200, { configured: Boolean(config.azureSpeechKey && config.azureSpeechRegion), provider: "Azure Speech", tier: "Free F0" });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/admin/voice") {
    try {
      const request = await readJson(req);
      const key = typeof request.key === "string" ? request.key.trim() : "";
      const region = typeof request.region === "string" ? request.region.trim().toLowerCase() : "";
      if (key.length < 20 || !/^[a-z0-9-]+$/.test(region)) {
        sendJson(res, 400, { error: "configuração de voz inválida" });
        return;
      }
      await saveAzureSpeechConfig(key, region);
      sendJson(res, 200, { configured: true, provider: "Azure Speech", tier: "Free F0" });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/voice/speak") {
    try {
      const { text } = await readJson(req);
      if (typeof text !== "string" || !text.trim() || text.length > 1000) {
        sendJson(res, 400, { error: "texto de voz inválido" });
        return;
      }
      const audio = await synthesizeAzureSpeech(text.trim());
      res.statusCode = 200;
      res.setHeader("content-type", "audio/mpeg");
      res.setHeader("cache-control", "no-store");
      res.end(audio);
    } catch (error) {
      sendJson(res, 503, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/assistant/chat") {
    try {
      const request = await readJson(req);
      const messages = Array.isArray(request.messages) ? request.messages.slice(-10).map((message) => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: String(message?.content ?? "").slice(0, 1500)
      })).filter((message) => message.content.trim()) : [];
      if (!messages.length) throw new Error("mensagem obrigatória");
      const context = request.context && typeof request.context === "object" ? request.context : {};
      const conversationId = typeof request.conversationId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(request.conversationId) ? request.conversationId : "";
      sendJson(res, 200, { reply: await askGrok(messages, context, conversationId), provider: "xAI", model: config.grokModel });
    } catch (error) { sendJson(res, 503, { error: error.message }); }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/places/suggest") {
    const query = new URL(req.url, "http://localhost").searchParams.get("q")?.trim();
    if (!query || query.length < 2) {
      sendJson(res, 200, { suggestions: [] });
      return;
    }
    try {
      sendJson(res, 200, { suggestions: await suggestPlaces(query, config) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/places/nearby") {
    const url = new URL(req.url, "http://localhost");
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      sendJson(res, 400, { error: "valid lat and lng are required" });
      return;
    }
    sendJson(res, 200, { places: suggestNearbyPlaces(lat, lng) });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/places/discover") {
    const url = new URL(req.url, "http://localhost");
    const query = url.searchParams.get("q")?.trim();
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (!query || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      sendJson(res, 400, { error: "consulta e localização são obrigatórias" });
      return;
    }
    try {
      sendJson(res, 200, { places: await discoverPlaces(query, lat, lng, config) });
    } catch (error) {
      sendJson(res, 502, { error: error.message, places: [] });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/signals") {
    const url = new URL(req.url, "http://localhost");
    const values = ["minLat", "maxLat", "minLng", "maxLng"].map((key) => Number(url.searchParams.get(key)));
    const bounds = values.every(Number.isFinite) ? { minLat: values[0], maxLat: values[1], minLng: values[2], maxLng: values[3] } : null;
    try {
      sendJson(res, 200, await fetchTrafficSignals(config, bounds));
    } catch (error) {
      sendJson(res, 502, { status: "error", signals: [], error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/recommendations") {
    try {
      const request = await readJson(req);
      const [{ results, providers }, waze] = await Promise.all([
        fetchProviderRoutes(request, config),
        fetchWazeWarnings(config, request).catch((error) => ({ status: "error", warnings: [], message: error.message }))
      ]);
      sendJson(res, 200, { ...recommendRoute(results, request), providers, waze, generatedAt: new Date().toISOString() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

if (process.env.NODE_ENV !== "test") {
  server.listen(port, () => console.log(`Assistente disponível em http://localhost:${port}`));
}
