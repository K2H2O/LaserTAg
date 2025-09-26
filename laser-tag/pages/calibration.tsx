//2023721380 Ivy
//2021561648 Bophelo Pharasi
import { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { Keypoint } from "@tensorflow-models/pose-detection";
import { useRouter } from "next/router";

// Calibration component for capturing user pose and color for a laser tag game
export default function Calibration() {
  // References to video and canvas elements for webcam feed and rendering
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // State to store the pose detector instance
  const [detector, setDetector] = useState<poseDetection.PoseDetector | null>(null);
  
  // State to store the captured pose keypoints
  const [capturedPose, setCapturedPose] = useState<Keypoint[] | null>(null);
  
  // State to store the username input
  const [username, setUsername] = useState("");
  
  // Ref to track the last sent color to avoid redundant updates
  const lastSentColorRef = useRef<string|null>(null);

  // Router to access query parameters and navigate
  const router = useRouter();
  const { gameCode } = router.query;

  // Initialize webcam, canvas, and pose detector on component mount
  useEffect(() => {
    let detectorInstance;

    async function init() {
      // Ensure TensorFlow.js is ready
      await tf.ready();

      // Access the user's webcam
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      // Set webcam stream to video element and play
      const video = videoRef.current;
      if(video) {
        video.srcObject = stream;
        await video.play();
      } else {
        console.error("Video ref is not assigned yet");
        return;
      }

      // Configure canvas dimensions to match video
      const canvas = canvasRef.current;
      if(canvas) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Create MoveNet pose detector
      detectorInstance = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        }
      );

      // Store detector and start rendering loop
      setDetector(detectorInstance);
      renderLoop(detectorInstance);
    }

    init();
  }, []);

  // Find a keypoint by name from the keypoints array
  function getKeypoint(keypoints: Keypoint[], name: string): Keypoint | undefined {
    return keypoints.find((k) => k.name === name);
  }

  // Calculate the most frequent (mode) color in the region between two keypoints
  function getModeColorFromPoints(ctx: CanvasRenderingContext2D, p1:Keypoint, p2:Keypoint) {
    const minX = Math.floor(Math.min(p1.x, p2.x));
    const minY = Math.floor(Math.min(p1.y, p2.y));
    const width = Math.floor(Math.abs(p1.x - p2.x));
    const height = Math.floor(Math.abs(p1.y - p2.y));

    // Return default color if region is invalid
    if (width < 1 || height < 1) return "aqua";

    // Extract image data from the specified region
    const imgData = ctx.getImageData(minX, minY, width, height);
    const colorCount = new Map();

    // Count occurrences of each color
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i];
      const g = imgData.data[i + 1];
      const b = imgData.data[i + 2];
      const key = `${r},${g},${b}`;
      colorCount.set(key, (colorCount.get(key) || 0) + 1);
    }

    // Find the color with the highest count
    let modeColor = "aqua";
    let maxCount = 0;

    for (const [key, count] of colorCount.entries()) {
      if (count > maxCount) {
        maxCount = count;
        modeColor = `rgb(${key})`;
      }
    }

    return modeColor;
  }

  // Map an RGB color to the closest CSS color name
  function getClosestColorName(rgbString: string): string {
    const cssColors = {
      white: [255, 255, 255],
      black: [0, 0, 0],
      red: [255, 0, 0],
      orange: [255, 128, 0],
      yellow: [255, 255, 0],
      green: [0, 180, 0],
      blue: [0, 128, 255],
      purple: [128, 0, 255],
      pink: [255, 0, 255],
      aqua: [0, 255, 255],
    };
    
    // Parse RGB string
    const matches = rgbString.match(/\d+/g);
    if (!matches || matches.length !== 3) {
      console.warn(`Invalid RGB string: ${rgbString}, defaulting to aqua`);
      return "aqua";
    }
    const [r, g, b] = matches.map(Number);

    // Find closest color by Euclidean distance
    let closestName = "";
    let minDist = Infinity;
    for (const [name, [cr, cg, cb]] of Object.entries(cssColors)) {
      const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      if (dist < minDist) {
        minDist = dist;
        closestName = name;
      }
    }
    console.log(`cal RGB string: ${rgbString} | closest color: ${closestName}`);
    return closestName;
  }

  // Continuously render video feed and detected poses
  async function renderLoop(detector: poseDetection.PoseDetector) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const video = videoRef.current;

    async function draw() {
      if(!ctx || !canvas) {
        console.error("Canvas or context is not available");
        return;
      }
      if (!video) {
        console.error("Video ref is not available");
        return;
      }

      // Clear and redraw video frame on canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Manage TensorFlow memory
      await tf.engine().startScope();

      // Estimate poses and draw keypoints and torso box
      const poses = await detector.estimatePoses(video);
      if (poses.length > 0) {
        const keypoints = poses[0].keypoints;
        drawTorsoBox(ctx, keypoints);
        drawKeypoints(ctx, keypoints);
        setCapturedPose(keypoints);
      }

      await tf.engine().endScope();
      requestAnimationFrame(draw);
    }

    draw();
  }

  // Draw keypoints with confidence score above threshold
  function drawKeypoints(ctx: CanvasRenderingContext2D, keypoints: Keypoint[]) {
    keypoints.forEach((keypoint) => {
      if (keypoint.score !== undefined && keypoint.score > 0.5) {
        const { x, y } = keypoint;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "aqua";
        ctx.fill();
      }
    });
  }

  // Draw a box around the torso using shoulder and hip keypoints
  function drawTorsoBox(ctx: CanvasRenderingContext2D, keypoints: Keypoint[]) {
    const ls = getKeypoint(keypoints, "left_shoulder");
    const rs = getKeypoint(keypoints, "right_shoulder");
    const lh = getKeypoint(keypoints, "left_hip");
    const rh = getKeypoint(keypoints, "right_hip");

    if (!ls || !rs || !lh || !rh) return;

    // Draw a filled polygon with the mode color
    const points = [ls, rs, rh, lh];
    const modeColor = getModeColorFromPoints(ctx, ls, rs);
    const rgbaColor = modeColor.replace("rgb(", "rgba(").replace(")", ", 0.3)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();

    ctx.fillStyle = rgbaColor;
    ctx.fill();

    ctx.strokeStyle = modeColor;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Capture pose and navigate to PlayerLobby with detected color
  function capturePose() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!capturedPose) {
      alert("No pose detected yet. Try again.");
      return;
    }

    const ls = getKeypoint(capturedPose, "left_shoulder");
    const rs = getKeypoint(capturedPose, "right_shoulder");

    // Validate shoulder detection
    if (!ls || !rs || (ls.score !== undefined && ls.score < 0.5) || (rs.score !== undefined && rs.score < 0.5)) {
      alert("Could not detect shoulders properly. Try again.");
      return;
    }
    if (!ctx) {
      alert("Context not available");
      return;
    }
    
    // Get mode color and store it
    const modeColor = getModeColorFromPoints(ctx, ls, rs);
    if (!modeColor || modeColor === "aqua") {
      alert("Color could not be captured. Try again.");
      return;
    }

    lastSentColorRef.current = modeColor;

    // Navigate to PlayerLobby with captured data
    router.push({
      pathname: "/PlayerLobby",
      query: {
        color: getClosestColorName(lastSentColorRef.current),
        username,
        gameCode,
      },
    });
  }

  // JSX for rendering the UI
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        backgroundColor: "#1a1a1a",
        height: "100%",
      }}
    >
      {/* Banner with game logo */}
      <div
        style={{
          width: "100%",
          minHeight: "60px",
          height: "10%",
          backgroundColor: "#800080",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "0",
        }}
      >
        <img
          src="/images/Laser-Tag.png"
          alt="Laser Tag Logo"
          style={{
            maxHeight: "80px",
            width: "auto",
            maxWidth: "30vw",
            objectFit: "contain",
          }}
        />
      </div>

      {/* Webcam feed and canvas for pose detection */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexGrow: 1,
          justifyContent: "center",
          width: "100%",
          padding: "0 10px",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          maxWidth: "90%",
          margin: "0 auto",
        }}
      >
        <video
          ref={videoRef}
          style={{ display: "none" }}
          playsInline
          muted
          autoPlay
        ></video>
        <canvas
          ref={canvasRef}
          style={{ maxWidth: "100%", height: "auto" }}
        ></canvas>
      </div>

      {/* Username input and capture button */}
      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 10px",
          width: "100%",
          maxWidth: "300px",
          margin: "0 auto",
        }}
      >
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.slice(0, 6))}
          placeholder="Enter your username"
          style={{
            padding: "0.75rem 1.25rem",
            fontSize: "1.2rem",
            borderRadius: "8px",
            border: "1px solid #ccc",
            backgroundColor: "#222",
            color: "#fff",
            marginBottom: "1rem",
            width: "100%",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        />

        <button
          onClick={capturePose}
          disabled={!username.trim()}
          style={{
            padding: "0.75rem 2rem",
            fontSize: "1.1rem",
            backgroundColor: !username.trim() ? "#555" : "#0ea5e9",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            cursor: !username.trim() ? "not-allowed" : "pointer",
            transition: "background 0.3s",
            width: "100%",
            boxSizing: "border-box",
            opacity: !username.trim() ? 0.6 : 1,
          }}
        >
          📸 Capture Pose
        </button>
      </div>
    </div>
  );
}