import { fetchJson, minutes } from "./http.js";

function seconds(value = "0s") {
  return Number.parseFloat(String(value).replace("s", "")) || 0;
}

export async function fetchGoogleRoutes(request, config, fetchImpl = fetch) {
  const body = {
    origin: { location: { latLng: { latitude: request.origin.lat, longitude: request.origin.lng } } },
    destination: { location: { latLng: { latitude: request.destination.lat, longitude: request.destination.lng } } },
    travelMode: request.vehicle === "motorcycle" ? "TWO_WHEELER" : "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    computeAlternativeRoutes: true,
    polylineQuality: "HIGH_QUALITY",
    polylineEncoding: "ENCODED_POLYLINE",
    routeModifiers: { avoidTolls: Boolean(request.preferences?.avoidTolls) },
    languageCode: "pt-BR",
    units: "METRIC"
  };
  const data = await fetchJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": config.googleMapsApiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory,routes.legs.steps.navigationInstruction,routes.routeLabels"
    },
    body: JSON.stringify(body)
  }, config.timeoutMs, fetchImpl);

  return {
    provider: "google",
    attribution: "Google Maps",
    routes: (data.routes ?? []).map((route, index) => ({
      id: `google-${index}`,
      durationMinutes: minutes(seconds(route.duration)),
      distanceMeters: route.distanceMeters,
      confidence: 0.96,
      incidents: [],
      trafficAdvisory: route.travelAdvisory ?? null,
      hasTolls: false,
      complexity: route.legs?.flatMap((leg) => leg.steps ?? []).length ?? 0,
      allowedVehicles: [request.vehicle],
      geometry: { format: "encoded-polyline5", parts: [route.polyline?.encodedPolyline].filter(Boolean) }
    }))
  };
}
