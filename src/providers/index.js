import { fetchMockRoutes } from "./mock.js";
import { fetchHereRoutes } from "./here.js";
import { fetchTomTomRoutes } from "./tomtom.js";
import { fetchValhallaRoutes } from "./valhalla.js";
import { fetchGoogleRoutes } from "./google.js";
import { fetchOsrmRoutes } from "./osrm.js";

export async function fetchProviderRoutes(request, config) {
  if (config.mode === "mock") {
    return { results: await fetchMockRoutes(request), providers: [{ provider: "mock", status: "ok" }] };
  }
  if (config.googleMapsApiKey) {
    return { results: [await fetchGoogleRoutes(request, config)], providers: [{ provider: "google", status: "ok" }] };
  }
  const enabled = [
    config.hereApiKey && ["here", () => fetchHereRoutes(request, config)],
    config.tomtomApiKey && ["tomtom", () => fetchTomTomRoutes(request, config)],
    config.valhallaBaseUrl && ["valhalla", () => fetchValhallaRoutes(request, config)]
  ].filter(Boolean);

  if (!enabled.length) {
    try {
      return { results: [await fetchOsrmRoutes(request, config)], providers: [{ provider: "osrm", status: "ok" }] };
    } catch (error) {
      if (config.mode === "live") throw error;
      return { results: await fetchMockRoutes(request), providers: [{ provider: "mock", status: "ok", error: error.message }] };
    }
  }

  const settled = await Promise.allSettled(enabled.map(([, execute]) => execute()));
  const providers = settled.map((result, index) => ({
    provider: enabled[index][0],
    status: result.status === "fulfilled" ? "ok" : "error",
    ...(result.status === "rejected" ? { error: result.reason?.message ?? "provider failed" } : {})
  }));
  const results = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!results.length) throw new Error(`all route providers failed: ${providers.map((item) => `${item.provider} (${item.error})`).join(", ")}`);
  return { results, providers };
}
