export function getProviderConfig(env = process.env) {
  return {
    mode: env.ROUTE_PROVIDER_MODE ?? "auto",
    timeoutMs: Number(env.PROVIDER_TIMEOUT_MS ?? 8000),
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
    wazeDataFeedUrl: env.WAZE_DATA_FEED_URL,
    osrmBaseUrl: (env.OSRM_BASE_URL ?? "https://router.project-osrm.org").replace(/\/$/, ""),
    salvadorSignalFeedUrl: env.SALVADOR_SIGNAL_FEED_URL,
    feiraSignalFeedUrl: env.FEIRA_SIGNAL_FEED_URL,
    hereApiKey: env.HERE_API_KEY,
    tomtomApiKey: env.TOMTOM_API_KEY,
    valhallaBaseUrl: env.VALHALLA_BASE_URL?.replace(/\/$/, ""),
    azureSpeechKey: env.AZURE_SPEECH_KEY,
    azureSpeechRegion: env.AZURE_SPEECH_REGION,
    azureSpeechVoice: env.AZURE_SPEECH_VOICE ?? "pt-BR-FranciscaNeural",
    grokApiKey: env.XAI_API_KEY,
    grokModel: env.XAI_MODEL ?? "grok-4.5"
  };
}

export function loadLocalEnv() {
  if (typeof process.loadEnvFile !== "function") return;
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
