import { fetchJson } from "./http.js";

const BAHIA_BOUNDS = { minLat: -18.35, maxLat: -8.53, minLng: -46.65, maxLng: -37.32 };
const DEMO_PLACES = [
  ["Base Naval de Aratu", "Estrada da Base Naval, s/n, São Tomé de Paripe, Salvador - BA, 40800-310", -12.8007, -38.4931, ["base naval", "base naval de salvador", "bna", "base de aratu", "naval de aratu"]],
  ["Pelourinho", "Pelourinho, Salvador - BA", -12.9711, -38.5108],
  ["Farol da Barra", "Farol da Barra, Salvador - BA", -13.0101, -38.5328],
  ["Shopping da Bahia", "Shopping da Bahia, Caminho das Árvores, Salvador - BA", -12.9811, -38.4658],
  ["Aeroporto de Salvador", "Aeroporto Internacional de Salvador, Salvador - BA", -12.9086, -38.3225],
  ["Rodoviária", "Terminal Rodoviário de Salvador, Salvador - BA", -12.9824, -38.4653],
  ["Rio Vermelho", "Rio Vermelho, Salvador - BA", -13.0114, -38.4906],
  ["Itapuã", "Itapuã, Salvador - BA", -12.9460, -38.3633],
  ["Lauro de Freitas", "Centro, Lauro de Freitas - BA", -12.8944, -38.3213],
  ["Feira de Santana", "Centro, Feira de Santana - BA", -12.2579, -38.9598],
  ["Porto Seguro", "Centro, Porto Seguro - BA", -16.4444, -39.0653],
  ["Vitória da Conquista", "Centro, Vitória da Conquista - BA", -14.8619, -40.8442],
  ["Ilhéus", "Centro, Ilhéus - BA", -14.7930, -39.0460]
].map(([name, label, lat, lng, aliases = []]) => ({ id: `demo-${name}`, name, label, lat, lng, aliases, provider: "local" }));

const INFORMAL_ALIASES = new Map(Object.entries({
  "base naval de salvador": "Base Naval de Aratu, São Tomé de Paripe, Salvador, Bahia",
  "base naval": "Base Naval de Aratu, São Tomé de Paripe, Salvador, Bahia",
  "bna": "Base Naval de Aratu, São Tomé de Paripe, Salvador, Bahia",
  "comercio": "Comércio, Salvador, Bahia",
  "cidade baixa": "Cidade Baixa, Salvador, Bahia",
  "suburbio": "Subúrbio Ferroviário, Salvador, Bahia",
  "suburbio ferroviario": "Subúrbio Ferroviário, Salvador, Bahia",
  "miolo": "Miolo de Salvador, Bahia",
  "paripe": "Paripe, Salvador, Bahia",
  "sao tome": "São Tomé de Paripe, Salvador, Bahia",
  "cajazeiras": "Cajazeiras, Salvador, Bahia",
  "imbui": "Imbuí, Salvador, Bahia",
  "itaigara": "Itaigara, Salvador, Bahia",
  "sete portas": "Sete Portas, Salvador, Bahia",
  "dois leoes": "Dois Leões, Salvador, Bahia",
  "baixinha de santo antonio": "Baixinha de Santo Antônio, Salvador, Bahia",
  "feiraguai": "Feiraguai, Centro, Feira de Santana, Bahia",
  "feira x": "Feira X, Feira de Santana, Bahia",
  "feira 10": "Feira X, Feira de Santana, Bahia",
  "feira vii": "Feira VII, Feira de Santana, Bahia",
  "feira 7": "Feira VII, Feira de Santana, Bahia",
  "feira vi": "Feira VI, Feira de Santana, Bahia",
  "feira 6": "Feira VI, Feira de Santana, Bahia",
  "feira v": "Feira V, Feira de Santana, Bahia",
  "feira 5": "Feira V, Feira de Santana, Bahia",
  "feira iv": "Feira IV, Feira de Santana, Bahia",
  "feira 4": "Feira IV, Feira de Santana, Bahia",
  "35 bi": "35º Batalhão de Infantaria, Feira de Santana, Bahia",
  "campo do gado": "Campo do Gado Novo, Feira de Santana, Bahia",
  "sao jose": "Maria Quitéria, Feira de Santana, Bahia",
  "distrito de sao jose": "Maria Quitéria, Feira de Santana, Bahia",
  "sim": "SIM, Feira de Santana, Bahia",
  "tomba": "Tomba, Feira de Santana, Bahia",
  "cidade nova": "Cidade Nova, Feira de Santana, Bahia"
}));

const onlineCache = new Map();
let lastNominatimRequest = 0;

