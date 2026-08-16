const VEHICLES = new Set(["car", "motorcycle"]);

export function validateTripRequest(request) {
  if (!request?.origin || !request?.destination) {
    throw new Error("origin and destination are required");
  }
  if (!VEHICLES.has(request.vehicle)) {
    throw new Error("vehicle must be car or motorcycle");
  }
  for (const point of [request.origin, request.destination]) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      throw new Error("origin and destination must contain valid lat/lng coordinates");
    }
  }
}

export function scoreRoute(route, preferences = {}) {
  const weights = {
    duration: preferences.durationWeight ?? 1,
    reliability: preferences.reliabilityWeight ?? 30,
    incidents: preferences.incidentWeight ?? 10,
    toll: preferences.avoidTolls ? 30 : 2,
    complexity: preferences.simpleRoute ? 2 : 0.5
  };

  return (
    route.durationMinutes * weights.duration +
    (1 - route.confidence) * weights.reliability +
    route.incidents.length * weights.incidents +
    (route.hasTolls ? weights.toll : 0) +
    route.complexity * weights.complexity
  );
}

export function recommendRoute(providerResults, request) {
  validateTripRequest(request);

  const candidates = providerResults
    .flatMap((result) => result.routes.map((route) => ({ ...route, provider: result.provider })))
    .filter((route) => route.allowedVehicles.includes(request.vehicle))
    .map((route) => ({ ...route, score: scoreRoute(route, request.preferences) }))
    .sort((a, b) => a.score - b.score);

  if (!candidates.length) throw new Error("no safe route is available for this vehicle");

  const best = candidates[0];
  const fastest = [...candidates].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  const reason = best.id === fastest.id
    ? `Menor tempo estimado (${best.durationMinutes} min) com confiança de ${Math.round(best.confidence * 100)}%.`
    : `Melhor equilíbrio entre tempo, confiabilidade, incidentes e preferências; ${best.durationMinutes - fastest.durationMinutes} min além da rota mais rápida.`;

  return { recommended: best, reason, alternatives: candidates.slice(1, 4) };
}
