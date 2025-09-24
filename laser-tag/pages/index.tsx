import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

export default function LandingPage() {
  const [gameCode, setGameCode] = useState("");
  const [username, setUsername] = useState("");
  // for sound
  const [isSoundEnabled, setIsSoundEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  //const navigate = useNavigate();
  const router = useRouter()

  //const { state } = useLocation();
  // Access query parameters (equivalent to useLocation().state in react-router-dom)
  const { gameCode: queryGameCode, username: queryUsername } = router.query;

  
  //useEffect(() => {
  //  if (state) {
  //    setGameCode(state.gameCode || "");
  //    setUsername(state.username || "");
  //  }
  //}, [state]);

 useEffect(() => {
    // Set gameCode and username from query parameters if they exist
    if (queryGameCode && typeof queryGameCode === "string") {
      setGameCode(queryGameCode);
    }
    if (queryUsername && typeof queryUsername === "string") {
      setUsername(queryUsername);
    }

    // Load sound preference from localStorage
    const savedSoundPreference = localStorage.getItem("gameSoundEnabled");
    if (savedSoundPreference !== null) {
      setIsSoundEnabled(JSON.parse(savedSoundPreference));
    }

    // Initialize audio
    if (typeof window !== "undefined") {
      audioRef.current = new Audio("/audio/games_sound.wav");
      audioRef.current.loop = true;
      audioRef.current.volume = 0.5; // Set volume to 50%
      
      // Load the audio file
      audioRef.current.load();
    }

    return () => {
      // Cleanup audio when component unmounts
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [queryGameCode, queryUsername]);

  useEffect(() => {
    // Handle sound playing based on isSoundEnabled state
    if (audioRef.current) {
      if (isSoundEnabled && !isPlaying) {
        audioRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch((error) => {
          console.log("Audio play failed:", error);
          // Handle autoplay restrictions
          setIsSoundEnabled(false);
        });
      } else if (!isSoundEnabled && isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [isSoundEnabled, isPlaying]);
  const toggleSound = async () => {
    const newSoundState = !isSoundEnabled;
    setIsSoundEnabled(newSoundState);
    
    // Save preference to localStorage
    localStorage.setItem("gameSoundEnabled", JSON.stringify(newSoundState));
    
    // Send preference to backend (optional)
    try {
      await fetch("/api/sound-preference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          soundEnabled: newSoundState,
          timestamp: new Date().toISOString()
        }),
      });
    } catch (error) {
      console.log("Failed to save sound preference to server:", error);
    }
  };


  const isValidCode = (Code:string) => Code.length === 4;

  const goToCalibration = () => {
    if (!isValidCode(gameCode)) {
      alert("Please enter a valid 4-letter game code.");
      return;
    }
    //navigate("/calibration", {
    //  state: {
    //    gameCode,
    //  },
    //});
    router.push({
      pathname: "/calibration",
      query: { gameCode , soundEnabled : isSoundEnabled.toString()},
    });
  };

  const joinSpectatorStreaming = () => {
    if (!isValidCode(gameCode)) {
      alert("Please enter a valid 4-letter game code.");
      return;
    }
    //navigate("/spectator_stream", {
    //  state: {
    //    gameCode,
    //  },
    //});
    router.push({
      pathname: "/spectator_stream",
      query: { gameCode, soundEnabled: isSoundEnabled.toString() },
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
            onMouseOver={(e) => {const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#00aaff"}}
            onMouseOut={(e) => {const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#800080"}}
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
            onMouseOver={(e) => {const target = e.target as HTMLButtonElement;
               target.style.backgroundColor = "#00aaff"}}
            onMouseOut={(e) => { const target = e.target as HTMLButtonElement;
              target.style.backgroundColor = "#800080"}}
          >
            Join as Spectator
          </button>
        </div>
      </div>

      {/* Sound Toggle Button */}
      <button
        onClick={toggleSound}
        style={{
          position: "absolute",
          bottom: "2rem",
          left: "50%",
          transform: "translateX(-50%)",
          width: "60px",
          height: "60px",
          borderRadius: "50%",
          backgroundColor: "rgba(68, 68, 68, 0.9)",
          border: "2px solid #fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.3s ease",
          zIndex: 2,
        }}
        onMouseOver={(e) => {
          const target = e.target as HTMLButtonElement;
          target.style.backgroundColor = "rgba(88, 88, 88, 0.9)";
          target.style.transform = "translateX(-50%) scale(1.1)";
        }}
        onMouseOut={(e) => {
          const target = e.target as HTMLButtonElement;
          target.style.backgroundColor = "rgba(68, 68, 68, 0.9)";
          target.style.transform = "translateX(-50%) scale(1)";
        }}
      >
        {isSoundEnabled ? (
          // Sound ON icon
          <svg 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="#fff"
          >
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        ) : (
          // Sound OFF icon
          <svg 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="#fff"
          >
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        )}
      </button>
    </div>
  );
}