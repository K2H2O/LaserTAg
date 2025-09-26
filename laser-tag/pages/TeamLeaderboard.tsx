import { useEffect, useState } from "react";
import { useRouter } from "next/router";

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

const TeamLeaderboard = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentTime] = useState(new Date());
  const router = useRouter();
  const { gameCode, teamsData } = router.query;
  //const { gameCode, username } = state || { gameCode: "123", username: "" }; // Default gameCode to "123"
  //const navigate = useNavigate();

  useEffect(() => {
    if (typeof teamsData === "string") {
      try {
        const parsedTeams = JSON.parse(teamsData);
        if (Array.isArray(parsedTeams)) {
          console.log('Successfully parsed teams data:', parsedTeams);
          setTeams(parsedTeams);
        } else {
          throw new Error("Parsed teams data is not an array");
        }
      } catch (error) {
        console.error("Error parsing teams data:", error);
        // Set default teams data
        setDefaultTeams();
      }
    } else {
      console.log('No teams data provided, using default data');
      setDefaultTeams();
    }
  }, [teamsData]);

  const setDefaultTeams = () => {
    const defaultTeams = [
      {
        teamId: 1,
        players: [
          { username: 'player1', color: 'red', points: 50, hitsGiven: 5, hitsTaken: 2 },
          { username: 'player2', color: 'red', points: 30, hitsGiven: 3, hitsTaken: 4 }
        ],
        score: 80
      },
      {
        teamId: 2,
        players: [
          { username: 'player3', color: 'blue', points: 75, hitsGiven: 8, hitsTaken: 3 },
          { username: 'player4', color: 'blue', points: 45, hitsGiven: 4, hitsTaken: 5 }
        ],
        score: 120
      }
    ];
    setTeams(defaultTeams);
  };

  const goBackToLanding = () => {
    router.push("/")
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundImage: "url('/images/Laser-Tag-Lobby.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "Arial, sans-serif",
        padding: "2rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          width: "100%",
          padding: "1rem",
          backgroundColor: "rgba(75, 0, 130, 0.9)",
          borderRadius: "10px",
          marginBottom: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2rem" }}>
          <img
            src="/images/Laser-Tag.png"
            alt="Logo"
            style={{ width: "120px", height: "auto" }}
          />
          <div>
            <h1 style={{ fontSize: "2.5rem", margin: "0 0 0.5rem 0" }}>Game Results</h1>
            <p>Game Code: {gameCode}</p>
            <p>Finished: {currentTime.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}</p>
          </div>
        </div>
      </div>

      {/* Team Rankings */}
      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          borderRadius: "10px",
          padding: "2rem",
          marginBottom: "2rem",
        }}
      >
        <h2 style={{ textAlign: "center", marginBottom: "1.5rem", fontSize: "2rem" }}>Team Rankings</h2>
        <div style={{ display: "grid", gap: "1rem" }}>
          {teams.length > 0 ? (
            teams
              .sort((a, b) => b.score - a.score)
              .map((team, index) => {
                const totalHits = team.players.reduce((sum, p) => sum + p.hitsGiven, 0);
                const totalTaken = team.players.reduce((sum, p) => sum + p.hitsTaken, 0);
                const accuracy = totalHits / (totalHits + totalTaken) * 100 || 0;

                return (
                  <div
                    key={team.teamId}
                    style={{
                      backgroundColor: index === 0 ? "rgba(255, 215, 0, 0.3)" : 
                                    index === 1 ? "rgba(192, 192, 192, 0.3)" : 
                                    index === 2 ? "rgba(205, 127, 50, 0.3)" : 
                                    "rgba(255, 255, 255, 0.1)",
                      padding: "1.5rem",
                      borderRadius: "8px",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto", gap: "1.5rem", alignItems: "center" }}>
                      <span style={{ fontSize: "2rem" }}>
                        {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
                      </span>
                      <span style={{ fontWeight: "bold", fontSize: "1.2rem" }}>Team {team.teamId}</span>
                      <span>Score: {team.score}</span>
                      <span>Hits: {totalHits}</span>
                      <span>Taken: {totalTaken}</span>
                      <span>Accuracy: {accuracy.toFixed(1)}%</span>
                    </div>
                    
                    {/* Team Players List */}
                    <div style={{ marginTop: "1rem", paddingLeft: "3rem" }}>
                      {team.players.map(player => (
                        <div 
                          key={player.username}
                          style={{ 
                            display: "grid", 
                            gridTemplateColumns: "1fr auto auto auto",
                            gap: "1rem",
                            margin: "0.5rem 0",
                            color: "rgba(255, 255, 255, 0.8)"
                          }}
                        >
                          <span>{player.username}</span>
                          <span>Points: {player.points}</span>
                          <span>Hits: {player.hitsGiven}</span>
                          <span>Taken: {player.hitsTaken}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
          ) : (
            <p style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.6)" }}>
              No team data available
            </p>
          )}
        </div>
      </div>

      {/* Back to Home Button */}
      <button
        onClick={() => router.push("/")}
        style={{
          padding: "1rem 2rem",
          fontSize: "1.2rem",
          borderRadius: "8px",
          backgroundColor: "#800080",
          border: "none",
          cursor: "pointer",
          color: "#fff",
          transition: "all 0.3s ease",
        }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = "#9400d3"}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = "#800080"}
      >
        Back to Home
      </button>
    </div>
  );
};

export default TeamLeaderboard;