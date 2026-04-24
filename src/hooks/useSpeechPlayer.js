import { useEffect, useRef, useState } from "react";

import { synthesizeSpeech } from "../lib/api";

const canUseBrowserSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
const MAX_TTS_CHARS = 180;

function splitForSpeech(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?]+[.!?]*/g) || [normalized];
  const chunks = [];
  let current = "";

  function pushChunk(chunk) {
    if (chunk.trim()) {
      chunks.push(chunk.trim());
    }
  }

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) {
      continue;
    }

    if (trimmedSentence.length > MAX_TTS_CHARS) {
      if (current) {
        pushChunk(current);
        current = "";
      }
      const words = trimmedSentence.split(" ");
      let longChunk = "";
      for (const word of words) {
        const candidate = `${longChunk} ${word}`.trim();
        if (candidate.length > MAX_TTS_CHARS) {
          pushChunk(longChunk);
          longChunk = word;
        } else {
          longChunk = candidate;
        }
      }
      pushChunk(longChunk);
      continue;
    }

    const candidate = `${current} ${trimmedSentence}`.trim();
    if (candidate.length > MAX_TTS_CHARS) {
      pushChunk(current);
      current = trimmedSentence;
    } else {
      current = candidate;
    }
  }

  pushChunk(current);
  return chunks;
}

export function useSpeechPlayer() {
  const audioRef = useRef(null);
  const objectUrlRef = useRef("");
  const playbackRunRef = useRef(0);

  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem("nenbot_voice_output") === "true");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener("ended", handlePlaybackEnd);
    audio.addEventListener("error", handlePlaybackEnd);
    audioRef.current = audio;

    return () => {
      audio.removeEventListener("ended", handlePlaybackEnd);
      audio.removeEventListener("error", handlePlaybackEnd);
      cleanupObjectUrl();
      audio.pause();
      if (canUseBrowserSpeech) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function handlePlaybackEnd() {
    setIsSpeaking(false);
    cleanupObjectUrl();
  }

  function cleanupObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  }

  function stop() {
    playbackRunRef.current += 1;
    cleanupObjectUrl();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (canUseBrowserSpeech) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }

  function toggleVoice() {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    localStorage.setItem("nenbot_voice_output", String(next));
    if (!next) {
      stop();
    }
  }

  async function speak(text) {
    if (!voiceEnabled || !text.trim()) {
      return;
    }

    setError("");
    stop();
    const runId = playbackRunRef.current;
    const chunks = splitForSpeech(text);

    try {
      for (const chunk of chunks) {
        if (playbackRunRef.current !== runId || !voiceEnabled) {
          return;
        }
        const audioBlob = await synthesizeSpeech(chunk);
        await playBlob(audioBlob, runId);
      }
      return;
    } catch (serverError) {
      if (!canUseBrowserSpeech) {
        setError(serverError instanceof Error ? serverError.message : "Voice playback is unavailable.");
        return;
      }
    }

    try {
      await speakWithBrowser(text);
    } catch (browserError) {
      setError(browserError instanceof Error ? browserError.message : "Voice playback is unavailable.");
    }
  }

  function playBlob(blob, runId) {
    return new Promise((resolve, reject) => {
      const audio = audioRef.current;
      if (!audio) {
        reject(new Error("Audio playback is not available."));
        return;
      }

      cleanupObjectUrl();
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      audio.src = objectUrl;
      setIsSpeaking(true);

      const handleEnded = () => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        cleanupObjectUrl();
        if (playbackRunRef.current === runId) {
          resolve();
        }
      };

      const handleError = () => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        cleanupObjectUrl();
        reject(new Error("The generated voice clip could not be played."));
      };

      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("error", handleError);
      audio.play().catch((error) => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        cleanupObjectUrl();
        reject(error);
      });
    });
  }

  function speakWithBrowser(text) {
    return new Promise((resolve, reject) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => {
          setIsSpeaking(false);
          resolve();
        };
        utterance.onerror = () => {
          setIsSpeaking(false);
          reject(new Error("The browser could not read the answer aloud."));
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    error,
    isSpeaking,
    speak,
    stop,
    toggleVoice,
    voiceEnabled,
  };
}
