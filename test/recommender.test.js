import test from "node:test";
import assert from "node:assert/strict";
import { recommendRoute } from "../src/recommender.js";
import { fetchMockRoutes } from "../src/providers/mock.js";

test("prefers a reliable toll-free route over a fragile faster route", async () => {
  const result = recommendRoute(await fetchMockRoutes(), {
    origin: { lat: -12.97, lng: -38.51 },
    destination: { lat: -12.9, lng: -38.4 },
    vehicle: "car",
    preferences: { avoidTolls: true }
  });
  assert.equal(result.recommended.id, "a-steady");
});

test("removes routes that do not allow motorcycles", async () => {
  const result = recommendRoute(await fetchMockRoutes(), {
    origin: { lat: -12.97, lng: -38.51 },
    destination: { lat: -12.9, lng: -38.4 },
    vehicle: "motorcycle"
  });
  assert.equal(result.alternatives.some((route) => route.id === "b-balanced"), false);
});
