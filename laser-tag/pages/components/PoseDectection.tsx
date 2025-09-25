// components/PoseDetection.tsx
import { useEffect } from "react";

export default function PoseDetection() {
  useEffect(() => {
    const loadModel = async () => {
      const posedetection = await import("@tensorflow-models/pose-detection");
      const detector = await posedetection.createDetector(
        posedetection.SupportedModels.MoveNet
      );
      console.log("Pose model loaded", detector);
    };

    loadModel();
  }, []);

  return <div>Camera ready (loading model in background)...</div>;
}
