const form = document.querySelector("#routeForm");
const results = document.querySelector("#results");
const emptyState = document.querySelector("#emptyState");
const submit = form.querySelector("button[type=submit]");
const toast = document.querySelector("#toast");
const field = (id) => document.querySelector(`#${id}`);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let lastPayload;
let map;
let routeLayer;
const selectedPlaces = {
  origin: { name: "Pelourinho", label: "Pelourinho, Salvador - BA", lat: -12.9711, lng: -38.5108 },
  destination: { name: "Farol da Barra", label: "Farol da Barra, Salvador - BA", lat: -13.0101, lng: -38.5328 }
};
let savedPlaces = JSON.parse(localStorage.getItem("savedPlaces") ?? "[]");
let suggestionTimer;
let trackingWatchId;
let trafficTimer;
let lastPosition;
let activeRouteId;
let activeRoute;
let announcedInstructions = new Set();
let activeSignals = [];
let positionMarker;
let deviceHeading = 0;
let gpsHeading = null;
let directionUp = true;
let orientationListening = false;

async function initializeSession() {
  try {
    const session = await fetch("/auth/session").then((response) => response.json());
    if (session.authenticated) showApplication();
  } catch { /* servidor ainda iniciando */ }
}

function showApplication() {
  field("loginScreen").hidden = true;
  field("appShell").hidden = false;
  checkHealth();
}

field("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  field("loginError").textContent = "";
  const response = await fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: field("loginUsername").value, password: field("loginPassword").value })
  });
  const data = await response.json();
  if (!response.ok) {
    field("loginError").textContent = data.error ?? "Não foi possível entrar.";
    return;
  }
  field("loginPassword").value = "";
  showApplication();
});

field("logoutButton").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  stopTracking();
  field("appShell").hidden = true;
  field("loginScreen").hidden = false;
});

async function checkHealth() {
  try {
    const health = await fetch("/health").then((response) => response.json());
    document.querySelector(".system-status").classList.add("online");
    field("systemStatus").textContent = health.configuredProviders.length ? `${health.configuredProviders.length} fontes conectadas` : "Modo de demonstração";
  } catch {
    field("systemStatus").textContent = "Sistema indisponível";
  }
}

function stat(label, value) {
  return `<div class="stat"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div>`;
}

function selectPlace(kind, place) {
  selectedPlaces[kind] = place;
  field(`${kind}Address`).value = place.label;
  field(`${kind}Lat`).value = place.lat;
  field(`${kind}Lng`).value = place.lng;
  field(`${kind}Suggestions`).hidden = true;
}

