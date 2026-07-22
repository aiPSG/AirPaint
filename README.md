# AirPaint

Paint in the air with your index finger, using only your webcam. Runs fully
in the browser — no backend — so it can be hosted on GitHub Pages.

## How it works

- [MediaPipe HandLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  (loaded from CDN) tracks 21 hand landmarks from the webcam feed in real time.
- The index fingertip position is smoothed and drawn onto a 2D canvas layered
  over the mirrored video.
- Strokes, drips, and eraser passes are stored individually, so Undo/Clear
  work per stroke and the canvas can be replayed deterministically.

## Gestures

| Gesture | Effect |
| --- | --- |
| **Point** (index finger up, others curled) | Paint |
| **Hold still** while pointing (≥ 1 s) | Paint starts dripping from the brush |
| **Fist** | Pause painting |
| **Spread hand** (all fingers extended) | The whole palm becomes an eraser |

## Controls

| Control | Effect |
| --- | --- |
| Color | Brush color |
| Size | Brush stroke width (1–100) |
| Brush | Brush style (see below) |
| Hold drip | Intensity of dripping while holding the finger still (0 = off) |
| Drip | Intensity of ambient dripping from existing paint (0 = off) |
| Background | Background color used for saved images and recordings |
| Undo / Clear | Remove the last stroke / wipe the canvas |
| Save PNG | Download the painting composited over the background color |
| Record | Start/stop recording the painting as a movie (WebM, MP4 on Safari) |
| Start camera | Toggle the webcam on/off |

## Brush styles

Solid, Paint brush (bristle texture), Spray paint, Gooey slime, Steam,
Toothpaste, Neon glow, Rainbow, and Pixel. Two internal brushes (drip,
eraser) power the drip system and the palm eraser.

## Run locally

Serve the folder with any static server (ES modules don't load from `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

The app is a plain static site — no build step. In the repository settings,
enable **Pages → Deploy from a branch** and pick the branch containing these
files (root folder). Webcam access requires HTTPS, which GitHub Pages
provides.

## Adding brush styles

Implement the brush interface in `js/brushes.js` (`drawSegment(ctx, from,
to, settings, segIndex)` + `drawDot`), register it in the `BRUSHES` map, and
add an `<option>` to the brush selector in `index.html`. Use
`segRng(seed, segIndex)` for randomness so strokes replay identically on
undo/redraw.
