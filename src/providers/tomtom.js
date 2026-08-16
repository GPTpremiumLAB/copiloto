import { fetchJson, minutes } from "./http.js";

export async function fetchTomTomRoutes(request, config, fetchImpl = fetch) {
  const points = `${request.origin.lat},${request.origin.lng}:${request.destination.lat},${request.destination.lng}`;
  const query = new URLSearchParams({
    key: config.tomtomApiKey,
    traffic: "true",
    travelMode: request.vehicle,
    routeType: "fastest",
    maxAlternatives: "3",
    instructionsType: "text",
    sectionType: "traffic"
  });
  query.append("sectionType", "speedLimit");
  if (request.preferences?.avoidTolls) query.append("avoid", "tollRoads");
  const data = await fetchJson(`https://api.tomtom.com/routing/1/calculateRoute/${points}/json?${query}`, {}, config.timeoutMs, fetchImpl);

  return {
    provider: "tomtom",
    attribution: "TomTom",
    routes: (data.routes ?? []).map((route, index) => {
      const sections = route.sections ?? [];
      const traffic = sections.filter((section) => section.sectionType === "TRAFFIC");
      const speedLimits = sections.filter((section) => section.sectionType === "SPEED_LIMIT").map((section) => section.speedLimitInKmh ?? section.maxSpeedInKmh).filter(Number.isFinite);
      return {
        id: `tomtom-${index}`,
        durationMinutes: minutes(route.summary?.travelTimeInSeconds ?? 0),
        confidence: traffic.length ? 0.92 : 0.84,
        incidents: traffic.map((section) => section.simpleCategory ?? "traffic"),
        hasTolls: sections.some((section) => ["TOLL_ROAD", "TOLL"].includes(section.sectionType)),
        complexity: route.guidance?.instructions?.length ?? 0,
        speedLimitKmh: speedLimits[0],
        allowedVehicles: [request.vehicle],
        geometry: { format: "geo-points", points: route.legs?.flatMap((leg) => leg.points ?? []) ?? [] }
      };
    })
  };
}
