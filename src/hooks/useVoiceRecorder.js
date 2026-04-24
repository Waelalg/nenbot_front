import { useEffect, useRef, useState } from "react";

const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
];

function pickMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) {
    return "";
  }
  return MIME_TYPES.find((mimeType) => window.MediaRecorder.isTypeSupported(mimeType)) || "";
}

export function useVoiceRecorder(onAudioReady) {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");

  const isSupported =
    typeof window !== "undefined" &&
    "MediaRecorder" in window &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (!isRecording) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);

    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, []);

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }

  async function startRecording() {
    setError("");
    if (!isSupported) {
      setError("This browser does not support microphone recording for NENBOT.");
      return;
    }
    if (isRecording) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError("The browser stopped microphone recording unexpectedly.");
        setIsRecording(false);
        cleanupStream();
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });

        setIsRecording(false);
        setElapsedMs(0);
        cleanupStream();

        if (!blob.size) {
          setError("No audio was captured. Try speaking louder or checking the microphone.");
          return;
        }

        Promise.resolve(onAudioReady?.(blob)).catch(() => {});
      };

      recorder.start(250);
      setIsRecording(true);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "NENBOT could not access the microphone.",
      );
      cleanupStream();
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    recorder.stop();
  }

  return {
    error,
    elapsedMs,
    isRecording,
    isSupported,
    startRecording,
    stopRecording,
  };
}
