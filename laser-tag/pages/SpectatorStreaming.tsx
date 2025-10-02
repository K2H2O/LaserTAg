//core react functionality and Next.js navigation
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Socket } from "socket.io-client";
import { initializeSocket, closeSocket } from "../client/src/utils/socket";

interface Player {
  username: string;
  color: string;
  points: number;
  hitsGiven: number;
  hitsTaken: number;
}

interface Team {
  teamId: number;
  players: Player[];
  score: number;
}

interface Frame { 
  username: string; 
  frame: string; 
  teamId?: number;
}

//real time viewing interface for watching game participants
export default function SpectatorStreaming() {
  const [frameMap, setFrameMap] = useState(new Map<string, string>());
  const [usernames, setUsernames] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentTeamId, setCurrentTeamId] = useState<number | null>(null);
  const [gameTimeString, setGameTimeString] = useState("00:00");
  const [viewMode, setViewMode] = useState<'all' | 'team'>('all');
  const [isConnected, setIsConnected] = useState(false);

  // socket.io connection
  const socketRef = useRef<Socket | null>(null);

  // routing 
  const router = useRouter();
  const { gameCode } = router.query;

// socket.io setup and message handling
  useEffect(() => {
    if (!gameCode || typeof gameCode !== 'string') {
      console.warn("Invalid game code:", gameCode);
      return;
    }

    console.log("🔌 Initializing Socket.IO connection for spectator");
    const socket = initializeSocket(gameCode, 'spectator', 'none', '0');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log("✅ Connected as spectator to session:", gameCode);
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log("🛑 Spectator connection closed");
      setIsConnected(false);
    });

    socket.on('cameraFrame', (frame: Frame) => {
      try {
        if (!frame.username || !frame.frame) {
          console.warn("Invalid frame data received:", frame);
          return;
        }

        setFrameMap(prev => {
          const newMap = new Map(prev);
          newMap.set(frame.username, frame.frame);
          return newMap;
        });

        setUsernames(prev => {
          if (!prev.includes(frame.username)) {
            return [...prev, frame.username];
          }
          return prev;
        });
      } catch (err) {
        console.error("❌ Error processing frame:", err);
      }
    });

    socket.on('gameUpdate', (data: any) => {
      console.log("🎮 Game update received:", data);
      
      if (Array.isArray(data.teams)) {
        const teamsWithScores = data.teams.map((team: Team) => ({
          ...team,
          score: team.players.reduce((sum: number, p: Player) => sum + p.points, 0)
        }));
        setTeams(teamsWithScores);
      }

      if (typeof data.timeLeft === 'number') {
        const minutes = Math.floor(data.timeLeft / 60);
        const seconds = data.timeLeft % 60;
        setGameTimeString(
          `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        );

        if (data.timeLeft <= 0) {
          router.push({
            pathname: "/TeamLeaderboard",
            query: { 
              gameCode,
              teamsData: JSON.stringify(teams)
            },
          });
        }
      }
    });

    return () => {
      console.log("Cleaning up socket connection");
      if (socketRef.current) {
        closeSocket();
        socketRef.current = null;
      }
    };
  }, [gameCode]);

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
  const currentPlayer = teams
    .flatMap(team => team.players)
    .find(p => p.username === currentUsername);
  
  const currentTeam = teams.find(team => team.teamId === currentTeamId);

  const toggleViewMode = () => {
    if (viewMode === 'all') {
      setViewMode('team');
      if (teams.length > 0) {
        setCurrentTeamId(teams[0].teamId);
      }
    } else {
      setViewMode('all');
      setCurrentTeamId(null);
    }
    setCurrentIndex(0);
  };

  const switchTeam = (teamId: number) => {
    setCurrentTeamId(teamId);
    setCurrentIndex(0);
    const teamPlayers = teams.find(t => t.teamId === teamId)?.players || [];
    setUsernames(teamPlayers.map(p => p.username));
  };

  return (
    // full-screen dark spectator interface
    <div
      style={{
        backgroundColor: "#000",
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        color: "white",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      {/* Connection Status */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        padding: '8px 12px',
        borderRadius: '4px',
        backgroundColor: isConnected ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 0, 0, 0.2)',
        color: isConnected ? '#00ff00' : '#ff0000'
      }}>
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>

      {/* Header Section */}
      <div style={{ width: "100%", marginBottom: "20px", textAlign: "center" }}>
        <h2>Game Time: {gameTimeString}</h2>
        <div style={{ marginTop: "10px" }}>
          <button
            onClick={toggleViewMode}
            style={{
              ...buttonStyle,
              backgroundColor: viewMode === 'team' ? '#4a90e2' : '#1f2937'
            }}
          >
            {viewMode === 'team' ? 'Switch to All Players' : 'Switch to Team View'}
          </button>
        </div>
      </div>

      {/* Team Selection (visible only in team mode) */}
      {viewMode === 'team' && (
        <div style={{ 
          display: "flex", 
          gap: "10px", 
          flexWrap: "wrap", 
          justifyContent: "center",
          marginBottom: "20px" 
        }}>
          {teams.map(team => (
            <button
              key={team.teamId}
              onClick={() => switchTeam(team.teamId)}
              style={{
                ...buttonStyle,
                backgroundColor: currentTeamId === team.teamId ? '#4a90e2' : '#1f2937',
                padding: '8px 16px',
              }}
            >
              Team {team.teamId} (Score: {team.score})
            </button>
          ))}
        </div>
      )}

      {/* Current View Info */}
      <h2 style={{ marginBottom: "20px" }}>
        {currentUsername ? (
          <>
            Viewing: {currentUsername}
            {currentTeamId && ` (Team ${currentTeamId})`}
          </>
        ) : (
          <>
            Waiting for streams
            <span className="loading-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </>
        )}
      </h2>

      {/* Stream Display */}
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
            src="/images/scope.png"
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

      {/* Player Stats */}
      {currentPlayer && (
        <div
          style={{
            marginTop: "20px",
            padding: "15px",
            backgroundColor: "rgba(255, 255, 255, 0.1)",
            borderRadius: "8px",
            textAlign: "center"
          }}
        >
          <h3 style={{ marginBottom: "10px" }}>Player Stats</h3>
          <p>
            <strong>Points:</strong> {currentPlayer.points}
          </p>
          <p>
            <strong>Hits Given:</strong> {currentPlayer.hitsGiven}
          </p>
          <p>
            <strong>Hits Taken:</strong> {currentPlayer.hitsTaken}
          </p>
          {currentTeam && (
            <p>
              <strong>Team Score:</strong> {currentTeam.score}
            </p>
          )}
        </div>
      )}

      {/* Navigation Buttons */}
      {usernames.length > 1 && (
        <div style={{ marginTop: "20px", display: "flex", gap: "20px" }}>
          <button onClick={goToPrev} style={buttonStyle}>
            Previous Player
          </button>
          <button onClick={goToNext} style={buttonStyle}>
            Next Player
          </button>
        </div>
      )}

      {/* Home Button */}
      <button
        onClick={() => router.push("/")}
        style={{
          marginTop: "30px",
          padding: "12px 24px",
          fontSize: "16px",
          borderRadius: "8px",
          backgroundColor: "#800080",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          transition: "background-color 0.3s"
        }}
        onMouseOver={e => e.currentTarget.style.backgroundColor = "#9400d3"}
        onMouseOut={e => e.currentTarget.style.backgroundColor = "#800080"}
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