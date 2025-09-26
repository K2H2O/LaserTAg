//core react functionality and Next.js navigation
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

//player statistics structure
interface Player 
  {
    username : string ,
    color : string,
    points : number,
    hitsGiven : number,
    hitsTaken : number,
  }
  // camera frame structure
interface Frame { username: string; frame: string; }

//real time viewing interface for watching game participants
export default function SpectatorStreaming() {
  const [frameMap, setFrameMap] = useState(new Map());
  const [usernames, setUsernames] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playerStats, setPlayerStats] = useState<Player[]>([]);
  const [gameTimeString, setGameTimeString] = useState("00:00");

  // websocket connection
  const socketRef = useRef<WebSocket | null>(null);

  // routing 
  const router = useRouter();
  const { gameCode } = router.query;

// websocket setup and message handling
  useEffect(() => {
    const socketUrl = `wss://bbd-lasertag.onrender.com/session/${gameCode}/spectator`;
    console.log("🔌 Connecting to WebSocket at:", socketUrl);
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("✅ Connected as spectator to session:", gameCode);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📦 Raw WebSocket message received:", data);
       // Handle incoming camera frames from players
        if (data.type === "cameraFramesBatch" && Array.isArray(data.frames)) {
            const frames = data.frames as Frame[]
          const incomingUsernames: string[] = frames.map((f:Frame) => f.username);
          const currentUsername = usernames[currentIndex];

          // update frame map with camera data
          setFrameMap((prev) => {
            const newMap = new Map();
            for (const frame of data.frames) {
              newMap.set(frame.username, frame.frame);
            }
            for (const key of prev.keys()) {
              if (!incomingUsernames.includes(key)) {
                console.log(`❌ Removing ${key} from frameMap (user left)`);
              }
            }
            return newMap;
          });

          // update usernames list if there are changes
          if (
            incomingUsernames.length !== usernames.length ||
            !incomingUsernames.every((name, i) => name === usernames[i])
          ) {
            console.log("🔄 Updating usernames:", incomingUsernames);
            setUsernames(incomingUsernames);
            if (!incomingUsernames.includes(currentUsername)) {
              setCurrentIndex(0);
            }
          }
        }
        // handle game state updates
        if (data.type === "gameUpdate" && Array.isArray(data.players)) {
          console.log("🧠 Updating player stats:", data.players);
          setPlayerStats(data.players);
          setGameTimeString(
            `${String(Math.floor(data.timeLeft / 60)).padStart(
              2,
              "0"
            )}:${String(data.timeLeft % 60).padStart(2, "0")}`
          );
          if (data.timeLeft === 0) {
            router.push({
              pathname: "/PlayerLeaderboard",
              query: { players: JSON.stringify(data.players) },
            });
          }
        }
      } catch (err) {
        console.error("❌ Failed to parse WebSocket message:", err);
      }
    };

    socket.onerror = (err) => {
      console.error("❌ WebSocket error:", err);
    };

    socket.onclose = () => {
      console.log("🛑 Spectator WebSocket closed.");
    };

    return () => {
      socket.close();
    };
  }, [gameCode, usernames, currentIndex]);

  // go to next or previous player stream
  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % usernames.length);
  };

  const goToPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + usernames.length) % usernames.length);
  };

  // get data for currently selected player
  const currentUsername = usernames[currentIndex];
  const currentFrame = frameMap.get(currentUsername);
  const currentStats = playerStats.find((p) => p.username === currentUsername);

  return (
    // full-screen dark spectator interface
    <div
      style={{
        backgroundColor: "#000",
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        color: "white",
        padding: "20px",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {/* Current player indicator with loading animation */}
      <h2 style={{ marginBottom: "20px" }}>
        {currentUsername
          ? `Viewing: ${currentUsername}`
          : "Waiting for player streams "}
        {!currentUsername && (
          <span className="loading-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        )}
      </h2>
      <h2>{gameTimeString}</h2>

       {/* Current player's camera view with scope overlay */}
      {currentFrame && (
        <div style={{ position: "relative", width: "90%", maxWidth: "800px" }}>
          <img
            src={currentFrame}
            alt={`Live stream from ${currentUsername}`}
            className="player-stream-img"
            style={{
              width: "100%",
              maxHeight: "30vh",
              objectFit: "contain",
              border: "3px solid #fff",
              borderRadius: "12px",
              display: "block",
            }}
          />
          {/* Crosshair overlay for immersive viewing */}
          <img
            src="images/scope.png"
            alt="Scope Reticle"
            className="scope-reticle"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "50px",
              height: "50px",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              opacity: 0.8,
            }}
          />
        </div>
      )}
     {/* Current player's game performance metrics */}
      {currentStats && (
        <div
          style={{ marginTop: "20px", fontSize: "18px", textAlign: "center" }}
        >
          <p>
            <strong>Hits Given:</strong> {currentStats.hitsGiven}
          </p>
          <p>
            <strong>Hits Taken:</strong> {currentStats.hitsTaken}
          </p>
          <p>
            <strong>Points:</strong> {currentStats.points}
          </p>
        </div>
      )}
    {/* Previous/Next player buttons (only show if multiple players) */}
      {usernames.length > 1 && (
        <div style={{ marginTop: "20px", display: "flex", gap: "40px" }}>
          <button onClick={goToPrev} style={buttonStyle}>
            Previous Player
          </button>
          <button onClick={goToNext} style={buttonStyle}>
            Next Player
          </button>
        </div>
      )}

     {/* Return to main menu */}
      <button
        onClick={() => router.push("/")}
        style={{
          marginTop: "30px",
          fontSize: "18px",
          padding: "10px 20px",
          borderRadius: "8px",
          border: "none",
          backgroundColor: "#800080",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Back to Home
      </button>

      <style>
        {`
          .loading-dots {
            display: inline-block;
            margin-left: 5px;
          }
          .loading-dots span {
            animation: dot-appear 1.2s infinite ease-in-out;
            display: inline-block;
          }
          .loading-dots span:nth-child(2) {
            animation-delay: 0.2s;
          }
          .loading-dots span:nth-child(3) {
            animation-delay: 0.4s;
          }
          @keyframes dot-appear {
            0%, 100% { opacity: 0; }
            50% { opacity: 1; }
          }

          @media (min-width: 1024px) {
            .player-stream-img {
              max-height: 50vh !important;
            }
            .scope-reticle {
              width: 80px !important;
              height: 80px !important;
            }
          }
        `}
      </style>
    </div>
  );
}

// Button styling for navigation controls
const buttonStyle = {
  fontSize: "20px",
  padding: "10px 20px",
  borderRadius: "8px",
  border: "none",
  backgroundColor: "#1f2937",
  color: "#fff",
  cursor: "pointer",
};