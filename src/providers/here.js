import { fetchJson, minutes } from "./http.js";

export async function fetchHereRoutes(request, config, fetchImpl = fetch) {
  const query = new URLSearchParams({
    transportMode: request.vehicle === "motorcycle" ? "scooter" : "car",
    origin: `${request.origin.lat},${request.origin.lng}`,
    destination: `${request.destination.lat},${request.destination.lng}`,
    alternatives: "3",
    return: "summary,polyline,actions,instructions",
    departureTime: "now",
    apiKey: config.hereApiKey
  });
  if (request.preferences?.avoidTolls) query.set("avoid[features]", "tollRoad");
  const data = await fetchJson(`https://router.hereapi.com/v8/routes?${query}`, {}, config.timeoutMs, fetchImpl);

  return {
    provider: "here",
    attribution: "HERE",
    routes: (data.routes ?? []).map((route, index) => {
      const sections = route.sections ?? [];
      const duration = sections.reduce((sum, section) => sum + (section.summary?.duration ?? 0), 0);
      const actions = sections.flatMap((section) => section.actions ?? []);
      return {
        id: `here-${route.id ?? index}`,
        durationMinutes: minutes(duration),
        confidence: 0.9,
        incidents: [],
        hasTolls: sections.some((section) => (section.tolls?.length ?? 0) > 0),
        complexity: actions.length,
        allowedVehicles: [request.vehicle],
        geometry: { format: "flexible-polyline", parts: sections.map((section) => section.polyline).filter(Boolean) }
      };
    })
  };
}
