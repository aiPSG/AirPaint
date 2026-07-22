import { HandTracker } from "./tracker.js";
import { getBrush } from "./brushes.js";

const video = document.getElementById("webcam");
const paintCanvas = document.getElementById("paintCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const paintCtx = paintCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

const statusBanner = document.getElementById("statusBanner");
const statusText = document.getElementById("statusText");
const cameraToggle = document.getElementById("cameraToggle");
const clearBtn = document.getElementById("clearBtn");
const undoBtn = document.getElementById("undoBtn");
const saveBtn = document.getElementById("saveBtn");
const recordBtn = document.getElementById("recordBtn");
const colorInput = document.getElementById("brushColor");
const bgColorInput = document.getElementById("bgColor");
const sizeInput = document.getElementById("brushSize");
const styleSelect = document.getElementById("brushStyle");
const holdDripInput = document.getElementById("holdDrip");
const ambientDripInput = document.getElementById("ambientDrip");

const SMOOTHING = 0.45; // low-pass factor: higher = snappier, lower = smoother
const MIN_SEGMENT_PX = 2; // ignore jitter below this distance
const HOLD_MOVE_PX = 14; // finger counts as "still" while inside this radius
const HOLD_DELAY_MS = 1000; // hold this long before the paint starts dripping
const HOLD_DRIPS_PER_SEC = 6; // spawn rate at maximum hold-drip intensity
const AMBIENT_DRIPS_PER_SEC = 3; // spawn rate at maximum ambient intensity
const MAX_ACTIVE_DRIPS = 200;

const tracker = new HandTracker();
let stream = null;
let running = false;

// Strokes are kept so Undo/resize can replay the canvas. Each stroke:
// {brush, color, size, seed, points: [{x, y}, ...]} in canvas pixels.
// Drips and eraser passes are strokes too (brush "drip" / "eraser").
let strokes = [];
let activeStroke = null;
let eraserStroke = null;
let smoothedTip = null;
let smoothedPalm = null;

// Active drips animate over time; each references the stroke it extends.
let drips = [];
let holdState = null;
let holdBudget = 0;
let ambientBudget = 0;
let lastFrameTime = performance.now();

let recorder = null;
let recordChunks = [];
let recording = false;
const recordCanvas = document.createElement("canvas");
const recordCtx = recordCanvas.getContext("2d");

function randSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

function setStatus(message) {
  statusText.textContent = message;
  statusBanner.classList.remove("hidden");
}

function hideStatus() {
  statusBanner.classList.add("hidden");
}

function flashStatus(message, ms = 2500) {
  setStatus(message);
  setTimeout(() => {
    if (statusText.textContent === message) hideStatus();
  }, ms);
}

function resizeCanvases() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  for (const canvas of [paintCanvas, overlayCanvas]) {
    canvas.width = w;
    canvas.height = h;
  }
  redrawStrokes();
}

function redrawStrokes() {
  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  for (const stroke of strokes) {
    const brush = getBrush(stroke.brush);
    if (stroke.points.length === 1) {
      brush.drawDot(paintCtx, stroke.points[0], stroke);
      continue;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      brush.drawSegment(paintCtx, stroke.points[i - 1], stroke.points[i], stroke, i - 1);
    }
  }
}

function beginStroke(point) {
  activeStroke = {
    brush: styleSelect.value,
    color: colorInput.value,
    size: Number(sizeInput.value),
    seed: randSeed(),
    points: [point],
  };
  strokes.push(activeStroke);
  getBrush(activeStroke.brush).drawDot(paintCtx, point, activeStroke);
}

function extendStroke(point) {
  const last = activeStroke.points[activeStroke.points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_SEGMENT_PX) return;
  activeStroke.points.push({ ...point });
  getBrush(activeStroke.brush).drawSegment(
    paintCtx, last, point, activeStroke, activeStroke.points.length - 2
  );
}

function endStroke() {
  activeStroke = null;
}

function beginErase(point, radiusPx) {
  eraserStroke = {
    brush: "eraser",
    color: "#000000",
    size: radiusPx * 2,
    seed: randSeed(),
    points: [point],
  };
  strokes.push(eraserStroke);
  getBrush("eraser").drawDot(paintCtx, point, eraserStroke);
}

function extendErase(point) {
  const last = eraserStroke.points[eraserStroke.points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_SEGMENT_PX) return;
  eraserStroke.points.push({ ...point });
  getBrush("eraser").drawSegment(
    paintCtx, last, point, eraserStroke, eraserStroke.points.length - 2
  );
}

function endErase() {
  eraserStroke = null;
}