async function findSuggestions(query) {
  const saved = savedPlaces.filter((place) => `${place.name} ${place.label}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))).map((place) => ({ ...place, provider: "salvo" }));
  const remote = await fetch(`/v1/places/suggest?q=${encodeURIComponent(query)}`).then((response) => response.json());
  return [...saved, ...(remote.suggestions ?? [])].slice(0, 40);
}

async function showSuggestions(kind, query) {
  const container = field(`${kind}Suggestions`);
  if (query.trim().length < 2) {
    container.hidden = true;
    return;
  }
  try {
    const places = await findSuggestions(query.trim());
    if (!places.length) {
      container.innerHTML = '<div class="suggestion"><strong>Nenhum local encontrado na Bahia</strong><small>Tente incluir o bairro ou a cidade.</small></div>';
    } else {
      container.innerHTML = places.map((place, index) => `<button class="suggestion" type="button" data-index="${index}"><em>${escapeHtml(place.provider)}</em><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.label)}</small></button>`).join("");
      container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => selectPlace(kind, places[Number(button.dataset.index)])));
    }
    container.hidden = false;
  } catch {
    container.hidden = true;
  }
}

for (const kind of ["origin", "destination"]) {
  field(`${kind}Address`).addEventListener("input", (event) => {
    selectedPlaces[kind] = null;
    field(`${kind}Lat`).value = "";
    field(`${kind}Lng`).value = "";
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(() => showSuggestions(kind, event.target.value), 250);
  });
  field(`${kind}Address`).addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = field(`${kind}Suggestions`).querySelector("button");
      if (first) first.click();
      else await resolvePlace(kind);
    }
  });
}

async function resolvePlace(kind) {
  if (selectedPlaces[kind]) return selectedPlaces[kind];
  const query = field(`${kind}Address`).value.trim();
  const [best] = await findSuggestions(query);
  if (!best) throw new Error(`Não encontrei “${query}” na Bahia. Inclua o bairro ou a cidade.`);
  selectPlace(kind, best);
  return best;
}

function renderSavedPlaces() {
  const container = field("savedPlaces");
  if (!savedPlaces.length) {
    container.innerHTML = '<button type="button" class="saved-empty" disabled>Salve destinos como Casa ou Trabalho</button>';
    return;
  }
  container.innerHTML = savedPlaces.map((place, index) => `<button type="button" class="saved-place" data-index="${index}">${escapeHtml(place.name)}</button>`).join("");
  container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => selectPlace("destination", savedPlaces[Number(button.dataset.index)])));
}

function decodePolyline(encoded, factor = 1e6) {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const target of ["lat", "lng"]) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (target === "lat") lat += delta;
      else lng += delta;
    }
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

const decodePolyline6 = (encoded) => decodePolyline(encoded, 1e6);

function decodeFlexiblePolyline(encoded) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let index = 0;
  const nextValue = () => {
    let result = 0;
    let shift = 0;
    let value;
    do {
      value = alphabet.indexOf(encoded[index++]);
      result |= (value & 31) << shift;
      shift += 5;
    } while (value & 32);
    return result;
  };
  nextValue();
  const header = nextValue();
  const factor = 10 ** (header & 15);
  const thirdDimension = (header >> 4) & 7;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  const toSigned = (value) => value & 1 ? ~(value >> 1) : value >> 1;
  while (index < encoded.length) {
    lat += toSigned(nextValue());
    lng += toSigned(nextValue());
    if (thirdDimension) nextValue();
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

function routeCoordinates(route, payload) {
  if (route.geometry?.format === "geo-points") {
    return route.geometry.points.map((point) => [point.latitude ?? point.lat, point.longitude ?? point.lng]);
  }
  if (route.geometry?.format === "encoded-polyline6") {
    return route.geometry.parts.flatMap(decodePolyline6);
  }
  if (route.geometry?.format === "encoded-polyline5") {
    return route.geometry.parts.flatMap((part) => decodePolyline(part, 1e5));
  }
  if (route.geometry?.format === "flexible-polyline") {
    return route.geometry.parts.flatMap(decodeFlexiblePolyline);
  }
  return [[payload.origin.lat, payload.origin.lng], [payload.destination.lat, payload.destination.lng]];
}

function renderMap(route, payload) {
  if (!window.L) {
    field("routeMap").innerHTML = "<p style='padding:24px'>O mapa precisa de conexão com a internet.</p>";
    return;
  }
  if (!map) {
    map = L.map("routeMap", { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);
  }
  if (routeLayer) routeLayer.remove();
  routeLayer = L.layerGroup().addTo(map);
  const points = routeCoordinates(route, payload);
  const markerStyle = (label) => L.divIcon({ className: "", html: `<div style="width:30px;height:30px;border-radius:50%;background:#111;color:#fff;display:grid;place-items:center;font:bold 12px Arial;border:3px solid #fff;box-shadow:0 3px 12px #0004">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  L.polyline(points, { color: "#111", weight: 6, opacity: 0.9 }).addTo(routeLayer);
  L.marker(points[0], { icon: markerStyle("A") }).addTo(routeLayer);
  L.marker(points.at(-1), { icon: markerStyle("B") }).addTo(routeLayer);
  map.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 15 });
  setTimeout(() => map.invalidateSize(), 50);
}

function normalizedHeading(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function applyMapBearing(position, heading) {
  if (!map || !position) return;
  map.setView([position.lat, position.lng], Math.max(map.getZoom(), 17), { animate: true, duration: 0.6 });
  const pane = map.getPane("mapPane");
  if (!pane) return;
  const bearing = directionUp ? normalizedHeading(heading ?? 0) : 0;
  const anchor = map.latLngToLayerPoint([position.lat, position.lng]);
  pane.style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
  pane.style.rotate = `${-bearing}deg`;
  if (positionMarker) {
    const arrow = positionMarker.getElement()?.querySelector(".position-arrow");
    if (arrow) arrow.style.transform = `rotate(${directionUp ? 0 : bearing}deg)`;
  }
}

function updateMapTracking(position, heading) {
  if (!map || !position || !document.body.classList.contains("journey-mode")) return;
  if (!positionMarker) {
    positionMarker = L.marker([position.lat, position.lng], {
      zIndexOffset: 1500,
      icon: L.divIcon({ className: "position-marker", html: '<div class="position-halo"></div><div class="position-arrow">▲</div>', iconSize: [42, 42], iconAnchor: [21, 21] })
    }).addTo(map);
  } else {
    positionMarker.setLatLng([position.lat, position.lng]);
  }
  applyMapBearing(position, heading);
}

function handleDeviceOrientation(event) {
  const compass = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : Number.isFinite(event.alpha) ? 360 - event.alpha : null;
  if (compass == null) return;
  const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
  deviceHeading = normalizedHeading(compass + screenAngle);
  if (lastPosition && gpsHeading == null) updateMapTracking(lastPosition, deviceHeading);
}

async function enableDeviceHeading() {
  if (orientationListening || typeof DeviceOrientationEvent === "undefined") return;
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== "granted") return;
  }
  window.addEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
  window.addEventListener("deviceorientation", handleDeviceOrientation, true);
  orientationListening = true;
}

function updateNavigationLinks(payload) {
  const origin = `${payload.origin.lat},${payload.origin.lng}`;
  const destination = `${payload.destination.lat},${payload.destination.lng}`;
  field("openWaze").href = `https://www.waze.com/ul?ll=${encodeURIComponent(destination)}&navigate=yes&utm_source=rota_inteligente`;
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: payload.vehicle === "motorcycle" ? "two-wheeler" : "driving", dir_action: "navigate" });
  field("openGoogle").href = `https://www.google.com/maps/dir/?${params}`;
}

