import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { resetMemory, streamChat, transcribeAudio } from "./lib/api";
import { useSpeechPlayer } from "./hooks/useSpeechPlayer";
import { useVoiceRecorder } from "./hooks/useVoiceRecorder";

const SAMPLE_PROMPTS = [
  "Who is Killua Zoldyck?",
  "Explain Nen simply",
  "List all Nen types",
  "What happened in the Chimera Ant arc?",
  "Who are the Phantom Troupe?",
  "Compare Gon and Killua",
  "What is Greed Island?",
  "What is Bungee Gum?",
  "Who is Fodhil?",
  "Tell me about the team members",
  "What do you remember from our conversation?",
  "Tell me about Naruto",
];

function makeSessionId() {
  const existing = localStorage.getItem("nenbot_session_id");
  if (existing) {
    return existing;
  }
  const created = `nenbot-${crypto.randomUUID?.() || Date.now()}`;
  localStorage.setItem("nenbot_session_id", created);
  return created;
}

function createMessage(role, content, meta = null) {
  return {
    id: `${role}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    role,
    content,
    meta,
  };
}

function buildMeta(metadata) {
  if (!metadata) {
    return [];
  }
  const chips = [
    metadata.intent === "team_info"
      ? "Team info"
      : metadata.intent === "hxh_knowledge"
        ? "Hunter x Hunter"
        : metadata.intent === "allowed_smalltalk"
          ? "Assistant help"
          : "Scope guard",
    `Style: ${(metadata.question_type || "unknown").replaceAll("_", " ")}`,
  ];

  if (metadata.matched_member) {
    chips.push(`Team member: ${metadata.matched_member}`);
  } else if (metadata.detected_entities?.length) {
    chips.push(`Topic: ${metadata.detected_entities[0]}`);
  }

  chips.push(metadata.memory_used ? "Memory used" : "New context");
  return chips;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function App() {
  const [sessionId] = useState(makeSessionId);
  const [messages, setMessages] = useState(() => [
    createMessage(
      "bot",
      "Welcome. I answer Hunter x Hunter questions, project team information, and short usage help.",
    ),
  ]);
  const [input, setInput] = useState("");
  const [statusText, setStatusText] = useState("Ready for Hunter x Hunter questions.");
  const [isSending, setIsSending] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceInputError, setVoiceInputError] = useState("");

  const chatRef = useRef(null);
  const pendingAssistantIdRef = useRef(null);
  const pendingAnswerRef = useRef("");

  const {
    error: speechOutputError,
    isSpeaking,
    speak,
    stop: stopSpeaking,
    toggleVoice,
    voiceEnabled,
  } = useSpeechPlayer();

  const voiceRecorder = useVoiceRecorder(async (blob) => {
    setIsTranscribing(true);
    setVoiceInputError("");
    setStatusText("Transcribing your recording...");

    try {
      const payload = await transcribeAudio(blob);
      const transcript = payload.text?.trim();
      if (!transcript) {
        throw new Error("The transcription result was empty.");
      }
      setInput(transcript);
      setStatusText("Transcription ready. Review it or press Send.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "NENBOT could not transcribe the audio.";
      setVoiceInputError(message);
      setStatusText(message);
    } finally {
      setIsTranscribing(false);
    }
  });

  const voiceStatus = useMemo(() => {
    if (!voiceRecorder.isSupported) {
      return "Voice input unavailable in this browser.";
    }
    if (voiceRecorder.isRecording) {
      return `Recording ${formatDuration(voiceRecorder.elapsedMs)}. Click Stop & Send when finished.`;
    }
    if (isTranscribing) {
      return "Transcribing your recording...";
    }
    if (voiceInputError) {
      return voiceInputError;
    }
    if (speechOutputError) {
      return speechOutputError;
    }
    if (isSpeaking) {
      return "Reading the answer aloud...";
    }
    return voiceEnabled ? "Voice output on. Click Start Mic to record." : "Voice output off. Click Start Mic to record.";
  }, [
    isSpeaking,
    isTranscribing,
    speechOutputError,
    voiceEnabled,
    voiceInputError,
    voiceRecorder.elapsedMs,
    voiceRecorder.isRecording,
    voiceRecorder.isSupported,
  ]);

  useEffect(() => {
    if (voiceRecorder.error) {
      setVoiceInputError(voiceRecorder.error);
      setStatusText(voiceRecorder.error);
    }
  }, [voiceRecorder.error]);

  useEffect(() => {
    if (!chatRef.current) {
      return;
    }
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  async function sendMessage(rawMessage = input) {
    const text = rawMessage.trim();
    if (!text || isSending) {
      return;
    }

    stopSpeaking();
    setStatusText("Searching Hunter x Hunter knowledge...");
    setIsSending(true);
    pendingAnswerRef.current = "";

    const userMessage = createMessage("user", text);
    const assistantMessage = createMessage("bot", "");
    pendingAssistantIdRef.current = assistantMessage.id;

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput("");

    try {
      await streamChat(
        { session_id: sessionId, message: text },
        {
          onToken: (token) => {
            pendingAnswerRef.current += token;
            startTransition(() => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === pendingAssistantIdRef.current
                    ? { ...message, content: pendingAnswerRef.current }
                    : message,
                ),
              );
            });
          },
          onMetadata: (metadata) => {
            startTransition(() => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === pendingAssistantIdRef.current
                    ? { ...message, meta: buildMeta(metadata) }
                    : message,
                ),
              );
            });
          },
          onDone: async () => {
            const finalAnswer = pendingAnswerRef.current.trim();
            pendingAssistantIdRef.current = null;
            setStatusText("Ready for the next question.");
            if (voiceEnabled && finalAnswer) {
              await speak(finalAnswer);
            }
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "NENBOT could not answer right now.";
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingAssistantIdRef.current
            ? {
                ...item,
                content: message,
                meta: ["System error"],
              }
            : item,
        ),
      );
      setStatusText(message);
    } finally {
      pendingAssistantIdRef.current = null;
      setIsSending(false);
    }
  }

  async function handleResetMemory() {
    try {
      await resetMemory(sessionId);
      setMessages((current) => [...current, createMessage("bot", "Session memory has been reset.")]);
      setStatusText("Session memory cleared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "NENBOT could not reset the session.";
      setMessages((current) => [...current, createMessage("bot", message, ["System error"])]);
      setStatusText(message);
    }
  }

  function handleClearUi() {
    stopSpeaking();
    setMessages([
      createMessage(
        "bot",
        "UI cleared. Backend memory is unchanged unless you click Clear memory.",
      ),
    ]);
    setStatusText("Chat view cleared.");
  }

  async function handleVoiceButton() {
    if (isSending || isTranscribing) {
      return;
    }
    if (voiceRecorder.isRecording) {
      voiceRecorder.stopRecording();
      return;
    }
    await voiceRecorder.startRecording();
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-card hero-main">
          <p className="eyebrow">Nen-powered chat interface</p>
          <h1>NENBOT</h1>
          <p className="hero-copy">
            Hunter x Hunter-only assistant with Groq streaming, local Chroma retrieval, structured team answers,
            short-term memory, and proper server-backed voice features.
          </p>
          <div className="badge-row">
            <span className="badge">Scope: Hunter x Hunter + team info only</span>
            <span className="badge">Memory: last 8 interactions</span>
            <span className="badge">Voice: record + transcribe + speak</span>
          </div>
        </div>

        <aside className="hero-card hero-side">
          <div>
            <p className="eyebrow">Voice mode</p>
            <h2>Recorded audio, not browser dictation</h2>
            <p>
              Voice input records real microphone audio, sends it to Groq speech-to-text, then submits the transcript to
              NENBOT. Voice output uses Groq text-to-speech with browser speech as fallback.
            </p>
          </div>
          <div className="voice-stack">
            <div className="voice-pill">
              <span className={`voice-dot ${voiceRecorder.isRecording ? "live" : ""}`} />
              <span>{voiceStatus}</span>
            </div>
            <div className="voice-actions">
              <button
                className={`secondary-button ${voiceRecorder.isRecording ? "recording" : ""}`}
                type="button"
                onClick={handleVoiceButton}
                disabled={!voiceRecorder.isSupported || isTranscribing}
              >
                {voiceRecorder.isRecording ? "Stop & Send" : isTranscribing ? "Transcribing..." : "Start Mic"}
              </button>
              <button
                className={`secondary-button ${voiceEnabled ? "active" : ""}`}
                type="button"
                onClick={toggleVoice}
              >
                {voiceEnabled ? "Voice On" : "Voice Off"}
              </button>
            </div>
          </div>
        </aside>
      </section>

      <section className="workspace">
        <div className="panel chat-panel">
          <div className="panel-top">
            <div>
              <strong>Live Demo Chat</strong>
              <p className="subtle">Session: {sessionId}</p>
            </div>
            <div className="top-actions">
              <button className="ghost-button" type="button" onClick={handleResetMemory}>
                Clear memory
              </button>
              <button className="ghost-button" type="button" onClick={handleClearUi}>
                Clear UI
              </button>
            </div>
          </div>

          <div className="chat-log" ref={chatRef}>
            {messages.map((message) => (
              <article key={message.id} className={`message-card ${message.role}`}>
                <div className="message-content">{message.content || "NENBOT is answering..."}</div>
                {message.meta?.length ? (
                  <div className="meta-row">
                    {message.meta.map((chip) => (
                      <span className="meta-chip" key={`${message.id}-${chip}`}>
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about Killua, Nen, Greed Island, the Phantom Troupe, or the project team..."
              rows={2}
            />
            <div className="composer-actions">
              <button className="primary-button" type="submit" disabled={isSending || isTranscribing}>
                {isSending ? "Streaming..." : "Send"}
              </button>
              <button
                className={`secondary-button ${voiceRecorder.isRecording ? "recording" : ""}`}
                type="button"
                onClick={handleVoiceButton}
                disabled={!voiceRecorder.isSupported || isSending || isTranscribing}
              >
                {voiceRecorder.isRecording ? "Stop & Send" : isTranscribing ? "Transcribing..." : "Start Mic"}
              </button>
            </div>
          </form>
          <p className="status-line">{statusText}</p>
        </div>

        <aside className="panel prompt-panel">
          <div className="panel-section">
            <p className="eyebrow">Sample questions</p>
            <div className="prompt-grid">
              {SAMPLE_PROMPTS.map((prompt) => (
                <button
                  className="prompt-button"
                  key={prompt}
                  type="button"
                  onClick={() => {
                    void sendMessage(prompt);
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <p className="eyebrow">How voice works</p>
            <ol className="steps">
              <li>Click `Start Mic` and speak normally.</li>
              <li>Click `Stop & Send` to upload the recording.</li>
              <li>NENBOT transcribes the audio, asks the backend, and can read the answer aloud.</li>
            </ol>
          </div>
        </aside>
      </section>
    </main>
  );
}
