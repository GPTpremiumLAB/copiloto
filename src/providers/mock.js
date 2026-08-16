export async function fetchMockRoutes() {
  return [
    {
      provider: "provider-a",
      routes: [
        { id: "a-fast", durationMinutes: 31, confidence: 0.72, incidents: ["congestion"], hasTolls: true, complexity: 4, speedLimitKmh: 60, allowedVehicles: ["car", "motorcycle"] },
        { id: "a-steady", durationMinutes: 35, confidence: 0.94, incidents: [], hasTolls: false, complexity: 2, speedLimitKmh: 50, allowedVehicles: ["car", "motorcycle"] }
      ]
    },
    {
      provider: "provider-b",
      routes: [
        { id: "b-balanced", durationMinutes: 33, confidence: 0.88, incidents: [], hasTolls: false, complexity: 3, speedLimitKmh: 50, allowedVehicles: ["car"] }
      ]
    }
  ];
}
