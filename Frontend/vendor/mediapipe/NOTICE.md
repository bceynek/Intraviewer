# Bundled camera-analysis assets

MediaPipe Tasks Vision 0.10.18, Google / MediaPipe authors, Apache-2.0.
See LICENSE and README.upstream.md. The browser module and four WASM runtime
files are pinned to https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/.

Model files downloaded from Google's versioned MediaPipe model distribution:
- https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

Documentation and model details:
- https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker

The application serves these files locally. It does not send camera frames to
Google or a CDN. Facial expression outputs and identity recognition are unused.
