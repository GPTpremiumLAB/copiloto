import { fetchJson, minutes } from "./http.js";

const maneuverNames = {
  turn: "Vire", merge: "Entre", fork: "Mantenha-se", "on ramp": "Pegue o acesso",
  "off ramp": "Pegue a saída", roundabout: "Entre na rotatória", rotary: "Entre na rotatória",
  arrive: "Você chegou ao destino", depart: "Siga"
};

function instructionFor(step) {
  const maneuver = step.maneuver ?? {};
  const action = maneuverNames[maneuver.type] ?? "Continue";
  const side = maneuver.modifier === "left" || maneuver.modifier === "slight left" || maneuver.modifier === "sharp left"
    ? " à esquerda" : maneuver.modifier === "right" || maneuver.modifier === "slight right" || maneuver.modifier === "sharp right" ? " à direita" : "";
  const road = step.name ? ` na ${step.name}` : "";
  return `${action}${side}${road}`;
}

export async function fetchOsrmRoutes(request, config, fetchImpl = fetch) {
  const coordinates = `${request.origin.lng},${request.origin.lat};${request.destination.lng},${request.destination.lat}`;
  const query = new URLSearchParams({ alternatives: "2", steps: "true", geometries: "geojson", overview: "full", annotations: "duration,distance,speed" });
  const data = await fetchJson(`${config.osrmBaseUrl}/route/v1/driving/${coordinates}?${query}`, {}, config.timeoutMs, fetchImpl);
  if (data.code !== "Ok") throw new Error(data.message ?? "Não foi possível traçar pelas ruas");
  return {
    provider: "osrm",
    attribution: "OSRM · OpenStreetMap",
    routes: (data.routes ?? []).map((route, index) => {
      const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
      return {
        id: `osrm-${index}`,
        durationMinutes: minutes(route.duration),
        distanceMeters: route.distance,
        confidence: 0.9,
        incidents: [],
        hasTolls: false,
        complexity: steps.length,
        allowedVehicles: [request.vehicle],
        geometry: { format: "geo-points", points: (route.geometry?.coordinates ?? []).map(([longitude, latitude]) => ({ latitude, longitude })) },
        instructions: steps.map((step, stepIndex) => ({
          id: `${index}-${stepIndex}`,
          text: instructionFor(step),
          distanceMeters: step.distance,
          durationSeconds: step.duration,
          location: { lat: step.maneuver?.location?.[1], lng: step.maneuver?.location?.[0] },
          type: step.maneuver?.type,
          modifier: step.maneuver?.modifier,
          road: step.name || null
        })).filter((step) => Number.isFinite(step.location.lat) && Number.isFinite(step.location.lng))
      };
    })
  };
}
