import test from "node:test";
import assert from "node:assert/strict";
import { fetchHereRoutes } from "../src/providers/here.js";
import { fetchTomTomRoutes } from "../src/providers/tomtom.js";
import { fetchGoogleRoutes } from "../src/providers/google.js";
import { fetchWazeWarnings } from "../src/providers/waze.js";

const request = {
  origin: { lat: -12.97, lng: -38.51 },
  destination: { lat: -12.9, lng: -38.4 },
  vehicle: "motorcycle",
  preferences: { avoidTolls: true }
};

test("normalizes HERE routes and requests scooter routing", async () => {
  let calledUrl;
  const fakeFetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ routes: [{ id: "1", sections: [{ summary: { duration: 600 }, actions: [{}, {}], polyline: "abc" }] }] }) };
  };
  const result = await fetchHereRoutes(request, { hereApiKey: "secret", timeoutMs: 100 }, fakeFetch);
  assert.match(calledUrl, /transportMode=scooter/);
  assert.doesNotMatch(calledUrl, /undefined/);
  assert.equal(result.routes[0].durationMinutes, 10);
});

test("normalizes TomTom traffic sections", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ routes: [{ summary: { travelTimeInSeconds: 900 }, sections: [{ sectionType: "TRAFFIC", simpleCategory: "JAM" }], guidance: { instructions: [{}, {}] }, legs: [{ points: [{ latitude: 1, longitude: 2 }] }] }] })
  });
  const result = await fetchTomTomRoutes(request, { tomtomApiKey: "secret", timeoutMs: 100 }, fakeFetch);
  assert.equal(result.routes[0].durationMinutes, 15);
  assert.deepEqual(result.routes[0].incidents, ["JAM"]);
});

test("normalizes a complete Google traffic-aware route", async () => {
  let options;
  const fakeFetch = async (_url, received) => {
    options = received;
    return { ok: true, json: async () => ({ routes: [{ duration: "720s", distanceMeters: 9000, polyline: { encodedPolyline: "abc" }, travelAdvisory: { speedReadingIntervals: [] } }] }) };
  };
  const result = await fetchGoogleRoutes(request, { googleMapsApiKey: "secret", timeoutMs: 100 }, fakeFetch);
  assert.equal(result.routes[0].durationMinutes, 12);
  assert.equal(result.routes[0].geometry.format, "encoded-polyline5");
  assert.match(options.headers["X-Goog-FieldMask"], /travelAdvisory/);
});

test("keeps only Waze warnings near the route area", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ alerts: [
    { uuid: "near", type: "ACCIDENT", location: { y: -12.95, x: -38.5 } },
    { uuid: "far", type: "ACCIDENT", location: { y: -10, x: -40 } }
  ] }) });
  const result = await fetchWazeWarnings({ wazeDataFeedUrl: "https://feed.example", timeoutMs: 100 }, request, fakeFetch);
  assert.deepEqual(result.warnings.map((item) => item.id), ["near"]);
});