function showResults(data, payload) {
  const route = data.recommended;
  field("recommended").innerHTML = `<div><span class="route-badge">MELHOR ESCOLHA · ${escapeHtml(route.provider)}</span><h3>${escapeHtml(route.durationMinutes)} minutos estimados</h3><p class="reason">${escapeHtml(data.reason)}</p></div><div class="route-stats">${stat("Confiança", `${Math.round(route.confidence * 100)}%`)}${stat("Ocorrências", route.incidents.length)}${stat("Pedágio", route.hasTolls ? "Sim" : "Não")}</div>`;
  field("alternatives").innerHTML = data.alternatives.length ? data.alternatives.map((item) => `<article class="alternative"><h4>${escapeHtml(item.provider)}</h4><p><b>${escapeHtml(item.durationMinutes)} min</b> · confiança ${Math.round(item.confidence * 100)}%</p><p>${item.incidents.length} ocorrência(s) · ${item.hasTolls ? "com pedágio" : "sem pedágio"}</p></article>`).join("") : "<p>Nenhuma outra alternativa disponível.</p>";
  field("providers").innerHTML = data.providers.map((item) => `<span class="provider-pill ${item.status}">${escapeHtml(item.provider)} · ${item.status === "ok" ? "conectado" : "falhou"}</span>`).join("");
  field("resultTime").textContent = `Atualizado às ${new Date(data.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  activeRouteId = route.id;
  activeRoute = route;
  announcedInstructions = new Set();
  const firstGuidance = route.instructions?.find((item) => item.type !== "depart") ?? route.instructions?.[0];
  field("nextInstruction").textContent = firstGuidance?.text ?? "Rota pronta";
  field("nextInstructionDistance").textContent = firstGuidance ? `Próxima manobra em ${Math.round(firstGuidance.distanceMeters)} metros.` : "Inicie a viagem para receber avisos por voz.";
  const demonstration = data.providers.every((provider) => provider.provider === "mock");
  field("trackingButton").dataset.demonstration = String(demonstration);
  field("trackingButton").textContent = demonstration ? "Simular tela de viagem" : "Iniciar viagem e rastreio";
  if (demonstration) addChatMessage("assistant", "Esta rota está em modo de demonstração e não deve ser usada para dirigir. Conecte HERE, TomTom ou Valhalla para seguir as curvas reais das vias.");
  updateTrafficSummary(route, data.waze);
  field("stagePlan").classList.remove("active");
  field("stagePlan").classList.add("done");
  field("stageJourney").classList.add("active");
  emptyState.hidden = true;
  results.hidden = false;
  updateNavigationLinks(payload);
  renderMap(route, payload);
  refreshTrafficSignals(payload).catch(() => {});
  loadNearbyPlaces(payload.destination.lat, payload.destination.lng, false);
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function routeBounds(payload) {
  const margin = 0.08;
  return {
    minLat: Math.min(payload.origin.lat, payload.destination.lat) - margin,
    maxLat: Math.max(payload.origin.lat, payload.destination.lat) + margin,
    minLng: Math.min(payload.origin.lng, payload.destination.lng) - margin,
    maxLng: Math.max(payload.origin.lng, payload.destination.lng) + margin
  };
}

async function refreshTrafficSignals(payload = lastPayload) {
  if (!payload) return;
  const params = new URLSearchParams(Object.fromEntries(Object.entries(routeBounds(payload)).map(([key, value]) => [key, String(value)])));
  const response = await fetch(`/v1/signals?${params}`);
  const data = await response.json();
  activeSignals = data.signals ?? [];
  if (!activeSignals.length) {
    field("signalState").textContent = data.status === "unavailable" ? "Sem fonte" : "Nenhum próximo";
    field("signalDetail").textContent = data.message ?? "nenhum sinal informado na área da rota";
    return;
  }
  updateNearestSignal(lastPosition ?? payload.origin);
}

function updateNearestSignal(position) {
  if (!activeSignals.length || !position) return;
  const next = activeSignals.map((signal) => ({ ...signal, distance: distanceMeters(position, signal) })).sort((a, b) => a.distance - b.distance)[0];
  const labels = { green: "Verde", red: "Vermelho", yellow: "Amarelo", verde: "Verde", vermelho: "Vermelho", amarelo: "Amarelo" };
  field("signalState").textContent = `${labels[next.state] ?? "Estado desconhecido"}${next.remainingSeconds != null ? ` · ${next.remainingSeconds}s` : ""}`;
  field("signalDetail").textContent = `${next.name} · ${Math.round(next.distance)} m${next.updatedAt ? ` · ${new Date(next.updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}`;
}

async function loadNearbyPlaces(lat, lng, announce = true) {
  try {
    const data = await fetch(`/v1/places/nearby?lat=${lat}&lng=${lng}`).then((response) => response.json());
    const places = data.places ?? [];
    field("nearbyPlaceList").innerHTML = places.length ? places.map((place, index) => `<button type="button" class="place-card" data-index="${index}"><strong>${escapeHtml(place.name)}</strong><small>${place.distanceKm.toFixed(1)} km · ${escapeHtml(place.label)}</small></button>`).join("") : "<p>Nenhuma sugestão próxima encontrada.</p>";
    field("nearbyPlaceList").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      const place = places[Number(button.dataset.index)];
      exitJourneyMode();
      stopTracking();
      selectPlace("destination", place);
      form.requestSubmit();
    }));
    if (announce && places[0]) addChatMessage("assistant", `Sugestão próxima: ${places[0].name}, a cerca de ${places[0].distanceKm.toFixed(1)} km. Toque no cartão se quiser usar como novo destino.`);
  } catch { /* sugestões não impedem a navegação */ }
}