// --- Drips ---------------------------------------------------------------

function spawnDrip(x, y, color, width, intensity) {
  if (drips.length >= MAX_ACTIVE_DRIPS) return;
  const stroke = { brush: "drip", color, size: width, seed: randSeed(), points: [{ x, y }] };
  strokes.push(stroke);
  drips.push({
    stroke,
    x,
    y,
    vy: 25 + Math.random() * 35,
    travel: (25 + intensity) * (0.6 + Math.random() * 0.9),
  });
}

function updateHoldDrip(now, dt) {
  if (
    !holdState ||
    Math.hypot(smoothedTip.x - holdState.x, smoothedTip.y - holdState.y) > HOLD_MOVE_PX
  ) {
    holdState = { x: smoothedTip.x, y: smoothedTip.y, since: now };
    holdBudget = 0;
    return;
  }
  const intensity = Number(holdDripInput.value);
  if (intensity <= 0 || now - holdState.since < HOLD_DELAY_MS) return;
  holdBudget += dt * (intensity / 100) * HOLD_DRIPS_PER_SEC;
  while (holdBudget >= 1) {
    holdBudget -= 1;
    const size = Number(sizeInput.value);
    spawnDrip(
      smoothedTip.x + (Math.random() - 0.5) * size,
      smoothedTip.y,
      colorInput.value,
      Math.max(2, size * 0.3),
      intensity
    );
  }
}

function updateAmbientDrip(dt) {
  const intensity = Number(ambientDripInput.value);
  if (intensity <= 0) return;
  const sources = strokes.filter(
    (s) => s.brush !== "eraser" && s.brush !== "drip" && s.points.length > 0
  );
  if (!sources.length) return;
  ambientBudget += dt * (intensity / 100) * AMBIENT_DRIPS_PER_SEC;
  while (ambientBudget >= 1) {
    ambientBudget -= 1;
    const s = sources[(Math.random() * sources.length) | 0];
    const p = s.points[(Math.random() * s.points.length) | 0];
    spawnDrip(p.x, p.y, s.color, Math.max(2, s.size * 0.25), intensity);
  }
}

function updateDrips(dt) {
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];
    const step = d.vy * dt;
    d.vy = Math.min(d.vy + 80 * dt, 170);
    d.x += (Math.random() - 0.5) * 0.8;
    d.y += step;
    d.travel -= step;
    const pts = d.stroke.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(d.x - last.x, d.y - last.y) >= 1.5) {
      const point = { x: d.x, y: d.y };
      pts.push(point);
      getBrush("drip").drawSegment(paintCtx, last, point, d.stroke, pts.length - 2);
    }
    if (d.travel <= 0 || d.y > paintCanvas.height) drips.splice(i, 1);
  }
}

// --- Detection & main loop -----------------------------------------------

function ema(prev, next) {
  return prev
    ? { x: prev.x + (next.x - prev.x) * SMOOTHING, y: prev.y + (next.y - prev.y) * SMOOTHING }
    : next;
}

function handleDetection(now, dt) {
  const det = tracker.detect(video, now);
  if (!det) {
    endStroke();
    endErase();
    holdState = null;
    smoothedTip = null;
    smoothedPalm = null;
    drawCursor(null);
    return;
  }

  smoothedTip = ema(smoothedTip, {
    x: det.tip.x * paintCanvas.width,
    y: det.tip.y * paintCanvas.height,
  });
  smoothedPalm = ema(smoothedPalm, {
    x: det.palm.x * paintCanvas.width,
    y: det.palm.y * paintCanvas.height,
  });

  if (det.gesture === "paint") {
    endErase();
    if (activeStroke) extendStroke(smoothedTip);
    else beginStroke({ ...smoothedTip });
    updateHoldDrip(now, dt);
    drawCursor({ point: smoothedTip, mode: "paint" });
  } else if (det.gesture === "erase") {
    endStroke();
    holdState = null;
    if (eraserStroke) extendErase(smoothedPalm);
    else beginErase({ ...smoothedPalm }, Math.max(30, det.span * paintCanvas.width * 0.7));
    drawCursor({ point: smoothedPalm, mode: "erase", radius: eraserStroke.size / 2 });
  } else {
    endStroke();
    endErase();
    holdState = null;
    drawCursor({ point: smoothedTip, mode: det.gesture }); // "fist" | "idle"
  }
}

