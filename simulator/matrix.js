(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Matrix32x8 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const WIDTH = 32, HEIGHT = 8, LEFT_MARGIN = 1, GLYPH_W = 3, GLYPH_H = 5, GAP = 1;
  // Five-row, three-column bitmap glyphs, encoded one row per string.
  const FONT = {
    " ":["000","000","000","000","000"], A:["010","101","111","101","101"], B:["110","101","110","101","110"],
    C:["011","100","100","100","011"], D:["110","101","101","101","110"], E:["111","100","110","100","111"],
    F:["111","100","110","100","100"], G:["011","100","101","101","011"], H:["101","101","111","101","101"],
    I:["111","010","010","010","111"], J:["001","001","001","101","010"], K:["101","101","110","101","101"],
    L:["100","100","100","100","111"], M:["101","111","111","101","101"], N:["101","111","111","111","101"],
    O:["010","101","101","101","010"], P:["110","101","110","100","100"], Q:["010","101","101","111","011"],
    R:["110","101","110","101","101"], S:["011","100","010","001","110"], T:["111","010","010","010","010"],
    U:["101","101","101","101","111"], V:["101","101","101","101","010"], W:["101","101","111","111","101"],
    X:["101","101","010","101","101"], Y:["101","101","010","010","010"], Z:["111","001","010","100","111"],
    "0":["111","101","101","101","111"], "1":["010","110","010","010","111"], "2":["110","001","010","100","111"],
    "3":["110","001","010","001","110"], "4":["101","101","111","001","001"], "5":["111","100","110","001","110"],
    "6":["011","100","110","101","010"], "7":["111","001","010","010","010"], "8":["010","101","010","101","010"],
    "9":["010","101","011","001","110"], "+":["000","010","111","010","000"], "-":["000","000","111","000","000"],
    ".":["000","000","000","000","010"], ":":["000","010","000","010","000"], "/":["001","001","010","100","100"],
    "?":["110","001","010","000","010"]
  };

  function formatValue(value, mode = "auto") {
    if (value === null || value === undefined || value === "") return "--";
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value).toUpperCase();
    if (mode === "exact" || Math.abs(n) < 1000) return String(Math.round(n));
    const abs = Math.abs(n), [unit, divisor] = abs >= 1e6 ? ["M", 1e6] : ["K", 1e3], scaled = abs / divisor;
    const decimals = unit === "M" ? (scaled < 10 ? 2 : scaled < 100 ? 1 : 0) : (scaled < 10 ? 1 : 0);
    return `${(n / divisor).toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}${unit}`;
  }
  function formatDelta(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
    const n = Math.round(Number(value));
    return n > 0 ? `+${n}` : String(n);
  }
  function buildMessage(code, value, options = {}) {
    if (options.error) return `${code} ERR`;
    if (options.change) return `${code} ${formatDelta(value)}`;
    if (value === null || value === undefined) return `${code} ERR`;
    return `${code} ${formatValue(value, options.format || "auto")}`;
  }
  function sequenceIndex(elapsedMs, durationMs, itemCount) { return itemCount > 0 ? Math.floor(Math.max(0, elapsedMs) / Math.max(1, durationMs)) % itemCount : 0; }
  function metricFromStats(data, platform, metricName) {
    const record = data?.platforms?.[platform], metric = record?.metrics?.[metricName];
    if (metric && typeof metric === "object" && Object.hasOwn(metric, "value")) return metric;
    if (metric !== undefined && metric !== null) return { value: metric, status: "ok", fetched_at: record?.fetched_at, source: record?.source_url };
    return { value: null, status: "unavailable", fetched_at: record?.fetched_at, source: record?.source_url, error: "Metrika nepateikta" };
  }
  function textWidth(text) { const n = String(text).length; return n ? LEFT_MARGIN + n * GLYPH_W + (n - 1) * GAP : LEFT_MARGIN; }
  function patternFor(text) {
    const normalized = String(text).toUpperCase(), width = Math.max(0, normalized.length ? normalized.length * (GLYPH_W + GAP) - GAP : 0);
    const rows = Array.from({ length: GLYPH_H }, () => Array(width).fill(false));
    [...normalized].forEach((char, i) => (FONT[char] || FONT["?"]).forEach((row, y) => [...row].forEach((bit, x) => { rows[y][i * (GLYPH_W + GAP) + x] = bit === "1"; })));
    return rows;
  }
  function frameFor(pattern, offset = 0) {
    const textCols = pattern[0]?.length || 0, frame = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    const maxOffset = Math.max(0, textCols + LEFT_MARGIN - WIDTH);
    const scroll = maxOffset ? Math.max(0, Math.min(maxOffset, Math.floor(offset))) : 0;
    for (let y = 0; y < GLYPH_H; y++) for (let sx = 0; sx < textCols; sx++) {
      const x = LEFT_MARGIN + sx - scroll;
      if (x > 0 && x < WIDTH && pattern[y][sx]) frame[y + 1][x] = true;
    }
    return frame;
  }
  function labelRegionStart(code) { return LEFT_MARGIN + (String(code).length + 1) * (GLYPH_W + GAP); }
  function drawPattern(frame, pattern, startX, leftBound, rightBound, offset = 0) {
    const cols = pattern[0]?.length || 0;
    const maxOffset = Math.max(0, cols - (rightBound - leftBound));
    const scroll = Math.max(0, Math.min(maxOffset, Math.floor(offset)));
    for (let sy = 0; sy < GLYPH_H; sy++) for (let sx = scroll; sx < cols; sx++) {
      const x = startX + sx - scroll;
      if (x >= leftBound && x < rightBound && pattern[sy][sx]) frame[sy + 1][x] = true;
    }
    return scroll;
  }
  function labeledFrame(code, valueText, offset = 0) {
    const frame = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    const prefix = `${code} `, startX = labelRegionStart(code);
    drawPattern(frame, patternFor(prefix), LEFT_MARGIN, LEFT_MARGIN, startX);
    const pattern = patternFor(valueText);
    const maxOffset = Math.max(0, pattern[0].length - (WIDTH - startX));
    drawPattern(frame, pattern, startX, startX, WIDTH, Math.min(offset, maxOffset));
    return frame;
  }
  function verticalTransitionFrame(oldFrame, newFrame, step) {
    const rows = Math.max(0, Math.min(HEIGHT, Math.round(step)));
    const frame = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    for (let y = 0; y < HEIGHT; y++) for (let x = 1; x < WIDTH; x++) {
      const oldY = y - rows, newY = y + HEIGHT - rows;
      frame[y][x] = (oldY >= 0 && oldY < HEIGHT && Boolean(oldFrame[oldY]?.[x])) || (newY >= 0 && newY < HEIGHT && Boolean(newFrame[newY]?.[x]));
    }
    return frame;
  }
  function verticalTransitionRegion(oldFrame, newFrame, step, regionStartX) {
    const rows = Math.max(0, Math.min(HEIGHT, Math.round(step)));
    const start = Math.max(1, Math.min(WIDTH, Math.floor(regionStartX)));
    const frame = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    for (let y = 0; y < HEIGHT; y++) for (let x = 1; x < WIDTH; x++) {
      if (x < start) { frame[y][x] = Boolean(oldFrame[y]?.[x]); continue; }
      const oldY = y - rows, newY = y + HEIGHT - rows;
      frame[y][x] = (oldY >= 0 && oldY < HEIGHT && Boolean(oldFrame[oldY]?.[x])) || (newY >= 0 && newY < HEIGHT && Boolean(newFrame[newY]?.[x]));
    }
    return frame;
  }
  function makePlatformFrames(code, metric, options = {}) {
    const frames = [], change = metric?.change_24h;
    const changeValue = change && typeof change === "object" && Object.hasOwn(change, "value") ? change.value : change;
    if (options.showChange !== false) frames.push({ kind: "change", text: buildMessage(code, changeValue, { change: true }) });
    if (metric?.value === null || metric?.value === undefined) frames.push({ kind: "current", text: `${code} ERR` });
    else frames.push({ kind: "current", text: buildMessage(code, metric.value, { format: options.format || "auto" }) });
    return frames.map((frame) => ({ ...frame, width: textWidth(frame.text), pattern: patternFor(frame.text) }));
  }
  return { WIDTH, HEIGHT, LEFT_MARGIN, GLYPH_W, GLYPH_H, GAP, FONT, formatValue, formatDelta, buildMessage, sequenceIndex, metricFromStats, textWidth, patternFor, frameFor, labelRegionStart, labeledFrame, verticalTransitionFrame, verticalTransitionRegion, makePlatformFrames };
});
