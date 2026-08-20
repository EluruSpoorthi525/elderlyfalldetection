import { useEffect, useRef, useState, useCallback } from "react";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

export type DetectionStatus = "idle" | "loading" | "monitoring" | "alert" | "error";

export interface FallEvent {
  id: string;
  timestamp: number;
  confidence: number;
}

interface UsePoseDetectionOpts {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  sensitivity: number; // 0..1 — higher = more sensitive
  onFall: (e: FallEvent) => void;
}

// Heuristic: a fall = torso tilt becomes ~horizontal AND a fast vertical drop
// of the shoulder/hip midpoint in a short window.
export function usePoseDetection({ videoRef, canvasRef, sensitivity, onFall }: UsePoseDetectionOpts) {
  const [status, setStatus] = useState<DetectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [poseDetected, setPoseDetected] = useState(false);
  const [torsoAngle, setTorsoAngle] = useState(0); // deg from vertical
  const [verticalVelocity, setVerticalVelocity] = useState(0); // normalized units per second

  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const historyRef = useRef<{ t: number; y: number; angle: number }[]>([]);
  const lastFallTimeRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    historyRef.current = [];
    setStatus("idle");
    setPoseDetected(false);
  }, [videoRef]);

  const ensureLandmarker = useCallback(async () => {
    if (!landmarkerRef.current) {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    }
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      setStatus("loading");
      await ensureLandmarker();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.removeAttribute("src");
      video.muted = true;
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      setStatus("monitoring");
      loop();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to start camera";
      setError(msg);
      setStatus("error");
    }
  }, [videoRef, ensureLandmarker]);

  const startFile = useCallback(async (file: File) => {
    try {
      setError(null);
      setStatus("loading");
      await ensureLandmarker();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = null;
      video.muted = true;
      video.loop = false;
      video.src = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(resolve).catch(reject);
        };
        video.onerror = () => reject(new Error("Could not read that video file"));
      });

      lastVideoTimeRef.current = -1;
      historyRef.current = [];
      setStatus("monitoring");
      loop();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to analyse video";
      setError(msg);
      setStatus("error");
    }
  }, [videoRef, ensureLandmarker]);


  const loop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker) return;

    if (video.currentTime !== lastVideoTimeRef.current && video.readyState >= 2) {
      lastVideoTimeRef.current = video.currentTime;
      const now = performance.now();
      const result: PoseLandmarkerResult = landmarker.detectForVideo(video, now);

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (result.landmarks && result.landmarks.length > 0) {
          const drawing = new DrawingUtils(ctx);
          for (const lm of result.landmarks) {
            drawing.drawLandmarks(lm, { color: "#FFD27A", lineWidth: 1, radius: 3 });
            drawing.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {
              color: "#7BE0D6",
              lineWidth: 3,
            });
          }
        }
      }

      if (result.landmarks && result.landmarks.length > 0) {
        setPoseDetected(true);
        const lm = result.landmarks[0];
        // Key landmarks: 11=L shoulder, 12=R shoulder, 23=L hip, 24=R hip
        const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24];
        if (ls && rs && lh && rh) {
          const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
          const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
          const dx = shoulderMid.x - hipMid.x;
          const dy = shoulderMid.y - hipMid.y;
          // Angle of torso from vertical (0 = upright, 90 = horizontal)
          const angle = Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
          setTorsoAngle(angle);

          const centerY = (shoulderMid.y + hipMid.y) / 2;
          const tSec = now / 1000;
          historyRef.current.push({ t: tSec, y: centerY, angle });
          // keep last 2s
          historyRef.current = historyRef.current.filter((h) => tSec - h.t < 2);

          // Velocity over the last ~0.5s window
          const window = historyRef.current.filter((h) => tSec - h.t < 0.6);
          if (window.length >= 2) {
            const first = window[0];
            const last = window[window.length - 1];
            const dt = Math.max(0.05, last.t - first.t);
            const vy = (last.y - first.y) / dt; // positive = falling down
            setVerticalVelocity(vy);

            // Thresholds, modulated by sensitivity (0..1)
            const angleThresh = 70 - sensitivity * 20; // 50..70
            const velocityThresh = 0.55 - sensitivity * 0.25; // 0.30..0.55

            const sustainedTilt = window.filter((h) => h.angle > angleThresh - 10).length >= 3;
            const isFalling = vy > velocityThresh && last.angle > angleThresh && sustainedTilt;
            const cooldownOk = tSec - lastFallTimeRef.current > 8;

            if (isFalling && cooldownOk) {
              lastFallTimeRef.current = tSec;
              const confidence = Math.min(1, (vy / velocityThresh) * (last.angle / 90));
              onFall({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                confidence,
              });
            }
          }
        }
      } else {
        setPoseDetected(false);
      }
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [videoRef, canvasRef, sensitivity, onFall]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { status, error, poseDetected, torsoAngle, verticalVelocity, start, startFile, stop };
}
