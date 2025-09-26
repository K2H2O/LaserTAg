import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function LandingPage() {
  const [gameCode, setGameCode] = useState("");
  const [username, setUsername] = useState("");
  const router = useRouter();

  // Access query parameters
  const { gameCode: queryGameCode, username: queryUsername } = router.query;

  useEffect(() => {
    // Set gameCode and username from query parameters if they exist
    if (queryGameCode && typeof queryGameCode === "string") {
      setGameCode(queryGameCode);
    }
    if (queryUsername && typeof queryUsername === "string") {
      setUsername(queryUsername);
    }
  }, [queryGameCode, queryUsername]);

  const isValidCode = (Code: string) => Code.length === 4;

  const goToCalibration = () => {
    if (!isValidCode(gameCode)) {
      alert("Please enter a valid 4-letter game code.");
      return;
    }
    router.push({
      pathname: "/calibration",
      query: { gameCode },
    });
  };

  const joinSpectatorStreaming = () => {
    if (!isValidCode(gameCode)) {
      alert("Please enter a valid 4-letter game code.");
      return;
    }
    router.push({
      pathname: "/SpectatorStreaming",
      query: { gameCode },
    });
  };

  const joinTeam = () => {
    if (!isValidCode(gameCode)) {
      alert("Please enter a valid 4-letter game code.");
      return;
    }
    router.push({
      pathname: "/TeamCalibration",
      query: { gameCode },
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100vw",
        position: "relative",
        padding: 0,
        margin: 0,
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* GIF Background */}
      <img
        src="/images/laser-tag-landing.gif"
        alt="Background"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          objectFit: "cover",
          zIndex: -1,
        }}
      />

      {/* Logo Section */}
      <div
        style={{
          height: "25vh",
          width: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "0",
          marginTop: "-20vh",
          zIndex: 1,
        }}
      >
        <img
          src="/images/Laser-Tag.png"
          alt="Game Logo"
          style={{
            maxHeight: "90%",
            maxWidth: "90%",
            objectFit: "contain",
          }}
        />
      </div>

      {/* Content Container */}
      <div
        style={{
          backgroundColor: "rgba(26, 26, 26, 0.8)",
          padding: "1.5rem",
          borderRadius: "10px",
          boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3)",
          textAlign: "center",
          zIndex: 1,
          maxHeight: "50vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          marginTop: "0",
        }}
      >
        <h1 style={{ marginBottom: "0.5rem", color: "#fff" }}>Enter Code:</h1>
        <input
          type="text"
          value={gameCode}
          onChange={(e) =>
            setGameCode(
              e.target.value
                .replace(/[^a-zA-Z]/g, "")
                .toLowerCase()
                .slice(0, 4)
            )
          }
          placeholder="Game Code"
          style={{
            padding: "0.5rem 1rem",
            fontSize: "1rem",
            borderRadius: "5px",
            border: "none",
            marginBottom: "0.75rem",
            textAlign: "center",
            backgroundColor: "#333",
            color: "#fff",
            outline: "none",
          }}
        />

        <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
          <button
            onClick={goToCalibration}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              borderRadius: "5px",
              backgroundColor: "#00bfff",
              border: "none",
              cursor: "pointer",
              color: "#fff",
              transition: "background-color 0.3s",
            }}
            onMouseOver={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#00aaff";
            }}
            onMouseOut={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#00bfff";
            }}
          >
            Join as Player
          </button>

          <button
            onClick={joinSpectatorStreaming}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              borderRadius: "5px",
              backgroundColor: "#888",
              border: "none",
              cursor: "pointer",
              color: "#fff",
              transition: "background-color 0.3s",
            }}
            onMouseOver={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#666";
            }}
            onMouseOut={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#888";
            }}
          >
            Join as Spectator
          </button>

          <button
            onClick={joinTeam}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              borderRadius: "5px",
              backgroundColor: "#ff4500",
              border: "none",
              cursor: "pointer",
              color: "#fff",
              transition: "background-color 0.3s",
            }}
            onMouseOver={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#cc3700";
            }}
            onMouseOut={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#ff4500";
            }}
          >
            Join Team
          </button>
        </div>
      </div>
    </div>
  );
}