function drawCursor(info) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!info || !info.point) return;
  const { point, mode } = info;
  overlayCtx.beginPath();
  if (mode === "paint") {
    overlayCtx.arc(point.x, point.y, Math.max(Number(sizeInput.value) / 2, 6), 0, Math.PI * 2);
    overlayCtx.fillStyle = colorInput.value;
    overlayCtx.globalAlpha = 0.85;
    overlayCtx.fill();
    overlayCtx.globalAlpha = 1;
  } else if (mode === "erase") {
    overlayCtx.arc(point.x, point.y, info.radius, 0, Math.PI * 2);
    overlayCtx.fillStyle = "rgba(255,255,255,0.15)";
    overlayCtx.fill();
    overlayCtx.strokeStyle = "rgba(255,255,255,0.9)";
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([8, 6]);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
  } else {
    overlayCtx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    overlayCtx.strokeStyle =
      mode === "fist" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)";
    overlayCtx.lineWidth = 2;
    overlayCtx.stroke();
  }
}

function loop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  if (running && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    handleDetection(now, dt);
  }
  updateAmbientDrip(dt);
  updateDrips(dt);
  if (recording) renderRecordFrame();
  requestAnimationFrame(loop);
}

// --- Camera --------------------------------------------------------------

async function startCamera() {
  cameraToggle.disabled = true;
  try {
    setStatus("Loading hand-tracking model…");
    if (!tracker.landmarker) await tracker.init();

    setStatus("Requesting webcam access…");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });
    await video.play();

    resizeCanvases();
    hideStatus();
    running = true;
    cameraToggle.textContent = "Stop camera";
  } catch (err) {
    console.error(err);
    if (err.name === "NotAllowedError") {
      setStatus("Webcam access was denied. Allow camera access and try again.");
    } else if (err.name === "NotFoundError") {
      setStatus("No webcam found. Connect a camera and try again.");
    } else {
      setStatus(`Could not start: ${err.message}`);
    }
    stopCamera(false);
  } finally {
    cameraToggle.disabled = false;
  }
}

function stopCamera(showMessage = true) {
  running = false;
  endStroke();
  endErase();
  holdState = null;
  smoothedTip = null;
  smoothedPalm = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  video.srcObject = null;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  cameraToggle.textContent = "Start camera";
  if (showMessage) setStatus("Camera stopped. Click “Start camera” to resume.");
}

// --- Save & record -------------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function savePainting() {
  const out = document.createElement("canvas");
  out.width = paintCanvas.width;
  out.height = paintCanvas.height;
  const octx = out.getContext("2d");
  octx.fillStyle = bgColorInput.value;
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(paintCanvas, 0, 0);
  out.toBlob((blob) => downloadBlob(blob, `airpaint-${Date.now()}.png`), "image/png");
}

function renderRecordFrame() {
  recordCtx.fillStyle = bgColorInput.value;
  recordCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
  recordCtx.drawImage(paintCanvas, 0, 0, recordCanvas.width, recordCanvas.height);
}

function startRecording() {
  if (typeof MediaRecorder === "undefined") {
    flashStatus("This browser does not support video recording.");
    return;
  }
  recordCanvas.width = paintCanvas.width;
  recordCanvas.height = paintCanvas.height;
  renderRecordFrame();
  const mime = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(
    recordCanvas.captureStream(30),
    mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined
  );
  recordChunks = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) recordChunks.push(e.data);
  };
  rec.onstop = () => {
    const type = rec.mimeType || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    downloadBlob(new Blob(recordChunks, { type }), `airpaint-${Date.now()}.${ext}`);
    recordChunks = [];
  };
  rec.start(250);
  recorder = rec;
  recording = true;
  recordBtn.textContent = "Stop recording";
  recordBtn.classList.add("recording");
}

function stopRecording() {
  recording = false;
  recorder?.stop();
  recorder = null;
  recordBtn.textContent = "Record";
  recordBtn.classList.remove("recording");
}

// --- Wiring --------------------------------------------------------------

cameraToggle.addEventListener("click", () => {
  if (running) stopCamera();
  else startCamera();
});

clearBtn.addEventListener("click", () => {
  strokes = [];
  drips = [];
  activeStroke = null;
  eraserStroke = null;
  redrawStrokes();
});

undoBtn.addEventListener("click", () => {
  activeStroke = null;
  eraserStroke = null;
  const removed = strokes.pop();
  drips = drips.filter((d) => d.stroke !== removed);
  redrawStrokes();
});

saveBtn.addEventListener("click", savePainting);
recordBtn.addEventListener("click", () => {
  if (recording) stopRecording();
  else startRecording();
});

if (!navigator.mediaDevices?.getUserMedia) {
  setStatus("This browser does not support webcam access.");
  cameraToggle.disabled = true;
}

resizeCanvases();
requestAnimationFrame(loop);
