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
const colorInput = document.getElementById("brushColor");
const sizeInput = document.getElementById("brushSize");
const styleSelect = document.getElementById("brushStyle");

const SMOOTHING = 0.45; // low-pass factor: higher = snappier, lower = smoother
const MIN_SEGMENT_PX = 2; // ignore jitter below this distance

const tracker = new HandTracker();
let stream = null;
let running = false;
let rafId = null;

// Strokes are kept so Undo can replay the canvas. Each stroke:
// {brush, color, size, points: [{x, y}, ...]} in canvas pixels.
let strokes = [];
let activeStroke = null;
let smoothedTip = null;

function setStatus(message) {
  statusText.textContent = message;
  statusBanner.classList.remove("hidden");
}

function hideStatus() {
  statusBanner.classList.add("hidden");
}

function currentSettings() {
  return {
    brush: styleSelect.value,
    color: colorInput.value,
    size: Number(sizeInput.value),
  };
}

function resizeCanvases() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 960;
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
    const settings = { color: stroke.color, size: stroke.size };
    if (stroke.points.length === 1) {
      brush.drawDot(paintCtx, stroke.points[0], settings);
      continue;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      brush.drawSegment(paintCtx, stroke.points[i - 1], stroke.points[i], settings);
    }
  }
}

function beginStroke(point) {
  const settings = currentSettings();
  activeStroke = { ...settings, points: [point] };
  strokes.push(activeStroke);
  getBrush(settings.brush).drawDot(paintCtx, point, settings);
}

function extendStroke(point) {
  const last = activeStroke.points[activeStroke.points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_SEGMENT_PX) return;
  activeStroke.points.push(point);
  getBrush(activeStroke.brush).drawSegment(paintCtx, last, point, activeStroke);
}

function endStroke() {
  activeStroke = null;
}

function drawCursor(point, penDown) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!point) return;
  const size = Number(sizeInput.value);
  overlayCtx.beginPath();
  overlayCtx.arc(point.x, point.y, Math.max(size / 2, 6), 0, Math.PI * 2);
  if (penDown) {
    overlayCtx.fillStyle = colorInput.value;
    overlayCtx.globalAlpha = 0.85;
    overlayCtx.fill();
    overlayCtx.globalAlpha = 1;
  } else {
    overlayCtx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    overlayCtx.lineWidth = 2;
    overlayCtx.stroke();
  }
}

function loop() {
  if (!running) return;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const detection = tracker.detect(video, performance.now());
    if (detection) {
      const raw = {
        x: detection.tip.x * paintCanvas.width,
        y: detection.tip.y * paintCanvas.height,
      };
      smoothedTip = smoothedTip
        ? {
            x: smoothedTip.x + (raw.x - smoothedTip.x) * SMOOTHING,
            y: smoothedTip.y + (raw.y - smoothedTip.y) * SMOOTHING,
          }
        : raw;

      if (detection.penDown) {
        if (activeStroke) extendStroke(smoothedTip);
        else beginStroke({ ...smoothedTip });
      } else {
        endStroke();
      }
      drawCursor(smoothedTip, detection.penDown);
    } else {
      smoothedTip = null;
      endStroke();
      drawCursor(null, false);
    }
  }
  rafId = requestAnimationFrame(loop);
}

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
    loop();
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
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  endStroke();
  smoothedTip = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  video.srcObject = null;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  cameraToggle.textContent = "Start camera";
  if (showMessage) setStatus("Camera stopped. Click “Start camera” to resume.");
}

cameraToggle.addEventListener("click", () => {
  if (running) stopCamera();
  else startCamera();
});

clearBtn.addEventListener("click", () => {
  strokes = [];
  activeStroke = null;
  redrawStrokes();
});

undoBtn.addEventListener("click", () => {
  if (activeStroke) {
    activeStroke = null;
  }
  strokes.pop();
  redrawStrokes();
});

if (!navigator.mediaDevices?.getUserMedia) {
  setStatus("This browser does not support webcam access.");
  cameraToggle.disabled = true;
}
