import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import * as tf from "@tensorflow/tfjs";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { Keypoint } from "@tensorflow-models/pose-detection";
import "@tensorflow/tfjs-backend-webgl";

interface Player {
  username: string;
  color: string;
  points: number;
  hitsGiven: number;
  hitsTaken: number;
  health?: number;
}

interface Team {
  teamId: number;
  players: Player[];
  score: number;
}

interface CanvasWithHitData extends HTMLCanvasElement {
  isPersonCentered: boolean;
  modeColor: string;
}

// GPS/Minimap interfaces
interface PlayerPosition {
  username: string;
  latitude: number;
  longitude: number;
  color: string;
  lastUpdated: number;
}

interface MinimapBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export default function TeamCameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<CanvasWithHitData>(null);
  const logRef = useRef(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const [gunType, setGunType] = useState<"pistol" | "shotgun" | "sniper">("pistol");
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [activePowerup, setActivePowerup] = useState(null);

  // ADDED: Health system
  const [health, setHealth] = useState(100);

  // ADDED: GPS/Minimap states
  const [playerPositions, setPlayerPositions] = useState<PlayerPosition[]>([]);
  const [myPosition, setMyPosition] = useState<{latitude: number; longitude: number} | null>(null);
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');

  // Game state
  const [gameTimeString, setGameTimeString] = useState("00:00");
  const gunConfig = {
    pistol: { ammo: 5, reloadTime: 1000 },
    shotgun: { ammo: 2, reloadTime: 2000 },
    sniper: { ammo: 1, reloadTime: 3000 },
  };
  const [ammo, setAmmo] = useState(gunConfig["pistol"].ammo);
  const [isReloading, setIsReloading] = useState(false);

  const router = useRouter();
  const { username, gameCode, color, teamId } = router.query;

  const [leaderboardData, setLeaderboardData] = useState<Team[]>([]);
  
  const sortedTeams = [...leaderboardData].sort((a, b) => b.score - a.score).slice(0, 3);
  const currentPlayer = leaderboardData.flatMap(team => team.players).find((p) => p.username === username);
  
  // UPDATED: Use health instead of points for death determination
  const isDead = health <= 10;

  const allPlayers = leaderboardData.flatMap(team => team.players);
  const mostHitsTaken = allPlayers.reduce((max, p) => 
    p.hitsTaken > (max?.hitsTaken || 0) ? p : max, null as Player | null);
  const highestHitsGiven = allPlayers.reduce((max, p) => 
    p.hitsGiven > (max?.hitsGiven || 0) ? p : max, null as Player | null);

  type AudioKey = "pistol" | "shotgun" | "sniper" | "ouch" | "powerup";
  const socketRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<Record<AudioKey, HTMLAudioElement> | null>(null);

  // ADDED: Health bar color function
  const getHealthBarColor = (healthValue: number): string => {
    if (healthValue <= 30) {
      return "#ff4444";
    } else if (healthValue <= 70) {
      return "#ffaa00";
    } else {
      return "#44ff44";
    }
  };

  // ADDED: Forfeit handler
  const handleForfeit = () => {
    const confirmForfeit = window.confirm("Are you sure you want to forfeit the game? This will end your participation.");
    if (confirmForfeit) {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "forfeit", username }));
      }
      router.push({
        pathname: "/PlayerLeaderboard",
        query: { teams: JSON.stringify(leaderboardData) },
      });
    }
  };

  // ADDED: GPS functions
  const requestLocationPermission = async () => {
    if (!navigator.geolocation) {
      console.warn("Geolocation is not supported by this browser.");
      return false;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        });
      });
      
      setMyPosition({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });
      setLocationPermission('granted');
      return true;
    } catch (error) {
      console.error("Location permission denied:", error);
      setLocationPermission('denied');
      return false;
    }
  };

  const sendPosition = (latitude: number, longitude: number) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: "playerPosition",
        username,
        latitude,
        longitude,
        timestamp: Date.now()
      }));
    }
  };

  const calculateMinimapBounds = (positions: PlayerPosition[]): MinimapBounds => {
    if (positions.length === 0) {
      return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
    }

    const lats = positions.map(p => p.latitude);
    const lons = positions.map(p => p.longitude);
    
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    
    const padding = 0.0005;
    
    return {
      minLat: minLat - padding,
      maxLat: maxLat + padding,
      minLon: minLon - padding,
      maxLon: maxLon + padding
    };
  };

  const gpsToMinimap = (lat: number, lon: number, bounds: MinimapBounds, mapSize: number) => {
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * mapSize;
    const y = mapSize - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * mapSize;
    return { x, y };
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
          audio.preload = "auto";
          audioRef.current![key as AudioKey] = audio;
          audio.onerror = () => console.error(`Failed to load audio: ${src}`);
        } catch (error) {
          console.error(`Error initializing audio for ${key}:`, error);
        }
      });
    }
  }, []);

  // ADDED: Location tracking
  useEffect(() => {
    let watchId: number | null = null;

    const startLocationTracking = async () => {
      const hasPermission = await requestLocationPermission();
      if (!hasPermission) return;

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const newPos = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          setMyPosition(newPos);
          sendPosition(newPos.latitude, newPos.longitude);
        },
        (error) => {
          console.error("Location tracking error:", error);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000
        }
      );
    };

    startLocationTracking();

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [username]);

  useEffect(() => {
    if (username == null || gameCode == null || color == null || teamId == null) {
      console.warn("Missing username, gameCode, color, or teamId");
      return;
    }
    
    const socket = new WebSocket(
      `wss://bbd-lasertag.onrender.com/session/${gameCode}?username=${username}&color=${color}&teamId=${teamId}`
    );
    socketRef.current = socket;

    socket.onopen = () => console.log("Connected to WebSocket");
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "gameUpdate") {
        const { teams, timeLeft } = data;
       const teamsWithScores = (teams || []).map((team: Team) => ({
    ...team,
    score: team.players.reduce((sum: number, p: Player) => sum + p.points, 0)
  }));
  
  setGameTimeString(
    `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(
      timeLeft % 60
    ).padStart(2, "0")}`
  );
  setLeaderboardData(teamsWithScores);

        // ADDED: Update health from server
       const currentPlayerData = (teams || []).flatMap((team: Team) => team.players).find((p: Player) => p.username === username);
  
  if (currentPlayerData && currentPlayerData.health !== undefined) {
    setHealth(currentPlayerData.health);
  }

  if (timeLeft === 0) {
    router.push({
      pathname: "/PlayerLeaderboard",
      query: { teams: JSON.stringify(teamsWithScores) },
    });
  }
}
      
      if (data.type === "hit") {
        const { player, target, weapon } = data;
        console.log(`🎯 ${player} hit ${target} with ${weapon}`);

        if (target === username) {
          const ouch = audioRef.current?.ouch;
          if (ouch) {
            ouch.currentTime = 0;
            ouch.play().catch((e) => console.warn("Ouch sound failed:", e));
          }
          // ADDED: Health decrease on hit
          setHealth(prevHealth => Math.max(10, prevHealth - 10));
        }
        // ADDED: Health increase when hitting others
        if (player === username) {
          setHealth(prevHealth => Math.min(100, prevHealth + 10));
        }
      }
      
      if (data.type === "powerup") {
        const { powerup, duration } = data;
        console.log(`⚡ Powerup received: ${powerup} for ${duration}s`);
        setActivePowerup(powerup);

        const powerupSound = audioRef.current?.powerup;
        if (powerupSound) {
          powerupSound.currentTime = 0;
          powerupSound.play().catch((e) => console.warn("Powerup sound failed:", e));
        }

        setTimeout(() => {
          setActivePowerup(null);
        }, duration * 1000);
      }

      // ADDED: Handle player positions
      if (data.type === "playerPositions") {
        const { positions } = data;
        setPlayerPositions(positions.map((pos: any) => ({
          ...pos,
          lastUpdated: Date.now()
        })));
      }

      // ADDED: Handle forfeit
      if (data.type === "playerForfeited") {
        const { forfeitedPlayer } = data;
        console.log(`🏳️ Player ${forfeitedPlayer} has forfeited the game`);
      }
    };
    
    socket.onclose = () => console.log("WebSocket closed");
    socket.onerror = (e) => console.error("WebSocket error", e);

    return () => socket.close();
  }, [username, gameCode, color, teamId]);

  useEffect(() => {
    async function loadDetector() {
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
    let animationFrameId: number;

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

  function getClosestColorName(rgbString: string) {
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
      return "aqua";
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
    console.log(`camv RGB string: ${rgbString} | closest color: ${closestName}`);
    return closestName;
  }

  function hitDetected(targetColor: string, msg: string) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not open; hit not sent");
      return;
    }
    const hitPayload = {
      type: "hit",
      weapon: gunType,
      shape: msg,
      color: targetColor,
      teamId: teamId,
    };
    socketRef.current.send(JSON.stringify(hitPayload));
  }

  function checkHit(canvas: CanvasWithHitData) {
    if (canvas.isPersonCentered) {
      const colorName = getClosestColorName(canvas.modeColor);
      hitDetected(colorName, "torso in center");
    }
  }

  async function processVideoOnce(video: HTMLVideoElement, canvas: CanvasWithHitData, detector: poseDetection.PoseDetector) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      console.error("context is not available");
      return;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);

    if (!detector) return;

    const poses = await detector.estimatePoses(video);
    if (poses.length === 0) return;

    const keypoints = poses[0].keypoints;

    function getKeypoint(name: string) {
      return keypoints.find((k) => k.name === name);
    }

    const ls = getKeypoint("left_shoulder");
    const rs = getKeypoint("right_shoulder");
    const lh = getKeypoint("left_hip");
    const rh = getKeypoint("right_hip");

    if (!ls || !rs || !lh || !rh) return;

    const points = [ls, rs, rh, lh];

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();

    function getModeColorFromPoints(p1: Keypoint, p2: Keypoint) {
      const minX = Math.floor(Math.min(p1.x, p2.x));
      const minY = Math.floor(Math.min(p1.y, p2.y));
      const width = Math.floor(Math.abs(p1.x - p2.x));
      const height = Math.floor(Math.abs(p1.y - p2.y));
      if (width < 1 || height < 1) return "aqua";

      if (!ctx) return;
      
      // ADDED: Canvas performance optimization
      const canvas = ctx.canvas as HTMLCanvasElement;
      if ('willReadFrequently' in canvas) {
     (canvas as any).willReadFrequently = true;
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

    keypoints.forEach((kp) => {
      if (kp.score !== undefined && kp.score > 0.5) {
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "aqua";
        ctx.fill();
      }
    });

    const centerX = width / 2;
    const centerY = height / 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 7, 0, 2 * Math.PI);
    ctx.fillStyle = "red";
    ctx.fill();

    function pointInPolygon(point: [number, number], vs: Array<{ x: number; y: number }>) {
      let x = point[0], y = point[1];
      let inside = false;
      for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i].x, yi = vs[i].y;
        let xj = vs[j].x, yj = vs[j].y;

        let intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    }

    const isCentered = pointInPolygon([centerX, centerY], points);

    canvas.isPersonCentered = isCentered;
    canvas.modeColor = modeColor;
  }

  const handleShoot = () => {
    if (isReloading || isDead) return;
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

  const selectGun = (type: "pistol" | "shotgun" | "sniper") => {
    setGunType(type);
    setAmmo(gunConfig[type].ammo);
    setIsReloading(false);
    setZoomEnabled(false);
    if (videoRef.current) {
      videoRef.current.style.transform = type === "sniper" ? "scale(3)" : "scale(1)";
      videoRef.current.style.transformOrigin = "center center";
    }
  };

  const reload = () => {
    if (isReloading) return;
    setIsReloading(true);
    setTimeout(() => {
      setAmmo(gunConfig[gunType].ammo);
      setIsReloading(false);
    }, gunConfig[gunType].reloadTime);
  };

  useEffect(() => {
    if (zoomEnabled) return;

    const preventZoom = (e: Event) => e.preventDefault();
    let lastTouch = 0;
    const doubleTapBlocker = (e: Event) => {
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

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

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
          if (!ctx) {
            console.error("context is not available");
            return;
          }
          ctx.drawImage(video, 0, 0);
          const frame = canvas.toDataURL("image/jpeg", 0.5);

          socket.send(JSON.stringify({
            type: "cameraFrame",
            username,
            teamId,
            frame,
            health, // ADDED: Include health in frame data
          }));
        }, 100);
      } else {
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
  }, [username, teamId, health]);

  // ADDED: Minimap Component
  const Minimap = () => {
    const mapSize = 120;
    const allPositions = [
      ...playerPositions,
      ...(myPosition ? [{
        username: username as string,
        latitude: myPosition.latitude,
        longitude: myPosition.longitude,
        color: color as string,
        lastUpdated: Date.now()
      }] : [])
    ];

    if (allPositions.length === 0) {
      return (
        <div
          style={{
            width: mapSize,
            height: mapSize,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            border: "2px solid #fff",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: "10px",
            textAlign: "center",
          }}
        >
          No GPS Data
        </div>
      );
    }

    const bounds = calculateMinimapBounds(allPositions);

    return (
      <div
        style={{
          position: "relative",
          width: mapSize,
          height: mapSize,
          backgroundColor: "rgba(50, 50, 50, 0.9)",
          border: "2px solid #fff",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        <svg width={mapSize} height={mapSize} style={{ position: "absolute", top: 0, left: 0 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <line
              key={`h${i}`}
              x1={0}
              y1={(i * mapSize) / 4}
              x2={mapSize}
              y2={(i * mapSize) / 4}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
            />
          ))}
          {[0, 1, 2, 3, 4].map(i => (
            <line
              key={`v${i}`}
              x1={(i * mapSize) / 4}
              y1={0}
              x2={(i * mapSize) / 4}
              y2={mapSize}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
            />
          ))}
        </svg>

        {allPositions.map((player) => {
          const { x, y } = gpsToMinimap(player.latitude, player.longitude, bounds, mapSize);
          const isMe = player.username === username;
          const isStale = Date.now() - player.lastUpdated > 30000;

          return (
            <div
              key={player.username}
              style={{
                position: "absolute",
                left: x - 4,
                top: y - 4,
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: isStale ? "#666" : player.color,
                border: isMe ? "2px solid #fff" : "1px solid #000",
                boxShadow: isMe ? "0 0 6px rgba(255,255,255,0.8)" : "none",
                zIndex: isMe ? 10 : 5,
                opacity: isStale ? 0.5 : 1,
              }}
              title={`${player.username}${isStale ? ' (offline)' : ''}`}
            >
              {isMe && (
                <div
                  style={{
                    position: "absolute",
                    top: "-12px",
                    left: "-6px",
                    fontSize: "8px",
                    color: "#fff",
                    fontWeight: "bold",
                    textShadow: "1px 1px 1px #000",
                    whiteSpace: "nowrap",
                  }}
                >
                  YOU
                </div>
              )}
            </div>
          );
        })}

        <div
          style={{
            position: "absolute",
            top: "4px",
            right: "4px",
            fontSize: "8px",
            color: "#fff",
            fontWeight: "bold",
            textShadow: "1px 1px 1px #000",
          }}
        >
          N
        </div>
      </div>
    );
  };

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

        {/* UPDATED: Gun Area with Health Bar and Forfeit */}
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
                onTouchStart={(e: React.TouchEvent<HTMLImageElement> | React.MouseEvent<HTMLImageElement>) => {
                  e.currentTarget.style.transform = "scale(0.95)";
                }}
                onTouchEnd={(e: React.TouchEvent<HTMLImageElement> | React.MouseEvent<HTMLImageElement>) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              />
              <div style={{ display: "flex", gap: "4px", marginTop: "10px" }}>
                {Array.from({ length: ammo }).map((_, i) => (
                  <img
                    key={i}
                    src="/images/bullet.png"
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

          {/* ADDED: Health Bar */}
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

          {/* Gun Selection and Forfeit */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "center",
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

            {/* ADDED: Forfeit Button */}
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
              Forfeit
            </button>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: "2%",
            left: "50%",
            transform: "translateX(-50%)",
            color: "white",
            fontSize: "18px",
            fontWeight: "bold",
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            padding: "6px 12px",
            borderRadius: "8px",
            zIndex: 5,
          }}
        >
          {gameTimeString}
        </div>

        {/* Team Leaderboard */}
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
            width: "180px",
            color: "white",
            fontSize: "14px",
            zIndex: 5,
          }}
        >
          <h3 style={{ margin: "0 0 10px 0", textAlign: "center" }}>
            Team Leaderboard
          </h3>
          {sortedTeams.map((team, i) => (
            <div
              key={team.teamId}
              style={{
                backgroundColor:
                  i === 0 ? "gold" : i === 1 ? "silver" : "#cd7f32",
                fontWeight: i === 0 ? "bold" : "normal",
                marginBottom: "10px",
                padding: "6px",
                borderRadius: "4px",
              }}
            >
              <div>Team {team.teamId} - Score: {team.score}</div>
              {team.players.map((player) => (
                <div key={player.username} style={{ marginLeft: "10px", fontSize: "12px" }}>
                  {player.username}: {player.points} pts
                  {player.username === username && <span style={{ color: "#fff" }}> (YOU)</span>}
                </div>
              ))}
            </div>
          ))}
          {mostHitsTaken && (
            <div style={{ marginTop: "10px", fontStyle: "italic" }}>
              Most Hits Taken: {mostHitsTaken.username} ({mostHitsTaken.hitsTaken})
            </div>
          )}
          {highestHitsGiven && (
            <div style={{ marginTop: "5px", fontStyle: "italic" }}>
              Most Hits Given: {highestHitsGiven.username} ({highestHitsGiven.hitsGiven})
            </div>
          )}
        </div>

        {/* ADDED: Minimap */}
        <div
          style={{
            position: "absolute",
            bottom: "2%",
            left: "2%",
            zIndex: 10,
          }}
        >
          <div
            style={{
              marginBottom: "8px",
              color: "#fff",
              fontSize: "12px",
              fontWeight: "bold",
              textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
            }}
          >
            Map
          </div>
          <Minimap />
          {locationPermission === 'denied' && (
            <div
              style={{
                marginTop: "4px",
                fontSize: "8px",
                color: "#ffaa00",
                textAlign: "center",
              }}
            >
              Location disabled
            </div>
          )}
        </div>
      </div>
    </div>
  );
}