function updateTrafficSummary(route, waze) {
  const wazeWarnings = waze?.warnings?.length ?? 0;
  const incidents = (route.incidents?.length ?? 0) + wazeWarnings;
  field("trafficState").textContent = incidents ? "Atenção" : "Fluindo";
  field("trafficDetail").textContent = incidents
    ? `${incidents} ocorrência(s) na área da rota${wazeWarnings ? ` · ${wazeWarnings} do Waze` : ""}`
    : waze?.status === "unavailable" ? "Waze ainda sem feed oficial" : "sem ocorrências informadas";
  field("roadSpeed").textContent = route.speedLimitKmh ?? "—";
}

function distanceMeters(a, b) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function updateCurrentPosition(position) {
  const current = { lat: position.coords.latitude, lng: position.coords.longitude, time: position.timestamp };
  let speedKmh = Number.isFinite(position.coords.speed) ? position.coords.speed * 3.6 : null;
  if (speedKmh == null && lastPosition) {
    const elapsed = (current.time - lastPosition.time) / 1000;
    if (elapsed > 0) speedKmh = distanceMeters(lastPosition, current) / elapsed * 3.6;
  }
  lastPosition = current;
  gpsHeading = Number.isFinite(position.coords.heading) && (position.coords.speed ?? 0) > 1 ? normalizedHeading(position.coords.heading) : null;
  field("currentSpeed").textContent = speedKmh == null ? "—" : Math.max(0, Math.round(speedKmh));
  updateTurnGuidance(current, speedKmh);
  updateNearestSignal(current);
  updateMapTracking(current, gpsHeading ?? deviceHeading);
}

let preferredSpeechVoice = null;

function chooseNaturalVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  const portuguese = voices.filter((voice) => /^pt(?:-|_)/i.test(voice.lang));
  const preferredNames = ["Francisca", "Thalita", "Luciana", "Joana", "Google português do Brasil", "Microsoft"];
  preferredSpeechVoice = preferredNames.map((name) => portuguese.find((voice) => voice.name.includes(name))).find(Boolean)
    ?? portuguese.find((voice) => !voice.localService)
    ?? portuguese[0]
    ?? null;
  return preferredSpeechVoice;
}

if ("speechSynthesis" in window) {
  chooseNaturalVoice();
  speechSynthesis.addEventListener?.("voiceschanged", chooseNaturalVoice);
}

function speakWithDevice(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const naturalText = String(text)
    .replace(/\s*·\s*/g, ", ")
    .replace(/\bkm\b/gi, "quilômetros")
    .replace(/\bm\b/g, "metros")
    .replace(/\s+/g, " ")
    .trim();
  const message = new SpeechSynthesisUtterance(naturalText);
  message.lang = "pt-BR";
  message.voice = preferredSpeechVoice ?? chooseNaturalVoice();
  message.rate = 0.94;
  message.pitch = 1.03;
  message.volume = 1;
  speechSynthesis.speak(message);
}

let currentVoiceAudio = null;

async function speakGuidance(text) {
  const naturalText = String(text)
    .replace(/\s*·\s*/g, ", ")
    .replace(/\bkm\b/gi, "quilômetros")
    .replace(/\bm\b/g, "metros")
    .replace(/\s+/g, " ")
    .trim();
  try {
    currentVoiceAudio?.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    const response = await fetch("/v1/voice/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: naturalText })
    });
    if (!response.ok) throw new Error("voz neural indisponível");
    const audioUrl = URL.createObjectURL(await response.blob());
    currentVoiceAudio = new Audio(audioUrl);
    currentVoiceAudio.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), { once: true });
    await currentVoiceAudio.play();
  } catch {
    speakWithDevice(naturalText);
  }
}

function updateTurnGuidance(current, speedKmh) {
  const pending = activeRoute?.instructions?.filter((item) => !announcedInstructions.has(item.id) && item.type !== "depart") ?? [];
  if (!pending.length) return;
  const next = pending.map((item) => ({ ...item, remaining: distanceMeters(current, item.location) })).sort((a, b) => a.remaining - b.remaining)[0];
  const speedMetersSecond = Math.max(2, (speedKmh ?? 18) / 3.6);
  const warningDistance = Math.max(20, speedMetersSecond * 10);
  field("nextInstruction").textContent = next.text;
  field("nextInstructionDistance").textContent = next.remaining < 1000 ? `Em ${Math.max(0, Math.round(next.remaining))} metros` : `Em ${(next.remaining / 1000).toFixed(1)} km`;
  if (next.remaining <= warningDistance) {
    announcedInstructions.add(next.id);
    const phrase = next.type === "arrive" ? next.text : `Em cerca de 10 segundos, ${next.text.toLocaleLowerCase("pt-BR")}.`;
    speakGuidance(phrase);
    addChatMessage("assistant", phrase);
  }
}

