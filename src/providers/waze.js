import { fetchJson } from "./http.js";

function insideRouteArea(item, request) {
  const point = item.location ?? item.line?.[0];
  const lat = Number(point?.y ?? point?.lat ?? point?.latitude);
  const lng = Number(point?.x ?? point?.lon ?? point?.lng ?? point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !request?.origin || !request?.destination) return false;
  const margin = 0.12;
  const minLat = Math.min(request.origin.lat, request.destination.lat) - margin;
  const maxLat = Math.max(request.origin.lat, request.destination.lat) + margin;
  const minLng = Math.min(request.origin.lng, request.destination.lng) - margin;
  const maxLng = Math.max(request.origin.lng, request.destination.lng) + margin;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

export async function fetchWazeWarnings(config, request, fetchImpl = fetch) {
  if (!config.wazeDataFeedUrl) return { status: "unavailable", warnings: [], message: "Feed oficial do Waze não configurado" };
  const data = await fetchJson(config.wazeDataFeedUrl, {}, config.timeoutMs, fetchImpl);
  const alerts = (data.alerts ?? []).map((alert) => ({
    id: alert.uuid ?? alert.id,
    kind: alert.type ?? "ALERT",
    subtype: alert.subtype ?? null,
    street: alert.street ?? null,
    city: alert.city ?? null,
    location: alert.location ?? null,
    reportedAt: alert.pubMillis ? new Date(alert.pubMillis).toISOString() : null
  }));
  const jams = (data.jams ?? []).map((jam) => ({
    id: jam.uuid ?? jam.id,
    kind: "JAM",
    street: jam.street ?? null,
    city: jam.city ?? null,
    speedKmh: jam.speedKMH ?? null,
    delaySeconds: jam.delay ?? null,
    severity: jam.level ?? null,
    line: jam.line ?? []
  }));
  const warnings = [...alerts, ...jams].filter((item) => insideRouteArea(item, request));
  return { status: "ok", warnings, updatedAt: new Date().toISOString() };
}
