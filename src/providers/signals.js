import { fetchJson } from "./http.js";

const cityFeeds = (config) => [
  ["salvador", config.salvadorSignalFeedUrl],
  ["feira-de-santana", config.feiraSignalFeedUrl]
].filter(([, url]) => url);

function normalizeSignal(signal, city) {
  const location = signal.location ?? signal.position ?? signal.coordinates ?? {};
  const lat = Number(location.lat ?? location.latitude ?? (Array.isArray(location) ? location[1] : NaN));
  const lng = Number(location.lng ?? location.lon ?? location.longitude ?? (Array.isArray(location) ? location[0] : NaN));
  const remaining = Number(signal.remainingSeconds ?? signal.timeToChange ?? signal.secondsRemaining);
  return {
    id: String(signal.id ?? signal.intersectionId ?? `${city}-${lat}-${lng}`),
    city,
    name: signal.name ?? signal.intersectionName ?? signal.street ?? "Cruzamento sem identificação",
    lat,
    lng,
    state: String(signal.state ?? signal.color ?? signal.phase ?? "unknown").toLowerCase(),
    remainingSeconds: Number.isFinite(remaining) ? Math.max(0, Math.round(remaining)) : null,
    nextState: signal.nextState ?? signal.nextPhase ?? null,
    direction: signal.direction ?? signal.approach ?? null,
    adaptive: Boolean(signal.adaptive),
    updatedAt: signal.updatedAt ?? signal.timestamp ?? null
  };
}

function inBounds(signal, bounds) {
  if (!Number.isFinite(signal.lat) || !Number.isFinite(signal.lng)) return false;
  if (!bounds) return true;
  return signal.lat >= bounds.minLat && signal.lat <= bounds.maxLat && signal.lng >= bounds.minLng && signal.lng <= bounds.maxLng;
}

export async function fetchTrafficSignals(config, bounds, fetchImpl = fetch) {
  const feeds = cityFeeds(config);
  if (!feeds.length) return { status: "unavailable", signals: [], message: "Feeds oficiais de Salvador e Feira de Santana ainda não configurados" };
  const settled = await Promise.allSettled(feeds.map(async ([city, url]) => {
    const data = await fetchJson(url, {}, config.timeoutMs, fetchImpl);
    const records = data.signals ?? data.intersections ?? data.features ?? [];
    return records.map((record) => normalizeSignal(record.properties ? { ...record.properties, coordinates: record.geometry?.coordinates } : record, city)).filter((signal) => inBounds(signal, bounds));
  }));
  const signals = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return {
    status: signals.length ? "ok" : settled.every((result) => result.status === "rejected") ? "error" : "empty",
    signals,
    configuredCities: feeds.map(([city]) => city),
    updatedAt: new Date().toISOString()
  };
}
