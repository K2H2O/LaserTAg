import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import { Socket } from "socket.io-client";
import { initializeSocket, closeSocket } from "../client/src/utils/socket";

interface Player {
  username: string;
  color: string;
}

interface Team {
  teamId: number;
  players: Player[];
}

interface Message {
  type: string;
  teams?: Team[];
  admin?: string;
}

export default function TeamLobby() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [adminUsername, setAdminUsername] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const router = useRouter();
  const { gameCode, username, color, teamId } = router.query;

  useEffect(() => {
    // Early return if required data is missing
    if (!gameCode || !username || !color || !teamId) {
      console.warn("❌ Missing required data:", { gameCode, username, color, teamId });
      return;
    }

    if (typeof gameCode !== "string" || !/^[a-z]{4}$/.test(gameCode)) {
      console.warn("❌ Invalid gameCode:", gameCode);
      alert("Invalid game code. Please use a 4-letter code.");
      return;
    }

    // Initialize Socket.IO connection
    const socket = initializeSocket(gameCode, username as string, color as string, teamId as string);
    socketRef.current = socket;

    // Handle connection status
    socket.on('connect', () => {
      console.log("🔗 Connected to game server");
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log("� Disconnected from game server");
      setIsConnected(false);
    });

    // Handle game events
    socket.on('playerListUpdate', (data: { teams: Team[], admin: string }) => {
      console.log("👥 Team list update:", data.teams);
      setTeams(data.teams);
      setAdminUsername(data.admin);
    });

    socket.on('startGame', () => {
      router.push({
        pathname: "/TeamCameraView",
        query: { username, gameCode, color, teamId },
      });
    });

    socket.on('connect_error', (error: Error) => {
      console.error("❌ Connection error:", error);
    });

    socket.on('error', (error: { message: string }) => {
      console.error("❌ Socket error:", error);
      alert(error.message || "An error occurred");
    });

    // Cleanup on component unmount
    return () => {
      console.log("🧹 Cleaning up socket connection");
      closeSocket();
      socketRef.current = null;
    };
  }, [gameCode, username, color, teamId, router]);

  const handleStartGame = () => {
    if (socketRef.current && isConnected) {
      console.log("🎮 Starting game...");
      socketRef.current.emit("startGame", { gameCode });
    } else {
      console.warn("⚠️ Cannot start game - Socket not connected");
      alert("Connection lost. Please refresh the page.");
    }
  };

  const goBackToHome = () => {
    router.push("/");
  };

  return (
    <div
      style={{
        padding: "2rem",
        backgroundImage: "url('/images/Laser-Tag-Lobby.png')",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        minHeight: "100vh",
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          textAlign: "center",
          paddingTop: "1rem",
          paddingBottom: "2rem",
        }}
      >
        <img
          src="/images/Laser-Tag.png"
          alt="Logo"
          style={{
            maxWidth: "300px",
            maxHeight: "120px",
            objectFit: "contain",
          }}
        />
      </div>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
        Game Code: <span style={{ color: "#00bfff" }}>{gameCode}</span>
      </h1>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
        You are: <span style={{ color: "#00bfff" }}>{username}</span> (Team {teamId})
      </h1>

      <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
        Teams in Lobby:
      </h2>

      {teams.length > 0 ? (
        <div
          style={{
            width: "100%",
            maxWidth: "600px",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          {teams.map((team) => (
            <div
              key={team.teamId}
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                padding: "1rem",
                borderRadius: "10px",
                boxShadow: "0 6px 15px rgba(0, 0, 0, 0.3)",
                border:
                  team.teamId === Number(teamId)
                    ? "3px solid #00bfff"
                    : "none",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.2rem" }}>
                Team {team.teamId}
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {team.players.map(({ username: playerName, color }) => (
                  <li
                    key={playerName}
                    style={{
                      backgroundColor: color,
                      color: "#333",
                      padding: "0.5rem",
                      marginBottom: "0.5rem",
                      borderRadius: "10px",
                      fontWeight: playerName === username ? "bold" : "normal",
                      textAlign: "center",
                      position: "relative",
                      transition: "transform 0.3s ease, box-shadow 0.3s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-4px)";
                      e.currentTarget.style.boxShadow =
                        "0 6px 12px rgba(0, 0, 0, 0.4)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <span style={{ position: "relative", zIndex: 1 }}>
                      {playerName}
                    </span>
                    {playerName === adminUsername && (
                      <img
                        src="/images/admin-crown.png"
                        alt="Admin Icon"
                        style={{
                          position: "absolute",
                          right: "0.5rem",
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: "20px",
                          height: "20px",
                          zIndex: 2,
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: "#888" }}>No teams yet...</p>
      )}
      {adminUsername === username && (
        <button
          style={{
            marginTop: "1.5rem",
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            borderRadius: "5px",
            backgroundColor: "#4B004B",
            border: "none",
            cursor: "pointer",
            color: "#FFFFFF",
            fontWeight: "bold",
            boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3)",
            position: "relative",
            animation: "float 3s ease-in-out infinite",
          }}
          onClick={handleStartGame}
        >
          Start Game
        </button>
      )}
      <button
        style={{
          marginTop: "1.5rem",
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          borderRadius: "5px",
          backgroundColor: "#800080",
          border: "none",
          cursor: "pointer",
          color: "#FFFFFF",
          fontWeight: "bold",
          boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3)",
          position: "relative",
        }}
        onClick={goBackToHome}
      >
        Back to Home
      </button>
      <style>
        {`
          @keyframes float {
            0% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
            100% { transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}