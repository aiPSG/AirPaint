/**
 * Thin wrapper around MediaPipe's HandLandmarker.
 *
 * detect(video, timestamp) returns the mirrored index-fingertip and palm
 * positions (normalized 0..1) plus the recognized gesture:
 *   - "paint": index finger extended, middle + ring curled  -> pen down
 *   - "erase": all four fingers extended (open, spread hand) -> eraser
 *   - "fist":  all four fingers curled                       -> pen up
 *   - "idle":  anything else                                 -> pen up
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
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

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
   * @returns {null | {tip, palm, span, gesture}}
   *   tip / palm are normalized (0..1) and already mirrored horizontally to
   *   match the mirrored video preview. span is the normalized distance
   *   between index and pinky knuckles (a proxy for on-screen hand size).
   */
  detect(video, timestampMs) {
    if (!this.landmarker) return null;
    const result = this.landmarker.detectForVideo(video, timestampMs);
    const lm = result.landmarks?.[0];
    if (!lm) return null;

    const indexUp = isExtended(lm, INDEX_TIP, INDEX_PIP);
    const middleUp = isExtended(lm, MIDDLE_TIP, MIDDLE_PIP);
    const ringUp = isExtended(lm, RING_TIP, RING_PIP);
    const pinkyUp = isExtended(lm, PINKY_TIP, PINKY_PIP);

    let gesture = "idle";
    if (indexUp && middleUp && ringUp && pinkyUp) gesture = "erase";
    else if (indexUp && !middleUp && !ringUp) gesture = "paint";
    else if (!indexUp && !middleUp && !ringUp && !pinkyUp) gesture = "fist";

    const palmPoints = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
    const palm = palmPoints.reduce(
      (acc, i) => ({ x: acc.x + lm[i].x / palmPoints.length, y: acc.y + lm[i].y / palmPoints.length }),
      { x: 0, y: 0 }
    );

    return {
      tip: { x: 1 - lm[INDEX_TIP].x, y: lm[INDEX_TIP].y },
      palm: { x: 1 - palm.x, y: palm.y },
      span: dist(lm[INDEX_MCP], lm[PINKY_MCP]),
      gesture,
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
