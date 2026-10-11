"use strict";
// Classic worker permits MediaPipe's WASM loader to use importScripts.
let face, pose;
const base = new URL("vendor/mediapipe/", self.location.href);
const mean = (a, b) => ({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
function features(faces, poses, aspect) {
  const result = {faceCount: faces.length, body:null};
  if (faces.length !== 1) return result;
  const f = faces[0], left = f[33], right = f[263], eyeCenter = mean(left,right);
  const faceWidth = Math.abs(f[454].x - f[234].x);
  const faceHeight = Math.abs(f[152].y - f[10].y);
  const x = (f[454].x + f[234].x) / 2, y = (f[152].y + f[10].y) / 2;
  const eyeRatio = (a, b, iris) => {
    const dx = b.x - a.x, dy = (b.y - a.y) / aspect;
    return ((iris.x - a.x) * dx + (iris.y - a.y) / aspect * dy) / Math.max(.00001, dx*dx + dy*dy);
  };
  result.framed = faceWidth > .13 && faceWidth < .62 && x > .23 && x < .77 && y > .2 && y < .72;
  result.yaw = (f[1].x - f[234].x) / Math.max(.01, faceWidth);
  result.pitch = (f[1].y - eyeCenter.y) / Math.max(.01, faceHeight);
  result.eyesOpen = Math.abs(f[159].y-f[145].y) / aspect / Math.max(.001,Math.abs(f[33].x-f[133].x)) > .13 &&
    Math.abs(f[386].y-f[374].y) / aspect / Math.max(.001,Math.abs(f[362].x-f[263].x)) > .13;
  result.gaze = (eyeRatio(f[33],f[133],f[468]) + eyeRatio(f[362],f[263],f[473])) / 2;
  const p = poses[0];
  if (p && [p[11],p[12]].every(point => point.visibility > .7)) {
    const center = mean(p[11],p[12]);
    const scale = Math.hypot(p[11].x-p[12].x,(p[11].y-p[12].y)/aspect);
    if (scale > .1) result.body = {center:{x:center.x,y:center.y/aspect},scale,
      wrists:[15,16].map(i => p[i].visibility > .7 ? {x:(p[i].x-center.x)/scale,y:(p[i].y-center.y)/aspect/scale} : null)};
  }
  return result;
}
self.onmessage = async event => {
  const {type, frame, timestamp} = event.data;
  try {
    if (type === "init") {
      const {FilesetResolver, FaceLandmarker, PoseLandmarker} = await import(new URL("vision_bundle.mjs",base).href);
      const files = await FilesetResolver.forVisionTasks(new URL("wasm",base).href);
      face = await FaceLandmarker.createFromOptions(files, {baseOptions:{modelAssetPath:new URL("models/face_landmarker.task",base).href,delegate:"CPU"},runningMode:"VIDEO",numFaces:2,minFaceDetectionConfidence:.65,minFacePresenceConfidence:.65,minTrackingConfidence:.65});
      pose = await PoseLandmarker.createFromOptions(files, {baseOptions:{modelAssetPath:new URL("models/pose_landmarker_lite.task",base).href,delegate:"CPU"},runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.65,minPosePresenceConfidence:.65,minTrackingConfidence:.65});
      self.postMessage({type:"ready"});
    } else if (type === "frame" && face && pose) {
      const faces = face.detectForVideo(frame,timestamp).faceLandmarks;
      const poses = pose.detectForVideo(frame,timestamp).landmarks;
      self.postMessage({type:"sample",timestamp,features:features(faces,poses,frame.width/frame.height)});
    }
  } catch {
    self.postMessage({type:"error"});
  } finally { frame?.close(); }
};
