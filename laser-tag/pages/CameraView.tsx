/* global cv */
import { useEffect, useRef, useState } from "react";
//import { useLocation, useNavigate } from "react-router-dom";
import { useRouter } from "next/router"; // navigate between pages and read URL parameters
import * as tf from "@tensorflow/tfjs";
import * as poseDetection from "@tensorflow-models/pose-detection"; // find human pose in the camera feed
import { Keypoint } from "@tensorflow-models/pose-detection";
import "@tensorflow/tfjs-backend-webgl";

interface Player 
  {
    username : string ,
    color : string,
    points : number,
    hitsGiven : number,
    hitsTaken : number,
    health? : Number, // addedd healthy property 
  } // defines what player object looks like

  interface CanvasWithHitData extends HTMLCanvasElement 
  { isPersonCentered: boolean; modeColor: string; }

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<CanvasWithHitData>(null);
  const logRef = useRef(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const [gunType, setGunType] = useState<"pistol" | "shotgun" | "sniper">("pistol");
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [activePowerup, setActivePowerup] = useState(null);

  // health state ivy
  const [health , setHealth] = useState(100);

  // Game state
  const [gameTimeString, setGameTimeString] = useState("00:00");
  const gunConfig = {
    pistol: { ammo: 5, reloadTime: 1000 },
    shotgun: { ammo: 2, reloadTime: 2000 },
    sniper: { ammo: 1, reloadTime: 3000 },
  };
  const [ammo, setAmmo] = useState(gunConfig["pistol"].ammo);
  const [isReloading, setIsReloading] = useState(false);

  // Extract URL state params
  const router = useRouter();
  const { username, gameCode, color } = router.query;
  
  // Leaderboard state
  const [leaderboardData, setLeaderboardData] = useState<Player[]>([]);
  const sortedPlayers = [...leaderboardData]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);

  const currentPlayer = leaderboardData.find((p) => p.username === username);
  //const isDead = currentPlayer?.points === 0;

  // ivy testing something
  const isDead = health <= 10;

  // WebSocket ref
  type AudioKey = "pistol" | "shotgun" | "sniper" | "ouch" | "powerup";
  const socketRef = useRef<WebSocket | null>(null);
  const audioRef= useRef<Record<AudioKey, HTMLAudioElement>| null>(null);

    //ivy  health bar color calculation
  const getHealthBarColor = (healthValue: number) : string =>{
    if(healthValue <= 30) {
      return "#ff4444"; // danger
    }
    else if (healthValue <= 70) {
      return "#ffaa00"; // orange warning
  }else{
    return "#44ff44"; // green still safe
  }
};
// forferfeit in the middle of the game 
  const handleForfeit = () => {
    const confirmForfeit = window.confirm("Are you sure you want to forfeit the game? This will end you participation.");
    if (confirmForfeit) {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "forfeit", username }));
    }
    // Redirect if they confrim forfeit
    router.push({
      pathname : "/PlayerLeaderboard",
      query : { players : JSON.stringify(leaderboardData) },
    });
  }
};

  useEffect(() => {
    if (typeof window !== "undefined") {
      const audioFiles = {
        pistol: "/audio/pistol.mp3",
        shotgun: "/audio/shotgun.mp3",
        sniper: "/audio/sniper.mp3",
        ouch: "/audio/ouch.mp3",
        powerup: "/audio/powerup.mp3",
      };

      audioRef.current = {} as Record<AudioKey, HTMLAudioElement>;
      Object.entries(audioFiles).forEach(([key, src]) => {
        try {
          const audio = new Audio(src);
          audio.preload = "auto"; // Preload for better mobile performance
          
          audioRef.current![key as AudioKey] = audio;
          audio.onerror = () => console.error(`Failed to load audio: ${src}`);
        } catch (error) {
          console.error(`Error initializing audio for ${key}:`, error);
        }
      });
    }
  }, []);

  // Connect to WebSocket & listen for game updates
  useEffect(() => {
    console.log(username, gameCode, color);
    if (username == null || gameCode == null || color == null) {
      console.warn("Missing username, gameCode or color");
      return;
    }
    const socket = new WebSocket(
      `wss://bbd-lasertag.onrender.com/session/${gameCode}?username=${username}&color=${color}`
    );
    socketRef.current = socket; // check existing data exist before connecting

    socket.onopen = () => console.log("Connected to WebSocket");
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "gameUpdate") {
        const { players, timeLeft } = data;
        setGameTimeString(
          `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(
            timeLeft % 60
          ).padStart(2, "0")}`
        );
        

        setLeaderboardData(players);

        // Update health of current player 
      const currentPlayerData = players.find((p: Player) => p.username === username);
        if (currentPlayerData && currentPlayerData.health !== undefined) {
          setHealth(currentPlayerData.health);
        }


        if (timeLeft === 0) {
         router.push({
            pathname: "/PlayerLeaderboard",
            query: { players: JSON.stringify(players) },
          });
        }
      }
      if (data.type === "hit") {
        const { player, target, weapon } = data;
        console.log(`🎯 ${player} hit ${target} with ${weapon}`);

        // If I am the one who got hit
        if (target === username) {
          const ouch = audioRef.current?.ouch;
          if (ouch) {
            ouch.currentTime = 0;
            ouch.play().catch((e) => console.warn("Ouch sound failed:", e));
          }
          setHealth(prevHealth => Math.max(10 , prevHealth - 10)) // reduce health by 10 but not below 0
        }
        if(player === username){
          setHealth(prevHealth => Math.min(100 , prevHealth + 10))
        }
      }
       // end of what I added

      if (data.type === "powerup") {
        const { powerup, duration } = data;
        console.log(`⚡ Powerup received: ${powerup} for ${duration}s`);
        setActivePowerup(powerup);

        const powerupSound = audioRef.current?.powerup;
        if (powerupSound) {
          powerupSound.currentTime = 0;
          powerupSound
            .play()
            .catch((e) => console.warn("Powerup sound failed:", e));
        }

        // Clear after duration
        setTimeout(() => {
          setActivePowerup(null);
        }, duration * 1000);
      }
       //  handle forfeit message response 
       if(data.type === "playerForfeited"){
        const { forfeitedPlayer} = data ;
        console.log(`🏳️ Player ${forfeitedPlayer} has forfeited the game`);
       }
    };
    // end 
    socket.onclose = () => console.log("WebSocket closed");
    socket.onerror = (e) => console.error("WebSocket error", e);

    return () => socket.close();
  }, []);

  useEffect(() => {
    async function loadDetector() {
      // Set backend first (optional, but recommended)
      await tf.setBackend("webgl");
      await tf.ready();

      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        }
      );

      detectorRef.current = detector;
    }
    loadDetector();
  }, []);

  useEffect(() => {
    let animationFrameId:number;

    async function detect() {
      try {
        if (videoRef.current && canvasRef.current && detectorRef.current) {
          await processVideoOnce(
            videoRef.current,
            canvasRef.current,
            detectorRef.current
          );
        }
      } catch (err) {
        console.error("Detect loop error:", err);
      }
      animationFrameId = requestAnimationFrame(detect);
    }

    detect();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Map RGB to closest CSS color name (used for hit color detection)
  function getClosestColorName(rgbString:string) {
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
    const matches = rgbString.match(/\d+/g);
    if (!matches || matches.length !== 3) {
    console.warn(`Invalid RGB string: ${rgbString}, defaulting to aqua`);
    return "aqua"; // Fallback for invalid input
    }
    const [r, g, b] = matches.map(Number);
    let closestName = "";
    let minDist = Infinity;
    for (const [name, [cr, cg, cb]] of Object.entries(cssColors)) {
      const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      if (dist < minDist) {
        minDist = dist;
        closestName = name;
      }
    }
    console.log(
      `camv RGB string: ${rgbString} | closest color: ${closestName}`
    );
    return closestName;
  }

  // Called when a hit is detected; sends hit info to server
  function hitDetected(targetColor:string, msg:string) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not open; hit not sent");
      return;
    }
    const hitPayload = {
      type: "hit",
      weapon: gunType,
      shape: msg,
      color: targetColor,
    };
    socketRef.current.send(JSON.stringify(hitPayload));
    if (logRef.current) {
      //logRef.current.textContent = `Hit sent: ${targetColor} ${msg} with ${gunType}`;
    }
  }

  // Check if torso is centered and trigger hit detection
  function checkHit(canvas:CanvasWithHitData) {
    if (canvas.isPersonCentered) {
      const colorName = getClosestColorName(canvas.modeColor);
      hitDetected(colorName, "torso in center");
    }
  }

  // Process video frame once to detect pose & torso color
  async function processVideoOnce(video:HTMLVideoElement, canvas:CanvasWithHitData, detector:poseDetection.PoseDetector) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    if(!ctx)
    {
        console.error("context is not available");
        return;
    }
    // Draw current video frame
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);

    if (!detector) return;

    // Estimate pose(s)
    const poses = await detector.estimatePoses(video);
    if (poses.length === 0) return;

    const keypoints = poses[0].keypoints;

    // Helper to get a keypoint by name
    function getKeypoint(name:string) {
      return keypoints.find((k) => k.name === name);
    }

    // Get shoulder and hip points
    const ls = getKeypoint("left_shoulder");
    const rs = getKeypoint("right_shoulder");
    const lh = getKeypoint("left_hip");
    const rh = getKeypoint("right_hip");

    if (!ls || !rs || !lh || !rh) return;

    // Draw torso polygon connecting these four points
    const points = [ls, rs, rh, lh];

    // Draw filled torso polygon with translucent fill color
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();

    // Sample the mode color inside the rectangle formed by shoulders
    function getModeColorFromPoints(p1:Keypoint,p2:Keypoint) {
      const minX = Math.floor(Math.min(p1.x, p2.x));
      const minY = Math.floor(Math.min(p1.y, p2.y));
      const width = Math.floor(Math.abs(p1.x - p2.x));
      const height = Math.floor(Math.abs(p1.y - p2.y));
      if (width < 1 || height < 1) return "aqua";
        
      if(!ctx)
    {
        console.error("context is not available");
        return;
    }
      const imgData = ctx.getImageData(minX, minY, width, height);
      const colorCount = new Map();

      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        const key = `${r},${g},${b}`;
        colorCount.set(key, (colorCount.get(key) || 0) + 1);
      }

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

    const modeColor = getModeColorFromPoints(ls, rs)!;
    const rgbaColor = modeColor.replace("rgb(", "rgba(").replace(")", ", 0.3)");

    ctx.fillStyle = rgbaColor;
    ctx.fill();

    ctx.strokeStyle = modeColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw keypoints as small circles (only if score > 0.5)
    keypoints.forEach((kp) => {
      if (kp.score !== undefined && kp.score > 0.5) {
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "aqua";
        ctx.fill();
      }
    });

    // Draw a permanent red dot in center of canvas (reticle)
    const centerX = width / 2;
    const centerY = height / 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 7, 0, 2 * Math.PI);
    ctx.fillStyle = "red";
    ctx.fill();

    // Check if person is standing roughly centered:
    // We consider centered if centerX,centerY lies inside torso polygon (simple point-in-polygon)
    function pointInPolygon(point:[number,number],vs : Array<{ x: number; y: number }>) {
      let x = point[0],
        y = point[1];
      let inside = false;
      for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i].x,
          yi = vs[i].y;
        let xj = vs[j].x,
          yj = vs[j].y;

        let intersect =
          yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    }

    const isCentered = pointInPolygon([centerX, centerY], points);

    // Attach to canvas for external use (e.g., button click)
    canvas.isPersonCentered = isCentered;
    canvas.modeColor = modeColor;
  }

  const handleShoot = () => {
    if (isReloading || isDead) return; // 🔒 Don't shoot if dead or reloading
    if (ammo <= 0) {
      console.log("🔫 No ammo left — can't shoot");
      return;
    }

    if (audioRef.current?.[gunType]) {
      const shootSound = audioRef.current[gunType];
      shootSound.currentTime = 0;
      shootSound.play().catch((e) => console.warn("Audio play failed:", e));
    }

    setAmmo((prevAmmo) => {
      const newAmmo = prevAmmo - 1;
      if (newAmmo === 0) reload();
      return newAmmo;
    });

    if (navigator.vibrate) navigator.vibrate([75, 25, 75]);
    if (canvasRef.current) checkHit(canvasRef.current);
  };

  // Gun selection handler
  const selectGun = (type:"pistol" | "shotgun" | "sniper") => {
    setGunType(type);
    setAmmo(gunConfig[type].ammo);
    setIsReloading(false);
    setZoomEnabled(false);
    if (videoRef.current) {
      videoRef.current.style.transform =
        type === "sniper" ? "scale(3)" : "scale(1)";
      videoRef.current.style.transformOrigin = "center center";
    }
  };

  // Reload gun
  const reload = () => {
    if (isReloading) return;
    setIsReloading(true);
    setTimeout(() => {
      setAmmo(gunConfig[gunType].ammo);
      setIsReloading(false);
    }, gunConfig[gunType].reloadTime);
  };

  // Disable zoom gestures unless zoomEnabled
  useEffect(() => {
    if (zoomEnabled) return;

    const preventZoom = (e:Event) => e.preventDefault();
    let lastTouch = 0;
    const doubleTapBlocker = (e:Event) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    };

    document.addEventListener("gesturestart", preventZoom, { passive: false });
    document.addEventListener("dblclick", preventZoom, { passive: false });
    document.addEventListener("touchend", doubleTapBlocker, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventZoom);
      document.removeEventListener("dblclick", preventZoom);
      document.removeEventListener("touchend", doubleTapBlocker);
    };
  }, [zoomEnabled]);

  // Start camera
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera error:", err);
        if (err instanceof Error) {
            alert(`Camera access denied. Please allow permissions.\n\nError: ${err.message}`);
        } else {
            alert("Camera access denied. Please allow permissions.\n\nUnknown error occurred.");
        }
      }
    }
    startCamera();
  }, []);

  // Send camera frames periodically to server via WebSocket
  useEffect(() => {
    let intervalId:NodeJS.Timeout;

    const sendFrames = () => {
      const video = videoRef.current;
      const socket = socketRef.current;
      if (!video || !socket) return;

      if (socket.readyState === WebSocket.OPEN) {
        intervalId = setInterval(() => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if(!ctx)
        {
            console.error("context is not available");
            return;
        }
          ctx.drawImage(video, 0, 0);
          const frame = canvas.toDataURL("image/jpeg", 0.5);

          socket.send(
            JSON.stringify({
              type: "cameraFrame",
              username,
              frame,
              health,
            })
          );
        }, 100);
      } else {
        // Wait for socket to open then start
        const waitForSocket = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            clearInterval(waitForSocket);
            sendFrames();
          }
        }, 100);
      }
    };

    sendFrames();
    return () => clearInterval(intervalId);
  }, [username , health]);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        backgroundColor: "black",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        controls={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          pointerEvents: "none",
          transition: "transform 0.2s ease-in-out",
        }}
      />

      <canvas
        ref={canvasRef}
        width={640}
        height={480}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 2,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
     

      {activePowerup && (
        <div
          style={{
            position: "absolute",
            top: "10%",
            right: "5%",
            backgroundColor: "rgba(255, 215, 0, 0.8)",
            color: "black",
            fontSize: "20px",
            padding: "10px 16px",
            borderRadius: "10px",
            fontWeight: "bold",
            zIndex: 10,
          }}
        >
          Powerup: {activePowerup}
        </div>
      )}

      <div
        ref={logRef}
        style={{
          position: "absolute",
          bottom: "1%",
          left: "50%",
          transform: "translateX(-50%)",
          color: "white",
          zIndex: 4,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 2,
        }}
      >
        <img
          src="/images/scope.png"
          alt="Scope"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: gunType === "shotgun" ? "150px" : "80px",
            height: gunType === "shotgun" ? "150px" : "80px",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            opacity: 0.8,
          }}
        />
        {isDead && (
          <div
            style={{
              position: "absolute",
              top: "calc(50% + 60px)",
              left: "50%",
              transform: "translateX(-50%)",
              color: "red",
              fontSize: "32px",
              fontWeight: "bold",
              backgroundColor: "rgba(0, 0, 0, 0.6)",
              padding: "10px 20px",
              borderRadius: "12px",
              zIndex: 10,
            }}
          >
            You Died
          </div>
        )}

     
      {/* REPOSITIONED: Gun Area with Health Bar and Forfeit Below */}
        <div
          style={{
            position: "absolute",
            bottom: "5%",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "15px",
          }}
        >
        {/* Gun and Ammo */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "20px",
            }}
          >
          <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <img
                key={gunType}
                src={
                  gunType === "shotgun"
                    ? "/images/shotgun.png"
                    : gunType === "sniper"
                    ? "/images/sniper.png"
                    : "/images/pistol.png"
                }
                alt="Shoot"
                onClick={handleShoot}
                style={{
                  width: "150px",
                  height: "150px",
                  cursor: isReloading ? "not-allowed" : "pointer",
                  transition: "transform 0.1s ease-in-out",
                }}
                onTouchStart={(e: React.TouchEvent<HTMLImageElement>|React.MouseEvent<HTMLImageElement>) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onTouchEnd={(e: React.TouchEvent<HTMLImageElement>|React.MouseEvent<HTMLImageElement>) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              />
              <div style={{ display: "flex", gap: "4px", marginTop: "10px" }}>
                {Array.from({ length: ammo }).map((_, i) => (
                  <img
                    key={i}
                    src="/bullet.png"
                    alt="Bullet"
                    style={{ width: "40px", height: "40px" }}
                  />
                ))}
              </div>
            </div>
            {isReloading && (
              <div
                style={{
                  color: "#ff4444",
                  backgroundColor: "rgba(0,0,0,0.6)",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                Reloading...
              </div>
            )}
          </div>

{/* REPOSITIONED: Health Bar Below Gun */}
          <div
            style={{
              width: "300px",
              height: "20px",
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              border: "2px solid #fff",
              borderRadius: "10px",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                width: `${health}%`,
                height: "100%",
                backgroundColor: getHealthBarColor(health),
                transition: "all 0.3s ease-in-out",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "12px",
                textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
              }}
            >
              {health}%
            </div>
          </div>

          {/* REPOSITIONED: Gun Selection and Forfeit Below Health Bar */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
            }}
          >
            <button
              onClick={() => selectGun("pistol")}
              style={{
                padding: "5px 10px",
                fontSize: "14px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                backgroundColor: "#333",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Pistol
            </button>

            <button
              onClick={() => selectGun("shotgun")}
              style={{
                padding: "5px 10px",
                fontSize: "14px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                backgroundColor: "#333",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Shotgun
            </button>

            <button
              onClick={() => selectGun("sniper")}
              style={{
                padding: "5px 10px",
                fontSize: "14px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                backgroundColor: "#333",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Sniper
            </button>

            {/* REPOSITIONED: Forfeit Button */}
            <button
              onClick={handleForfeit}
              style={{
                padding: "5px 15px",
                fontSize: "14px",
                borderRadius: "8px",
                border: "2px solid #ff4444",
                backgroundColor: "rgba(255, 68, 68, 0.8)",
                color: "#fff",
                cursor: "pointer",
                fontWeight: "bold",
                transition: "all 0.2s ease-in-out",
              }}
              onMouseOver={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.backgroundColor = "#ff4444";
                target.style.transform = "scale(1.05)";
              }}
              onMouseOut={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.backgroundColor = "rgba(255, 68, 68, 0.8)";
                target.style.transform = "scale(1)";
              }}
            >
              🏳️ Forfeit
            </button>
          </div>
        </div>


        {/* Leaderboard */}
        <div
          style={{
            position: "absolute",
            top: "2%",
            left: "5%",
            backgroundColor: "rgba(0,0,0,0.7)",
            padding: "10px",
            borderRadius: "8px",
            maxHeight: "50vh",
            overflowY: "auto",
            width: "100px",
            color: "white",
            fontSize: "14px",
            zIndex: 5,
          }}
        >
          <h3 style={{ margin: "0 0 10px 0", textAlign: "center" }}>
            Leaderboard
          </h3>
          {sortedPlayers.map(({ username, points }, i) => (
            <div
              key={username}
              style={{
                backgroundColor:
                  i === 0 ? "gold" : i === 1 ? "silver" : "#cd7f32",
                fontWeight: i === 0 ? "bold" : "normal",
                marginBottom: "6px",
                padding: "4px",
                borderRadius: "4px",
              }}
            >
              <div>
                #{i + 1} {username} - {points}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}