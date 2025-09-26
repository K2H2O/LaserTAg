import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";

interface Player {
  username: string;
  color: string;
}

interface Team {
  teamId: number;
  players: Player[];
}

export default function TeamLobby() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [adminUsername, setAdminUsername] = useState("");
  const [gameStatus, setGameStatus] = useState<'lobby' | 'starting' | 'active'>('lobby');
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const router = useRouter();
  const { gameCode, username, color, teamId } = router.query;

  // Auto-admin logic: if no admin set and we have username, make this user admin
  const isAdmin = adminUsername === username || (adminUsername === "" && username);

  useEffect(() => {
    if (!gameCode || !username || !color || !teamId) {
      console.warn("❌ Missing required data:", { gameCode, username, color, teamId });
      return;
    }

    function connectWebSocket() {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        console.log("🔗 WebSocket already connected, skipping...");
        return;
      }

      console.log(`🔄 Connecting to WebSocket (attempt ${reconnectAttempts.current + 1})`);

      // Try multiple URL formats in case server expects different format
      const wsUrl = `wss://bbd-lasertag.onrender.com/session/${gameCode}?username=${username}&color=${color}&teamId=${teamId}`;
      console.log("🌐 WebSocket URL:", wsUrl);
      
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("🔗 TeamLobby WebSocket connected successfully");
        setIsConnected(true);
        reconnectAttempts.current = 0;

        // Send initial team join message
        socket.send(JSON.stringify({
          type: "joinTeam",
          username,
          color,
          teamId,
          gameCode
        }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("📨 TeamLobby received message:", data);

          // Handle multiple possible message types from server
          switch (data.type) {
            case "TeamListUpdate":
            case "gameUpdate":
            case "playerJoin":
            case "teamUpdate":
              console.log("👥 Processing team data:", data);
              
              if (data.teams && Array.isArray(data.teams)) {
                setTeams(data.teams);
                console.log("✅ Teams updated:", data.teams);
              }

              if (data.admin) {
                setAdminUsername(data.admin);
                console.log("👑 Admin set:", data.admin);
              }

              // Check if game is starting
              if (data.state === "game" || data.gameStarted === true) {
                console.log("🎮 Game starting detected, redirecting...");
                setGameStatus('starting');
                router.push({
                  pathname: "/TeamCameraView",
                  query: { username, gameCode, color, teamId },
                });
              }
              break;

            case "startGame":
              console.log("🚀 Start game signal received");
              setGameStatus('starting');
              router.push({
                pathname: "/TeamCameraView",
                query: { username, gameCode, color, teamId },
              });
              break;

            case "playerList":
              // Handle solo-style player list, convert to teams
              if (data.players) {
                const teamMap = new Map<number, Player[]>();
                
                data.players.forEach((player: any) => {
                  const pTeamId = player.teamId || teamId;
                  if (!teamMap.has(pTeamId)) {
                    teamMap.set(pTeamId, []);
                  }
                  teamMap.get(pTeamId)!.push({
                    username: player.username,
                    color: player.color
                  });
                });

                const convertedTeams = Array.from(teamMap.entries()).map(([id, players]) => ({
                  teamId: id,
                  players
                }));

                setTeams(convertedTeams);
                console.log("✅ Teams converted from player list:", convertedTeams);
              }
              break;

            default:
              console.log("ℹ️ Unhandled message type:", data.type);
          }
        } catch (error) {
          console.error("❌ Error parsing WebSocket message:", error, event.data);
        }
      };

      socket.onclose = (event) => {
        console.log(`🔌 TeamLobby WebSocket closed. Code: ${event.code}, Reason: "${event.reason}"`);
        setIsConnected(false);

        if (event.code !== 1000 && event.code !== 1001 && reconnectAttempts.current < maxReconnectAttempts && gameStatus === 'lobby') {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
          console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, delay);
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          console.error("❌ Max reconnection attempts reached");
          alert("Connection lost. Please refresh the page.");
        }
      };

      socket.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
        setIsConnected(false);
      };
    }

    connectWebSocket();

    return () => {
      console.log("🧹 TeamLobby cleanup");

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.close(1000, "Component unmounting");
        socketRef.current = null;
      }
    };
  }, [gameCode, username, color, teamId, router, gameStatus]);

  const handleStartGame = () => {
    console.log("🎮 Attempting to start team game...");
    console.log("🔍 Debug info:", {
      isConnected,
      socketState: socketRef.current?.readyState,
      isAdmin,
      adminUsername,
      username
    });

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.warn("⚠️ Cannot start game - WebSocket not connected");
      alert("Connection lost. Please refresh the page.");
      return;
    }

    const startMessage = {
      type: "startGame",
      gameCode,
      username,
      teamId
    };

    console.log("📤 Sending start game message:", startMessage);
    socketRef.current.send(JSON.stringify(startMessage));
    setGameStatus('starting');
  };

  const goBackToHome = () => {
    router.push("/");
  };

  // Force show start button if user is admin and we have teams
  const showStartButton = isAdmin && isConnected;

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

      {/* Connection Status */}
      <div style={{ 
        marginBottom: "1rem", 
        padding: "0.5rem", 
        backgroundColor: isConnected ? "rgba(0, 255, 0, 0.2)" : "rgba(255, 0, 0, 0.2)",
        borderRadius: "5px",
        border: isConnected ? "1px solid green" : "1px solid red"
      }}>
        Status: {isConnected ? "Connected" : "Disconnected"}
        {isAdmin && <span style={{ marginLeft: "10px", color: "#FFD700" }}>(Admin)</span>}
      </div>

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
                border: team.teamId === Number(teamId) ? "3px solid #00bfff" : "none",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.2rem" }}>
                Team {team.teamId} ({team.players.length} players)
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {team.players.map((player) => (
                  <li
                    key={player.username}
                    style={{
                      backgroundColor: player.color,
                      color: "#333",
                      padding: "0.5rem",
                      marginBottom: "0.5rem",
                      borderRadius: "10px",
                      fontWeight: player.username === username ? "bold" : "normal",
                      textAlign: "center",
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span>{player.username}</span>
                    {player.username === adminUsername && (
                      <span style={{ marginLeft: "10px", color: "#FFD700", fontSize: "16px" }}>👑</span>
                    )}
                    {player.username === username && (
                      <span style={{ color: "#00bfff", marginLeft: "10px" }}>← YOU</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ 
          backgroundColor: "rgba(255, 255, 255, 0.1)", 
          padding: "2rem", 
          borderRadius: "10px",
          textAlign: "center"
        }}>
          <p style={{ color: "#888", fontSize: "18px" }}>
            {isConnected ? "Waiting for teams to join..." : "Connecting to server..."}
          </p>
          {!isConnected && (
            <button 
              onClick={() => window.location.reload()} 
              style={{
                marginTop: "1rem",
                padding: "0.5rem 1rem",
                backgroundColor: "#ff6b6b",
                color: "white",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer"
              }}
            >
              Refresh Page
            </button>
          )}
        </div>
      )}

      {/* Game Controls */}
      <div style={{ 
        marginTop: "2rem", 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        gap: "1rem" 
      }}>
        {gameStatus === 'starting' ? (
          <div
            style={{
              padding: "1rem 2rem",
              backgroundColor: "rgba(255, 215, 0, 0.8)",
              color: "black",
              borderRadius: "10px",
              fontSize: "1.2rem",
              fontWeight: "bold",
              animation: "pulse 1.5s infinite",
            }}
          >
            🚀 Starting Game...
          </div>
        ) : (
          // Show start button if conditions are met
          showStartButton && (
            <button
              onClick={handleStartGame}
              disabled={!isConnected}
              style={{
                padding: "1rem 2rem",
                fontSize: "1.2rem",
                borderRadius: "10px",
                backgroundColor: isConnected ? "#4B004B" : "#666",
                border: "none",
                cursor: isConnected ? "pointer" : "not-allowed",
                color: "#FFFFFF",
                fontWeight: "bold",
                boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3)",
                animation: isConnected ? "float 3s ease-in-out infinite" : "none",
              }}
            >
              🎮 Start Team Game
            </button>
          )
        )}

        <p style={{ fontSize: "14px", opacity: 0.8, textAlign: "center", maxWidth: "400px" }}>
          {!isConnected ? "Connecting..." :
           teams.length === 0 ? "Waiting for teams to join..." :
           `${teams.reduce((sum, team) => sum + team.players.length, 0)} players across ${teams.length} teams`}
          <br />
          {!showStartButton && isConnected && teams.length > 0 && "Waiting for admin to start the game..."}
        </p>
      </div>

      {/* Debug Info (remove in production) */}
      <div style={{
        position: "absolute",
        bottom: "100px",
        left: "10px",
        backgroundColor: "rgba(0,0,0,0.8)",
        color: "white",
        padding: "10px",
        borderRadius: "5px",
        fontSize: "12px",
        maxWidth: "300px"
      }}>
        <strong>Debug:</strong><br />
        Connected: {isConnected ? "✅" : "❌"}<br />
        Teams: {teams.length}<br />
        Admin: {adminUsername || "None"}<br />
        Is Admin: {isAdmin ? "✅" : "❌"}<br />
        Show Start: {showStartButton ? "✅" : "❌"}
      </div>

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
        }}
        onClick={goBackToHome}
      >
        ← Back to Home
      </button>

      <style jsx>{`
        @keyframes float {
          0% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
          100% { transform: translateY(0); }
        }
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.6; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}