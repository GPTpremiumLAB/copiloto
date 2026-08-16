import { fetchJson, minutes } from "./http.js";

export async function fetchValhallaRoutes(request, config, fetchImpl = fetch) {
  const body = {
    locations: [
      { lat: request.origin.lat, lon: request.origin.lng },
      { lat: request.destination.lat, lon: request.destination.lng }
    ],
    costing: request.vehicle === "motorcycle" ? "motorcycle" : "auto",
    alternatives: 2,
    directions_options: { units: "kilometers", language: "pt-BR" }
  };
  const data = await fetchJson(`${config.valhallaBaseUrl}/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }, config.timeoutMs, fetchImpl);
  const trips = [data.trip, ...(data.alternates ?? []).map((item) => item.trip)].filter(Boolean);

  return {
    provider: "valhalla",
    attribution: "© OpenStreetMap contributors",
    routes: trips.map((trip, index) => ({
      id: `valhalla-${index}`,
      durationMinutes: minutes(trip.summary?.time ?? 0),
      confidence: 0.72,
      incidents: [],
      hasTolls: false,
      complexity: trip.legs?.reduce((sum, leg) => sum + (leg.maneuvers?.length ?? 0), 0) ?? 0,
      allowedVehicles: [request.vehicle],
      geometry: { format: "encoded-polyline6", parts: trip.legs?.map((leg) => leg.shape).filter(Boolean) ?? [] }
    }))
  };
}
