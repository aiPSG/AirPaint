# AirPaint

Paint in the air with your index finger, using only your webcam. Runs fully
in the browser — no backend — so it can be hosted on GitHub Pages.

## How it works

- [MediaPipe HandLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  (loaded from CDN) tracks 21 hand landmarks from the webcam feed in real time.
- The index fingertip position is smoothed and drawn onto a 2D canvas layered
  over the mirrored video.
- **Point** (index finger extended, other fingers curled) to paint; **open
  your hand** to lift the brush and move without drawing.
- Strokes are stored individually, so Undo/Clear work per stroke.

## Controls

| Control | Effect |
| --- | --- |
| Color | Brush color |
| Size | Brush stroke width |
| Brush | Brush style (solid for now; more styles pluggable via `js/brushes.js`) |
| Undo / Clear | Remove the last stroke / wipe the canvas |
| Start camera | Toggle the webcam on/off |

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

Implement the brush interface in `js/brushes.js` (`drawSegment` +
`drawDot`), register it in the `BRUSHES` map, and add an `<option>` to the
brush selector in `index.html`.
