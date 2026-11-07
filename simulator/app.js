(() => {
  "use strict";
  const Matrix = window.Matrix32x8;
  const PLATFORM_INFO = {
    youtube: { code: "YT", name: "YouTube", metric: "subscribers", label: "prenumeratoriai" },
    spotify: { code: "SP", name: "Spotify", metric: "monthly_listeners", label: "mėn. klausytojai" },
    instagram: { code: "IG", name: "Instagram", metric: "followers", label: "sekėjai" },
    facebook: { code: "FB", name: "Facebook", metric: "followers", label: "sekėjai" },
  };
  const DEFAULT_ORDER = Object.keys(PLATFORM_INFO);
  const DEMO_DATA = { generated_at: new Date().toISOString(), platforms: {
    youtube: { status: "ok", http_status: 200, metrics: { subscribers: { value: 356, change_24h: { value: 12 }, status: "ok" }, channel_views: { value: 1250000 } } },
    spotify: { status: "ok", http_status: 200, metrics: { monthly_listeners: { value: 872, change_24h: { value: null }, status: "ok" } } },
    instagram: { status: "ok", http_status: 200, metrics: { followers: { value: 1502, change_24h: { value: -3 }, status: "ok" } } },
    facebook: { status: "ok", http_status: 200, metrics: { followers: { value: 625, change_24h: { value: 0 }, status: "ok" } } },
  } };
  const ids = ["matrix", "modeBadge", "dataModeFootnote", "frameStatus", "nowTitle", "nowMeta", "nowValue", "platformStrip", "changeDurationInput", "changeDurationOutput", "mainDurationInput", "mainDurationOutput", "transitionInput", "transitionOutput", "brightnessInput", "brightnessOutput", "formatInput", "fontInput", "unknownChangeInput", "orderList", "channelViewsInput", "channelViewsHint", "demoInput", "staleInput", "errorInput", "refreshButton", "refreshTextButton", "loadError"];
  const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const dots = [];
  for (let i = 0; i < Matrix.WIDTH * Matrix.HEIGHT; i++) { const dot = document.createElement("span"); dot.className = "led"; dot.setAttribute("aria-hidden", "true"); els.matrix.append(dot); dots.push(dot); }
  const settings = loadSettings();
  Matrix.setFont(settings.font);
  let stats = null, lastReadSignature = "", sequence = [], sequenceIndex = 0, phase = "hold", phaseStarted = performance.now();
  let currentItem = null, currentFrame = blankFrame(), previousSignature = "";
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function loadSettings() {
    const s = { order: [...DEFAULT_ORDER], changeSeconds: 2.5, mainSeconds: 7, transitionMs: 600, brightness: 68, format: "auto", font: "3x6", showChange: true, channelViews: false };
    try { const saved = JSON.parse(localStorage.getItem("dans-turbulans-led-settings") || "{}");
      if (Array.isArray(saved.order)) { const valid = saved.order.filter((p) => DEFAULT_ORDER.includes(p)); s.order = [...new Set([...valid, ...DEFAULT_ORDER])].slice(0, 4); }
      if (Number.isFinite(saved.changeSeconds)) s.changeSeconds = clamp(saved.changeSeconds, 1, 6);
      if (Number.isFinite(saved.mainSeconds)) s.mainSeconds = clamp(saved.mainSeconds, 2, 12);
      if (Number.isFinite(saved.transitionMs)) s.transitionMs = clamp(saved.transitionMs, 300, 1000);
      if (Number.isFinite(saved.brightness)) s.brightness = clamp(saved.brightness, 12, 100);
      if (["auto", "exact"].includes(saved.format)) s.format = saved.format;
      if (["3x5", "3x6"].includes(saved.font)) s.font = saved.font;
      if (typeof saved.showChange === "boolean") s.showChange = saved.showChange;
      if (typeof saved.channelViews === "boolean") s.channelViews = saved.channelViews;
    } catch (_) { /* Ignore invalid browser preferences. */ }
    return s;
  }
  function saveSettings() { localStorage.setItem("dans-turbulans-led-settings", JSON.stringify(settings)); }
  function blankFrame() { return Array.from({ length: Matrix.HEIGHT }, () => Array(Matrix.WIDTH).fill(false)); }
  function data() { return els.demoInput.checked ? DEMO_DATA : stats; }
  function record(platform) { return data()?.platforms?.[platform] || null; }
  function metric(platform, key) { return Matrix.metricFromStats(data(), platform, key); }
  const staleAfterHours = Number(document.querySelector('meta[name="stats-stale-after-hours"]')?.content) || 12;
  function metricTimestamp(platform, m) { return record(platform)?.last_successful_at || m.fetched_at || record(platform)?.fetched_at || null; }
  function ageLabel(timestamp) {
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return "matavimo laikas nežinomas";
    const totalMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60000));
    if (totalMinutes < 60) return `prieš ${totalMinutes} min.`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `prieš ${hours} val.`;
    const days = Math.floor(hours / 24), restHours = hours % 24;
    return `prieš ${days} d. ${restHours} val.`;
  }
  function isStale(platform, m) {
    const rec = record(platform), timestamp = metricTimestamp(platform, m), ageMs = timestamp ? Date.now() - Date.parse(timestamp) : 0;
    return Boolean(m.stale || rec?.stale || rec?.status === "stale" || (timestamp && ageMs >= staleAfterHours * 3600000));
  }
  function isError(platform, m) { return els.errorInput.value === "all" || els.errorInput.value === platform || m.value == null || ["error", "unavailable"].includes(m.status); }
  function rebuildSequence(reset = true) {
    sequence = [];
    for (const platform of settings.order) {
      const info = PLATFORM_INFO[platform];
      const main = metric(platform, info.metric);
      const delta = main.change_24h && typeof main.change_24h === "object" ? main.change_24h.value : main.change_24h;
      const failed = els.errorInput.value === "all" || els.errorInput.value === platform || main.value == null || ["error", "unavailable"].includes(main.status);
      if ((!failed && delta != null) || settings.showChange) sequence.push({ platform, metric: info.metric, kind: "change" });
      sequence.push({ platform, metric: info.metric, kind: "current" });
      if (platform === "youtube" && els.channelViewsInput.checked) sequence.push({ platform, metric: "channel_views", kind: "current" });
    }
    if (reset) { sequenceIndex = 0; phase = "hold"; phaseStarted = performance.now(); currentItem = null; }
  }
  function syncOptionalViews() {
    const m = metric("youtube", "channel_views"), available = m.value != null;
    els.channelViewsInput.disabled = !available;
    els.channelViewsHint.textContent = available ? "Atskiras YT rodinys po pagrindinės statistikos" : "Šiame stats.json reikšmės nėra";
    els.channelViewsInput.checked = available && settings.channelViews;
    rebuildSequence(false);
  }
  function updateRange(input, output, suffix) { const v = Number(input.value); input.style.setProperty("--progress", `${((v - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`); output.textContent = `${v}${suffix}`; }
  function renderOrder() {
    els.orderList.replaceChildren();
    settings.order.forEach((platform, i) => {
      const info = PLATFORM_INFO[platform], li = document.createElement("li"); li.className = "order-item";
      const code = document.createElement("span"); code.className = "order-code"; code.textContent = info.code;
      const name = document.createElement("span"); name.className = "order-name"; name.textContent = info.name;
      const buttons = document.createElement("span"); buttons.className = "move-buttons";
      [["↑", i - 1, "Perkelti aukštyn"], ["↓", i + 1, "Perkelti žemyn"]].forEach(([label, j, title]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", `${title}: ${info.name}`); b.disabled = j < 0 || j >= settings.order.length; b.addEventListener("click", () => { [settings.order[i], settings.order[j]] = [settings.order[j], settings.order[i]]; saveSettings(); renderOrder(); rebuildSequence(); }); buttons.append(b); });
      li.append(code, name, buttons); els.orderList.append(li);
    });
  }
  function prepared(item) {
    const info = PLATFORM_INFO[item.platform], m = metric(item.platform, item.metric), error = isError(item.platform, m);
    let value = item.kind === "change" ? (m.change_24h && typeof m.change_24h === "object" ? m.change_24h.value : m.change_24h) : m.value;
    if (item.kind === "change" && error) value = null;
    const suffix = item.kind === "change" ? Matrix.formatDelta(value) : (error ? "ERR" : `${item.metric === "channel_views" ? "V " : ""}${Matrix.formatValue(value, settings.format)}`);
    const text = `${info.code} ${suffix}`;
    return { info, metric: m, error, text, suffix, valueText: item.kind === "change" ? Matrix.formatDelta(value) : (error ? "Klaida" : Matrix.formatValue(value, settings.format)), stale: Boolean(els.staleInput.checked || isStale(item.platform, m)) };
  }
  function setStatus(item) {
    const shown = prepared(item), rec = record(item.platform), http = rec?.http_status == null ? "HTTP —" : `HTTP ${rec.http_status}`;
    const ts = metricTimestamp(item.platform, shown.metric), time = ts ? new Date(ts).toLocaleString("lt-LT", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "laikas nežinomas";
    const markers = [ts ? `matavimas ${ageLabel(ts)} (${time})` : "matavimo laikas nežinomas"]; if (shown.stale) markers.push("PASENĘ"); if (shown.error && !els.demoInput.checked) markers.push(shown.metric?.error || rec?.error || "neprieinama");
    if (shown.error && ["all", item.platform].includes(els.errorInput.value)) markers.push("imituojama klaida");
    els.nowTitle.textContent = `${shown.info.name} · ${item.kind === "change" ? "pokytis per ~24 val." : item.metric === "channel_views" ? "kanalo peržiūros" : shown.info.label}`;
    els.nowValue.textContent = shown.valueText; els.nowMeta.textContent = [http, time, ...markers].join(" · ");
    els.frameStatus.textContent = shown.error ? "KLAIDA" : shown.stale ? "PASENĘ" : item.kind === "change" ? "PAROS POKYTIS" : "DABARTINĖ REIKŠMĖ";
    document.querySelectorAll(".platform-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.platform === item.platform));
  }
  function renderChips() {
    els.platformStrip.replaceChildren(); const d = data(); if (!d) return;
    settings.order.forEach((p) => { const info = PLATFORM_INFO[p], m = metric(p, info.metric), chip = document.createElement("div"); chip.className = "platform-chip"; chip.dataset.platform = p;
      const top = document.createElement("div"); top.className = "chip-top"; const code = document.createElement("span"); code.className = "chip-code"; code.textContent = info.code; const dot = document.createElement("span"); dot.className = "chip-dot"; top.append(code, dot);
      const stale = isStale(p, m); chip.classList.toggle("stale", stale); chip.title = `${info.name}: ${ageLabel(metricTimestamp(p, m))}${stale ? " · PASENĘ" : ""}`;
      const value = document.createElement("div"); value.className = "chip-value"; value.textContent = isError(p, m) ? "ERR" : Matrix.formatValue(m.value, settings.format);
      const label = document.createElement("div"); label.className = "chip-label"; label.textContent = info.label; chip.append(top, value, label); els.platformStrip.append(chip);
    });
  }
  function renderMode() {
    const isPublic = document.querySelector('meta[name="stats-mode"]')?.content === "public";
    els.modeBadge.classList.toggle("demo", els.demoInput.checked);
    els.modeBadge.lastChild.textContent = els.demoInput.checked ? " Demonstracija" : isPublic ? " Viešas JSON" : " Vietinis JSON";
    els.dataModeFootnote.textContent = isPublic ? "viešas JSON · atnaujinama kas 5 min." : "vietinis JSON · skaitomas iš disko";
    renderChips(); syncOptionalViews();
  }
  function updateDots(frame, lockedPrefixEnd = 0) {
    const sig = frame.map((r) => r.map(Number).join("")).join(""); if (sig === previousSignature) return;
    frame.forEach((row, y) => row.forEach((lit, x) => { if (x >= lockedPrefixEnd) dots[y * Matrix.WIDTH + x].classList.toggle("on", x !== 0 && lit); }));
    previousSignature = sig;
  }
  function activate(index) {
    sequenceIndex = (index + sequence.length) % sequence.length; currentItem = sequence[sequenceIndex];
    const shown = prepared(currentItem), pattern = Matrix.patternFor(shown.suffix);
    currentItem.frame = Matrix.labeledFrame(shown.info.code, shown.suffix); currentItem.scrollPattern = pattern; currentItem.scrollOffset = 0;
    setStatus(currentItem); phase = "hold"; phaseStarted = performance.now();
  }
  function next() {
    const oldItem = currentItem, old = currentItem?.frame || currentFrame;
    activate(sequenceIndex + 1); const target = currentItem.frame;
    const samePlatform = oldItem?.platform === currentItem.platform;
    phase = "transition"; phaseStarted = performance.now(); currentItem.transitionFrom = old; currentItem.transitionTo = target;
    currentItem.lockedPrefixEnd = samePlatform ? Matrix.labelRegionStart(PLATFORM_INFO[currentItem.platform].code) : 0;
  }
  function draw(now) {
    if (!sequence.length) rebuildSequence();
    if (!currentItem) activate(sequenceIndex);
    const elapsed = now - phaseStarted;
    if (phase === "hold") {
      const hold = (currentItem.kind === "change" ? settings.changeSeconds : settings.mainSeconds) * 1000;
      const pat = currentItem.scrollPattern, labelStart = Matrix.labelRegionStart(PLATFORM_INFO[currentItem.platform].code);
      const maxOffset = Math.max(0, pat[0].length - (Matrix.WIDTH - labelStart));
      if (maxOffset && elapsed > hold * 0.55) { const offset = Math.min(maxOffset, Math.floor((elapsed - hold * 0.55) / 70)); currentItem.frame = Matrix.labeledFrame(PLATFORM_INFO[currentItem.platform].code, prepared(currentItem).suffix, offset); }
      currentFrame = currentItem.frame; updateDots(currentFrame);
      if (elapsed >= hold) next();
    } else {
      const progress = Math.min(1, elapsed / settings.transitionMs), rows = Math.round(progress * Matrix.HEIGHT);
      currentFrame = currentItem.lockedPrefixEnd
        ? Matrix.verticalTransitionRegion(currentItem.transitionFrom, currentItem.transitionTo, rows, currentItem.lockedPrefixEnd)
        : Matrix.verticalTransitionFrame(currentItem.transitionFrom, currentItem.transitionTo, rows);
      updateDots(currentFrame, currentItem.lockedPrefixEnd || 0);
      if (progress >= 1) { currentFrame = currentItem.frame; updateDots(currentFrame); phase = "hold"; phaseStarted = now; }
    }
    requestAnimationFrame(draw);
  }
  async function refreshStats(showUnchanged = false) {
    try { const statsPath = document.querySelector('meta[name="stats-url"]')?.content || "../data/stats.json"; const url = new URL(statsPath, location.href); url.searchParams.set("_", String(Date.now())); const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const incoming = await response.json(); if (!incoming || typeof incoming.platforms !== "object") throw new Error("stats.json neturi platforms objekto");
      const sig = JSON.stringify(incoming), changed = sig !== lastReadSignature; stats = incoming; lastReadSignature = sig; els.loadError.hidden = true; els.loadError.textContent = ""; renderMode();
      if (changed) rebuildSequence(); if (currentItem) setStatus(currentItem); if (!changed && showUnchanged) { els.loadError.hidden = false; els.loadError.textContent = "Duomenys perskaityti iš naujo; stats.json nepasikeitė."; setTimeout(() => { els.loadError.hidden = true; }, 2200); }
    } catch (err) { els.loadError.hidden = false; els.loadError.textContent = `Nepavyko perskaityti stats.json: ${err.message}`; if (currentItem && stats) setStatus(currentItem); }
  }
  function wireControls() {
    for (const [input, output, key, suffix] of [[els.changeDurationInput, els.changeDurationOutput, "changeSeconds", " s"], [els.mainDurationInput, els.mainDurationOutput, "mainSeconds", " s"], [els.transitionInput, els.transitionOutput, "transitionMs", " ms"], [els.brightnessInput, els.brightnessOutput, "brightness", "%"]]) {
      input.value = settings[key]; updateRange(input, output, suffix); input.addEventListener("input", () => { settings[key] = Number(input.value); updateRange(input, output, suffix); if (key === "brightness") document.documentElement.style.setProperty("--brightness", String(settings.brightness / 100)); saveSettings(); });
    }
    document.documentElement.style.setProperty("--brightness", String(settings.brightness / 100)); els.formatInput.value = settings.format; els.fontInput.value = settings.font; els.unknownChangeInput.checked = settings.showChange; els.channelViewsInput.checked = settings.channelViews; renderOrder();
    els.formatInput.addEventListener("change", () => { settings.format = els.formatInput.value; saveSettings(); renderChips(); rebuildSequence(); });
    els.fontInput.addEventListener("change", () => { settings.font = els.fontInput.value; Matrix.setFont(settings.font); saveSettings(); rebuildSequence(); });
    els.unknownChangeInput.addEventListener("change", () => { settings.showChange = els.unknownChangeInput.checked; saveSettings(); rebuildSequence(); });
    els.channelViewsInput.addEventListener("change", () => { settings.channelViews = els.channelViewsInput.checked; saveSettings(); rebuildSequence(); });
    els.demoInput.addEventListener("change", () => { renderMode(); rebuildSequence(); });
    els.staleInput.addEventListener("change", renderChips); els.errorInput.addEventListener("change", () => { renderChips(); rebuildSequence(); });
    els.refreshButton.addEventListener("click", () => refreshStats(true)); els.refreshTextButton.addEventListener("click", () => refreshStats(true));
  }
  const refreshMs = Math.max(3000, Number(document.querySelector('meta[name="stats-refresh-ms"]')?.content) || 3000);
  wireControls(); refreshStats(); setInterval(() => refreshStats(false), refreshMs); requestAnimationFrame(draw);
})();