async function fetchLiveRecommendation() {
  if (!lastPayload) return null;
  const response = await fetch("/v1/recommendations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lastPayload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Trânsito indisponível");
  updateTrafficSummary(data.recommended);
  if (activeRouteId && data.recommended.id !== activeRouteId) addChatMessage("assistant", `O trânsito mudou. Encontrei uma alternativa melhor de ${data.recommended.durationMinutes} minutos. Você pode recalcular ou continuar no Waze/Google Maps.`);
  activeRouteId = data.recommended.id;
  await refreshTrafficSignals(lastPayload);
  return data;
}

function startTracking() {
  enableDeviceHeading().catch(() => {});
  if (field("trackingButton").dataset.demonstration === "true") {
    trackingWatchId = -1;
    trafficTimer = setInterval(() => fetchLiveRecommendation().catch(() => {}), 60_000);
    field("trackingButton").textContent = "Encerrar simulação";
    field("trackingButton").classList.add("active");
    field("chatLive").textContent = "Simulação · atualização a cada 60 segundos";
    document.body.classList.add("journey-mode");
    field("exitJourney").hidden = false;
    setTimeout(() => map?.invalidateSize(), 100);
    setTimeout(() => updateMapTracking(lastPayload.origin, deviceHeading), 150);
    loadNearbyPlaces(lastPayload.destination.lat, lastPayload.destination.lng, true);
    addChatMessage("assistant", "Tela de viagem simulada. A linha só seguirá as curvas reais depois que um provedor de rotas estiver conectado.");
    return;
  }
  if (!navigator.geolocation) {
    addChatMessage("assistant", "Este dispositivo não oferece localização pelo navegador.");
    return;
  }
  trackingWatchId = navigator.geolocation.watchPosition(updateCurrentPosition, () => {
    field("trafficDetail").textContent = "localização não autorizada";
    field("trafficDetail").classList.add("tracking-alert");
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  trafficTimer = setInterval(() => fetchLiveRecommendation().catch(() => {}), 60_000);
  field("trackingButton").textContent = "Encerrar rastreio";
  field("trackingButton").classList.add("active");
  field("chatLive").textContent = "Atualização a cada 60 segundos";
  addChatMessage("assistant", "Viagem iniciada. Vou acompanhar mudanças no trânsito a cada minuto.");
  document.body.classList.add("journey-mode");
  field("exitJourney").hidden = false;
  setTimeout(() => map?.invalidateSize(), 100);
  loadNearbyPlaces(lastPayload.destination.lat, lastPayload.destination.lng, true);
  fetchLiveRecommendation().catch(() => {});
}

function exitJourneyMode() {
  document.body.classList.remove("journey-mode");
  field("exitJourney").hidden = true;
  setTimeout(() => map?.invalidateSize(), 100);
}

function stopTracking() {
  if (trackingWatchId != null) navigator.geolocation.clearWatch(trackingWatchId);
  clearInterval(trafficTimer);
  trackingWatchId = undefined;
  trafficTimer = undefined;
  lastPosition = undefined;
  gpsHeading = null;
  if (positionMarker) {
    positionMarker.remove();
    positionMarker = undefined;
  }
  const mapPane = map?.getPane("mapPane");
  if (mapPane) mapPane.style.rotate = "0deg";
  field("currentSpeed").textContent = "—";
  field("trackingButton").textContent = field("trackingButton").dataset.demonstration === "true" ? "Simular tela de viagem" : "Iniciar viagem e rastreio";
  field("trackingButton").classList.remove("active");
  field("chatLive").textContent = "Aguardando viagem";
  exitJourneyMode();
}

field("trackingButton").addEventListener("click", () => trackingWatchId == null ? startTracking() : stopTracking());
field("exitJourney").addEventListener("click", stopTracking);

field("mapOrientation").addEventListener("click", () => {
  directionUp = !directionUp;
  field("mapOrientation").textContent = directionUp ? "↑ Direção para cima" : "N Norte para cima";
  const position = lastPosition ?? lastPayload?.origin;
  if (position) applyMapBearing(position, gpsHeading ?? deviceHeading);
});

function addChatMessage(role, text) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.textContent = text;
  field("chatMessages").append(message);
  field("chatMessages").scrollTop = field("chatMessages").scrollHeight;
}

const routeJokes = [
  "Prometo escolher ruas, não atalhos pelo meio do mato.",
  "Cinto colocado? Eu cuido da rota; você cuida das curvas.",
  "Se a rua pudesse falar, provavelmente pediria menos buracos.",
  "Rota calculada sem precisar perguntar a ninguém na esquina.",
  "Vamos pelo caminho inteligente — teletransporte ainda está em testes.",
  "Meu combustível é informação; felizmente não aumentou esta semana."
];

function occasionalHumor() {
  return Math.random() < 0.28 ? ` ${routeJokes[Math.floor(Math.random() * routeJokes.length)]}` : "";
}

function navigationPlaceQuery(text) {
  const normalized = text.toLocaleLowerCase("pt-BR");
  const direct = normalized.match(/(?:me leve|vá|va|ir)\s+(?:para|até|ate|pra|pro|ao|à)?\s*(.+)/)
    ?? normalized.match(/(?:rota|caminho|navegar|destino)\s+(?:para|até|ate|pra|pro|ao|à)\s+(.+)/);
  if (direct?.[1]) return direct[1].replace(/(?:\s+mais próximo|\s+mais proximo|\s+perto de mim)$/i, "").trim();
  if (/restaurante|lanchonete|pizzaria|bar|café|cafe|padaria|sorveteria|posto|gasolina|combustível|combustivel|hospital|farmácia|farmacia|hotel|mercado|supermercado|shopping|praia|oficina|mecânico|mecanico|estacionamento/.test(normalized)) return normalized;
  return null;
}

async function executeAutonomousRoute(place, spokenText) {
  const currentOrigin = lastPosition
    ? { name: "Minha localização", label: "Minha localização atual", lat: lastPosition.lat, lng: lastPosition.lng, provider: "gps" }
    : selectedPlaces.origin;
  if (!currentOrigin) throw new Error("Informe sua partida ou permita a localização antes de pedir uma rota.");
  if (trackingWatchId != null) stopTracking();
  selectPlace("origin", currentOrigin);
  selectPlace("destination", place);
  addChatMessage("assistant", `Entendi “${spokenText}”. Vou traçar agora a rota para ${place.name}, a cerca de ${place.distanceKm?.toFixed(1) ?? "—"} km.${occasionalHumor()}`);
  form.requestSubmit();
}

async function handleNavigationRequest(text) {
  const query = navigationPlaceQuery(text);
  if (!query) return false;
  const origin = lastPosition ?? selectedPlaces.origin;
  if (!origin) throw new Error("Preciso da sua localização ou de um endereço de partida.");
  const category = /restaurante|lanchonete|pizzaria|bar|café|cafe|padaria|sorveteria|posto|gasolina|combustível|combustivel|hospital|farmácia|farmacia|hotel|mercado|supermercado|shopping|praia|oficina|mecânico|mecanico|estacionamento/.test(query);
  let places;
  if (category) {
    const params = new URLSearchParams({ q: query, lat: origin.lat, lng: origin.lng });
    const response = await fetch(`/v1/places/discover?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não consegui procurar lugares próximos.");
    places = data.places ?? [];
  } else {
    places = await findSuggestions(query);
  }
  if (!places.length) throw new Error(`Não encontrei “${query}” na Bahia.`);
  const chosen = places[0];
  await executeAutonomousRoute(chosen, text);
  if (places.length > 1) addChatMessage("assistant", `Também encontrei ${Math.min(places.length - 1, 19)} alternativa(s). Você pode pedir pelo nome específico se preferir outro lugar.`);
  return true;
}

field("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = field("chatInput").value.trim();
  if (!text) return;
  field("chatInput").value = "";
  addChatMessage("user", text);
  try {
    if (await handleNavigationRequest(text)) return;
  } catch (error) {
    addChatMessage("assistant", error.message);
    return;
  }
  if (/trânsito|transito|congestion|engarraf|alternativa/.test(text.toLocaleLowerCase("pt-BR"))) {
    try {
      const data = await fetchLiveRecommendation();
      addChatMessage("assistant", `Verificação atual: ${data.recommended.durationMinutes} minutos, ${data.recommended.incidents.length} ocorrência(s). ${data.reason}`);
    } catch {
      addChatMessage("assistant", "Não consegui consultar as fontes de trânsito agora. Vou tentar novamente na próxima atualização.");
    }
  } else if (/velocidade|limite/.test(text.toLocaleLowerCase("pt-BR"))) {
    addChatMessage("assistant", `Velocidade atual: ${field("currentSpeed").textContent} km/h. Limite informado da via: ${field("roadSpeed").textContent} km/h.`);
  } else {
    addChatMessage("assistant", `Posso verificar trânsito, encontrar restaurantes e outros lugares, traçar uma nova rota ou informar a velocidade.${occasionalHumor()}`);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  submit.querySelector("span").textContent = "Analisando...";
  document.body.classList.add("loading");
  toast.hidden = true;
  try {
    const origin = await resolvePlace("origin");
    const destination = await resolvePlace("destination");
    lastPayload = {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      vehicle: form.elements.vehicle.value,
      preferences: { avoidTolls: field("avoidTolls").checked, simpleRoute: field("simpleRoute").checked }
    };
    const response = await fetch("/v1/recommendations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lastPayload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não foi possível calcular as rotas.");
    showResults(data, lastPayload);
  } catch (error) {
    toast.textContent = error.message;
    toast.hidden = false;
  } finally {
    submit.disabled = false;
    submit.querySelector("span").textContent = "Comparar rotas";
    document.body.classList.remove("loading");
  }
});

field("useLocation").addEventListener("click", () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    selectPlace("origin", { name: "Minha localização", label: "Minha localização atual", lat: coords.latitude, lng: coords.longitude, provider: "gps" });
  }, () => {
    toast.textContent = "Não foi possível acessar sua localização.";
    toast.hidden = false;
  });
});

field("swapLocations").addEventListener("click", () => {
  [["originAddress", "destinationAddress"], ["originLat", "destinationLat"], ["originLng", "destinationLng"]].forEach(([a, b]) => {
    [field(a).value, field(b).value] = [field(b).value, field(a).value];
  });
  [selectedPlaces.origin, selectedPlaces.destination] = [selectedPlaces.destination, selectedPlaces.origin];
});

field("saveDestination").addEventListener("click", () => {
  const destination = selectedPlaces.destination;
  if (!destination) return;
  const name = window.prompt("Qual nome curto você quer usar? Ex.: Casa, Trabalho ou Academia", destination.name)?.trim();
  if (!name) return;
  savedPlaces = [{ ...destination, name }, ...savedPlaces.filter((place) => place.name.toLocaleLowerCase("pt-BR") !== name.toLocaleLowerCase("pt-BR"))].slice(0, 12);
  localStorage.setItem("savedPlaces", JSON.stringify(savedPlaces));
  renderSavedPlaces();
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceButton = field("voiceButton");
const voicePanel = field("voicePanel");
const talkButton = field("talkButton");
const chatMicButton = field("chatMicButton");
let recognition;
let listening = false;
let voiceBusy = false;
let lastVoicePlaces = [];
let voiceAwakeUntil = 0;

function voiceReply(text) {
  addChatMessage("assistant", text);
  speakGuidance(text);
}

async function conversationalPlaceSearch(transcript) {
  const command = transcript.toLocaleLowerCase("pt-BR").replace(/^(?:ei|olá|ola)\s+(?:rota|assistente)[,\s]*/, "");
  const choice = command.match(/(?:me leve|vamos|quero ir).*(primeiro|segundo|terceiro|mais próximo|mais proximo|nesse)/);
  if (choice && lastVoicePlaces.length) {
    const indexes = { primeiro: 0, segundo: 1, terceiro: 2, "mais próximo": 0, "mais proximo": 0, nesse: 0 };
    const place = lastVoicePlaces[indexes[choice[1]] ?? 0];
    if (place) {
      await executeAutonomousRoute(place, transcript);
      speakGuidance(`Certo. Traçando a rota para ${place.name}.`);
      return true;
    }
  }
  const categoryPattern = /restaurante|lanchonete|pizzaria|bar|café|cafe|padaria|sorveteria|posto|gasolina|combustível|combustivel|hospital|farmácia|farmacia|hotel|mercado|supermercado|shopping|praia|oficina|mecânico|mecanico|estacionamento/;
  const isQuestion = /onde|quais|procure|encontre|tem algum|tem uma|tem um/.test(command);
  const isImmediateRoute = /me leve|trace|traçar|rota para|quero ir|vamos para|vá para|va para/.test(command);
  if (!categoryPattern.test(command) || !isQuestion || isImmediateRoute) return false;
  const origin = lastPosition ?? selectedPlaces.origin;
  if (!origin) throw new Error("Diga sua partida ou permita a localização para eu procurar perto de você.");
  const params = new URLSearchParams({ q: command, lat: origin.lat, lng: origin.lng });
  const response = await fetch(`/v1/places/discover?${params}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Não consegui pesquisar agora.");
  lastVoicePlaces = (data.places ?? []).slice(0, 3);
  if (!lastVoicePlaces.length) throw new Error("Não encontrei opções próximas.");
  const names = lastVoicePlaces.map((place, index) => `${index + 1}, ${place.name}, a ${place.distanceKm.toFixed(1)} quilômetros`).join("; ");
  voiceReply(`Encontrei estas opções: ${names}. Diga primeiro, segundo ou terceiro para eu traçar a rota.`);
  return true;
}

async function applyVoiceCommand(transcript) {
  voiceBusy = true;
  field("voiceStatus").textContent = "Entendendo o pedido...";
  const selectedVoiceMode = document.querySelector('input[name="voiceMode"]:checked').value;
  const rawCommand = transcript.toLocaleLowerCase("pt-BR").trim();
  const wakeMatch = rawCommand.match(/^(?:ei[,\s]+)?(?:rota|assistente)(?:[,\s]+(.*))?$/);
  if (selectedVoiceMode === "always" && Date.now() > voiceAwakeUntil && !wakeMatch) {
    field("voiceStatus").textContent = "Em espera · diga Rota";
    voiceBusy = false;
    return;
  }
  if (selectedVoiceMode === "always" && wakeMatch && !wakeMatch[1]?.trim()) {
    voiceAwakeUntil = Date.now() + 15000;
    voiceReply("Estou ouvindo. Pode falar.");
    return;
  }
  const command = wakeMatch?.[1]?.trim() || rawCommand;
  voiceAwakeUntil = 0;
  addChatMessage("user", command);
  if (/moto|motocicleta/.test(command)) { form.elements.vehicle.value = "motorcycle"; voiceReply("Certo, vou considerar que você está de moto."); return; }
  if (/carro|automóvel/.test(command)) { form.elements.vehicle.value = "car"; voiceReply("Certo, modo carro ativado."); return; }
  if (/evitar pedágio|sem pedágio/.test(command)) { field("avoidTolls").checked = true; voiceReply("Tudo bem, vou evitar pedágios."); return; }
  if (/permitir pedágio|com pedágio/.test(command)) { field("avoidTolls").checked = false; voiceReply("Pedágios permitidos para esta rota."); return; }
  if (/caminho simples|rota simples/.test(command)) { field("simpleRoute").checked = true; voiceReply("Vou priorizar um caminho mais simples."); return; }
  if (/usar.*localização|minha localização/.test(command)) field("useLocation").click();
  if (await conversationalPlaceSearch(command)) return;
  if (await handleNavigationRequest(command)) {
    speakGuidance("Certo. Estou calculando a nova rota.");
    return;
  }
  const destinationCommand = command.match(/(?:ir para|destino|vou para)\s+(.+?)(?:\s+e\s+(?:calcular|buscar|traçar)|$)/);
  if (destinationCommand) {
    field("destinationAddress").value = destinationCommand[1];
    selectedPlaces.destination = null;
    await resolvePlace("destination");
  }
  if (/calcular|comparar|buscar rota|traçar rota/.test(command)) {
    voiceReply("Certo. Vou calcular a rota agora.");
    form.requestSubmit();
    return;
  }
  if (/trânsito|transito|congestion|engarraf|alternativa/.test(command)) {
    const data = await fetchLiveRecommendation();
    voiceReply(`A rota está estimada em ${data.recommended.durationMinutes} minutos, com ${data.recommended.incidents.length} ocorrências informadas.`);
    return;
  }
  if (/velocidade|limite/.test(command)) {
    voiceReply(`Sua velocidade indicada é ${field("currentSpeed").textContent} quilômetros por hora. O limite informado é ${field("roadSpeed").textContent}.`);
    return;
  }
  voiceReply("Eu ouvi você, mas ainda não entendi a ação. Tente dizer: me leve a um restaurante, encontre um bar ou trace uma rota para a Base Naval.");
}

function startListening() {
  if (!recognition || listening) return;
  try { recognition.start(); } catch { /* o navegador já está iniciando */ }
}

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => {
    listening = true;
    voiceButton.classList.add("listening");
    voiceButton.setAttribute("aria-pressed", "true");
    field("voiceStatus").textContent = "Ouvindo...";
    chatMicButton.classList.add("listening");
    chatMicButton.setAttribute("aria-pressed", "true");
    chatMicButton.textContent = "■";
    field("chatLive").textContent = "Ouvindo você...";
  };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
    field("voiceTranscript").textContent = transcript;
    if (event.results[event.results.length - 1].isFinal) {
      recognition.stop();
      applyVoiceCommand(transcript).catch((error) => {
        voiceReply(error.message);
        toast.textContent = error.message;
        toast.hidden = false;
      }).finally(() => {
        voiceBusy = false;
        field("voiceStatus").textContent = "Microfone pronto";
        if (!voicePanel.hidden && document.querySelector('input[name="voiceMode"]:checked').value === "always") setTimeout(startListening, 1200);
      });
    }
  };
  recognition.onend = () => {
    listening = false;
    voiceButton.classList.remove("listening");
    voiceButton.setAttribute("aria-pressed", "false");
    field("voiceStatus").textContent = "Microfone pronto";
    chatMicButton.classList.remove("listening");
    chatMicButton.setAttribute("aria-pressed", "false");
    chatMicButton.textContent = "●";
    if (trackingWatchId != null) field("chatLive").textContent = "Atualização a cada 60 segundos";
    if (!voiceBusy && !voicePanel.hidden && document.querySelector('input[name="voiceMode"]:checked').value === "always") setTimeout(startListening, 400);
  };
  recognition.onerror = (event) => {
    const messages = { "not-allowed": "Permissão de microfone negada", "audio-capture": "Nenhum microfone disponível", network: "Serviço de voz sem conexão", "no-speech": "Não ouvi nenhuma fala" };
    const message = messages[event.error] ?? `Falha no reconhecimento: ${event.error}`;
    field("voiceStatus").textContent = message;
    addChatMessage("assistant", message);
  };
} else {
  talkButton.disabled = true;
  chatMicButton.disabled = true;
  chatMicButton.title = "Reconhecimento de voz indisponível neste navegador";
  field("voiceStatus").textContent = "Voz não disponível neste navegador";
}

voiceButton.addEventListener("click", () => {
  voicePanel.hidden = !voicePanel.hidden;
  if (voicePanel.hidden && recognition && listening) recognition.stop();
});
talkButton.addEventListener("click", startListening);
chatMicButton.addEventListener("click", () => {
  if (!recognition) {
    addChatMessage("assistant", "O reconhecimento de voz não está disponível neste navegador. Tente abrir o sistema no Chrome ou Edge.");
    return;
  }
  if (listening) recognition.stop();
  else startListening();
});
document.querySelectorAll('input[name="voiceMode"]').forEach((input) => input.addEventListener("change", () => {
  if (input.checked && input.value === "always") startListening();
  if (input.checked && input.value === "push" && recognition && listening) recognition.stop();
  if (input.checked && input.value === "off" && recognition && listening) recognition.stop();
  talkButton.disabled = input.value === "off";
}));

initializeSession();
renderSavedPlaces();