function fold(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function distanceKm(a, b) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function insideBahia(place) {
  return place.lat >= BAHIA_BOUNDS.minLat && place.lat <= BAHIA_BOUNDS.maxLat && place.lng >= BAHIA_BOUNDS.minLng && place.lng <= BAHIA_BOUNDS.maxLng;
}

function localSuggestions(query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  return DEMO_PLACES.filter((place) => terms.every((term) => fold(`${place.name} ${place.label} ${(place.aliases ?? []).join(" ")}`).includes(term))).slice(0, 12);
}

async function searchNominatim(query, config) {
  const canonical = INFORMAL_ALIASES.get(fold(query)) ?? `${query}, Bahia, Brasil`;
  const cacheKey = fold(canonical);
  if (onlineCache.has(cacheKey)) return onlineCache.get(cacheKey);
  const wait = Math.max(0, 1050 - (Date.now() - lastNominatimRequest));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const params = new URLSearchParams({
    q: canonical,
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    countrycodes: "br",
    viewbox: "-46.65,-8.53,-37.32,-18.35",
    bounded: "1",
    dedupe: "0",
    limit: "40",
    "accept-language": "pt-BR"
  });
  lastNominatimRequest = Date.now();
  const data = await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "user-agent": "RotaInteligenteBahia/0.1 (local-development)" }
  }, Math.max(config.timeoutMs, 12000));
  const results = data.map((item) => ({
    id: `osm-${item.osm_type}-${item.osm_id}`,
    name: item.namedetails?.name ?? item.name ?? item.display_name.split(",")[0],
    label: item.display_name,
    lat: Number(item.lat),
    lng: Number(item.lon),
    provider: "OpenStreetMap online"
  })).filter(insideBahia);
  onlineCache.set(cacheKey, results);
  if (onlineCache.size > 250) onlineCache.delete(onlineCache.keys().next().value);
  return results;
}

const CATEGORY_TERMS = {
  restaurante: "restaurant", restaurantes: "restaurant", comida: "restaurant", comer: "restaurant",
  lanchonete: "fast_food", lanchonetes: "fast_food", pizzaria: "restaurant", bar: "bar", bares: "bar",
  café: "cafe", cafe: "cafe", padaria: "bakery", sorveteria: "ice_cream",
  posto: "fuel", gasolina: "fuel", combustível: "fuel", combustivel: "fuel",
  hospital: "hospital", hospitais: "hospital", farmácia: "pharmacy", farmacia: "pharmacy",
  hotel: "hotel", hotéis: "hotel", hoteis: "hotel", mercado: "supermarket", supermercado: "supermarket",
  oficina: "car_repair", mecânico: "car_repair", mecanico: "car_repair", estacionamento: "parking",
  shopping: "mall", praia: "beach", praias: "beach", ponto_turístico: "attraction", turismo: "attraction"
};

export async function discoverPlaces(query, lat, lng, config) {
  const folded = fold(query);
  const matched = Object.entries(CATEGORY_TERMS).find(([term]) => folded.includes(term));
  const searchTerm = matched?.[1] ?? query;
  const delta = 0.18;
  const params = new URLSearchParams({
    q: searchTerm,
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    countrycodes: "br",
    viewbox: `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`,
    bounded: "1",
    dedupe: "1",
    limit: "20",
    "accept-language": "pt-BR"
  });
  const data = await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "user-agent": "RotaInteligenteBahia/0.1 (local-development)" }
  }, Math.max(config.timeoutMs, 12000));
  return data.map((item) => ({
    id: `osm-${item.osm_type}-${item.osm_id}`,
    name: item.namedetails?.name ?? item.name ?? item.display_name.split(",")[0],
    label: item.display_name,
    lat: Number(item.lat),
    lng: Number(item.lon),
    provider: "OpenStreetMap online",
    distanceKm: distanceKm({ lat, lng }, { lat: Number(item.lat), lng: Number(item.lon) })
  })).filter(insideBahia).sort((a, b) => a.distanceKm - b.distanceKm);
}

async function searchHere(query, config) {
  const params = new URLSearchParams({ q: query, at: "-12.9714,-38.5014", limit: "8", lang: "pt-BR", apiKey: config.hereApiKey });
  const data = await fetchJson(`https://autosuggest.search.hereapi.com/v1/autosuggest?${params}`, {}, config.timeoutMs);
  return (data.items ?? []).filter((item) => item.position).map((item) => ({
    id: item.id,
    name: item.title,
    label: item.address?.label ?? item.title,
    lat: item.position.lat,
    lng: item.position.lng,
    provider: "here"
  })).filter(insideBahia);
}

async function searchTomTom(query, config) {
  const params = new URLSearchParams({ key: config.tomtomApiKey, typeahead: "true", limit: "8", countrySet: "BR", lat: "-12.9714", lon: "-38.5014", language: "pt-BR" });
  const data = await fetchJson(`https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?${params}`, {}, config.timeoutMs);
  return (data.results ?? []).map((item) => ({
    id: item.id,
    name: item.poi?.name ?? item.address?.freeformAddress ?? query,
    label: [item.address?.freeformAddress, item.address?.municipality, item.address?.countrySubdivision].filter(Boolean).join(", "),
    lat: item.position.lat,
    lng: item.position.lon,
    provider: "tomtom"
  })).filter(insideBahia);
}

export async function suggestPlaces(query, config) {
  const jobs = [
    config.hereApiKey && (() => searchHere(query, config)),
    config.tomtomApiKey && (() => searchTomTom(query, config)),
    () => searchNominatim(query, config)
  ].filter(Boolean);
  const settled = await Promise.allSettled(jobs.map((job) => job()));
  const remote = settled.filter((item) => item.status === "fulfilled").flatMap((item) => item.value);
  const unique = new Map([...localSuggestions(query), ...remote].map((place) => [`${place.lat.toFixed(4)},${place.lng.toFixed(4)}`, place]));
  return [...unique.values()].slice(0, 40);
}

export function suggestNearbyPlaces(lat, lng, limit = 4) {
  return DEMO_PLACES
    .map((place) => ({ ...place, distanceKm: distanceKm({ lat, lng }, place) }))
    .filter((place) => place.distanceKm <= 40)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
