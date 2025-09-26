// React hooks for state/ref management, Next.js router for navigation
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";

interface Player {
  username: string;
  color: string;
}// Defines player data structure with username and color


interface Team {
  teamId: number;
  players: Player[];
}
//defines team structure with ID and list of players
interface Message {
  type: string;
  teams?: Team[];
  admin?: string;
}
//Defines WebSocket message structure for team updates and admin info
export default function TeamLobby() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [adminUsername, setAdminUsername] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // State for teams and admin, refs for WebSocket and reconnection logic
  const router = useRouter();
  const { gameCode, username, color, teamId } = router.query;

  // extract game parameters from URL query
  useEffect(() => {
    // Early return if required data is missing
    if (!gameCode || !username || !color || !teamId) {
      console.warn("❌ Missing required data:", { gameCode, username, color, teamId });
      return;
    }

    function connectWebSocket() {
      if (
        socketRef.current &&
        socketRef.current.readyState === WebSocket.OPEN
      ) {
        console.log("🔗 WebSocket already connected, skipping...");
        return;
      }

      console.log(
        `🔄 Connecting to WebSocket (attempt ${reconnectAttempts.current + 1})`
      );

      const socket = new WebSocket(
        `wss://bbd-lasertag.onrender.com/team-session/${gameCode}?username=${username}&color=${color}&teamId=${teamId}`
      );
      socketRef.current = socket;

      // Establishes WebSocket connection with query parameters
      socket.onopen = () => {
        console.log("🔗 TeamLobby WebSocket connected");
        reconnectAttempts.current = 0;
      };
// Resets reconnect attempts on successful connection
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Message;
          console.log("TeamLobby message received:", data);

          if (data.type === "TeamListUpdate") {
            console.log("👥 Team list update:", data.teams);

            if (data.teams) {
              setTeams(data.teams);
            }

            if (data.admin) {
              setAdminUsername(data.admin);
            }
          } else if (data.type === "startGame") {
            router.push({
              pathname: "/TeamCameraView",
              query: { username, gameCode, color, teamId },
            });
          }
        } catch (error) {
          console.error("❌ Error parsing WebSocket message:", error);
        }
      };

// Handles team updates and game start; error handling could be improved
      socket.onclose = (event) => {
        console.log(
          `🔌 TeamLobby WebSocket closed. Code: ${event.code}, Reason: "${event.reason}", WasClean: ${event.wasClean}`
        );

        if (
          event.code !== 1000 &&
          event.code !== 1001 &&
          reconnectAttempts.current < maxReconnectAttempts
        ) {
          reconnectAttempts.current++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts.current),
            10000
          );
          console.log(
            `🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, delay);
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          console.error("❌ Max reconnection attempts reached for PlayerLobby");
          alert("Connection lost. Please refresh the page.");
        }
      };

      socket.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
      };
    }

    connectWebSocket();

    return () => {
      console.log("🧹 PlayerLobby cleanup - closing WebSocket");

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.close(1000, "Component unmounting");
        socketRef.current = null;
      }
    };
  }, [gameCode, username, color, teamId]);

  const handleStartGame = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log("🎮 Starting game...");
      socketRef.current.send(
        JSON.stringify({
          type: "startGame",
          gameCode,
        })
      );
    } else {
      console.warn("⚠️ Cannot start game - WebSocket not connected");
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
      {/* Main container with full-screen background image */}
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
  // Responsive lobby UI with WebSocket updates; move styles to CSS module
}