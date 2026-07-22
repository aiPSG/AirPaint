/**
 * Thin wrapper around MediaPipe's HandLandmarker.
 *
 * Exposes a single detect(video, timestamp) call that returns the mirrored
 * index-fingertip position (normalized 0..1 coordinates) plus whether the
 * hand is in the "pointing" pose used as pen-down.
 */

// Imported dynamically in init() so a CDN outage surfaces as a catchable
// error in the UI instead of breaking the whole module graph.
const TASKS_VISION_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const WASM_URL = `${TASKS_VISION_URL}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Landmark indices (see MediaPipe hand landmark model docs).
const WRIST = 0;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A finger counts as extended when its tip is clearly farther from the
 *  wrist than its PIP joint, which works regardless of hand rotation. */
function isExtended(landmarks, tip, pip) {
  return dist(landmarks[tip], landmarks[WRIST]) >
    dist(landmarks[pip], landmarks[WRIST]) * 1.1;
}

export class HandTracker {
  constructor() {
    this.landmarker = null;
  }

  async init() {
    const { FilesetResolver, HandLandmarker } = await import(TASKS_VISION_URL);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      this.landmarker = await HandLandmarker.createFromOptions(vision, options);
    }
  }

  /**
   * @returns {null | {tip: {x, y}, penDown: boolean}}
   *   tip is normalized (0..1) and already mirrored horizontally to match
   *   the mirrored video preview.
   */
  detect(video, timestampMs) {
    if (!this.landmarker) return null;
    const result = this.landmarker.detectForVideo(video, timestampMs);
    const landmarks = result.landmarks?.[0];
    if (!landmarks) return null;

    const indexUp = isExtended(landmarks, INDEX_TIP, INDEX_PIP);
    const middleUp = isExtended(landmarks, MIDDLE_TIP, MIDDLE_PIP);
    const ringUp = isExtended(landmarks, RING_TIP, RING_PIP);

    return {
      tip: { x: 1 - landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y },
      // Pen down while "pointing": index extended, middle and ring curled.
      penDown: indexUp && !middleUp && !ringUp,
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
