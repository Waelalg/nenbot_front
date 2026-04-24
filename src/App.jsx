import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE, API_BASE_ERROR } from "./config";
import { identifyHunterImage, resetMemory, streamChat, transcribeAudio } from "./lib/api";
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

function createMessage(role, content, meta = null, options = {}) {
  return {
    id: `${role}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    role,
    content,
    meta,
    imageUrl: options.imageUrl || "",
    imageAlt: options.imageAlt || "",
    actions: options.actions || [],
    guesses: options.guesses || [],
  };
}

function buildMeta(metadata) {
  if (!metadata) {
    return [];
  }

  if (metadata.mode === "vision") {
    const chips = [
      "Image recognition",
      metadata.intent === "hxh_knowledge" ? "Hunter x Hunter match" : "Not confirmed",
    ];

    if (metadata.recognized_entity) {
      chips.push(`Detected: ${metadata.recognized_entity}`);
    }
    if (metadata.entity_type && metadata.entity_type !== "unknown") {
      chips.push(`Type: ${metadata.entity_type}`);
    }
    if (metadata.confidence && metadata.confidence !== "unknown") {
      chips.push(`Confidence: ${metadata.confidence}`);
    }
    chips.push(metadata.memory_used ? "Memory used" : "New context");
    return chips;
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

function isImageFile(file) {
  return Boolean(file?.type?.startsWith("image/"));
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be loaded."));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The cropped image could not be created."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function prepareVisionImage(file, cropSquare) {
  const sourcePreview = await readFileAsDataUrl(file);
  if (!cropSquare) {
    return {
      sourcePreview,
      preparedPreview: sourcePreview,
      preparedFile: file,
    };
  }

  const image = await loadImage(sourcePreview);
  const squareSize = Math.min(image.naturalWidth, image.naturalHeight);
  const offsetX = Math.floor((image.naturalWidth - squareSize) / 2);
  const offsetY = Math.floor((image.naturalHeight - squareSize) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = squareSize;
  canvas.height = squareSize;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The browser could not prepare the image crop.");
  }

  context.drawImage(
    image,
    offsetX,
    offsetY,
    squareSize,
    squareSize,
    0,
    0,
    squareSize,
    squareSize,
  );

  const preparedBlob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  const preparedFile = new File(
    [preparedBlob],
    `${file.name.replace(/\.[^.]+$/, "") || "hunter-character"}-crop.jpg`,
    { type: "image/jpeg" },
  );

  return {
    sourcePreview,
    preparedPreview: canvas.toDataURL("image/jpeg", 0.92),
    preparedFile,
  };
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
  const [isRecognizingImage, setIsRecognizingImage] = useState(false);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceInputError, setVoiceInputError] = useState("");
  const [sourceImageFile, setSourceImageFile] = useState(null);
  const [sourceImagePreview, setSourceImagePreview] = useState("");
  const [selectedImageFile, setSelectedImageFile] = useState(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState("");
  const [cropSquare, setCropSquare] = useState(true);
  const [isDragActive, setIsDragActive] = useState(false);

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
    setStatusText("Transcribing your recording into English...");

    try {
      const payload = await transcribeAudio(blob);
      const transcript = payload.text?.trim();
      if (!transcript) {
        throw new Error("The transcription result was empty.");
      }
      setInput(transcript);
      setStatusText("English transcription ready. Review it or press Send.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "NENBOT could not transcribe the audio into English.";
      setVoiceInputError(message);
      setStatusText(message);
    } finally {
      setIsTranscribing(false);
    }
  });

  const voiceStatus = useMemo(() => {
    if (isRecognizingImage) {
      return "Analyzing uploaded Hunter x Hunter image...";
    }
    if (isPreparingImage) {
      return cropSquare ? "Preparing a center-cropped image for recognition..." : "Preparing the uploaded image...";
    }
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
    cropSquare,
    isPreparingImage,
    isRecognizingImage,
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
    if (API_BASE_ERROR) {
      setStatusText(API_BASE_ERROR);
    }
  }, []);

  useEffect(() => {
    if (!chatRef.current) {
      return;
    }
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!sourceImageFile) {
      return;
    }

    let cancelled = false;
    setIsPreparingImage(true);
    setStatusText(cropSquare ? "Preparing a center-cropped image..." : "Preparing uploaded image...");

    void prepareVisionImage(sourceImageFile, cropSquare)
      .then(({ sourcePreview: preparedSourcePreview, preparedPreview, preparedFile }) => {
        if (cancelled) {
          return;
        }
        setSourceImagePreview(preparedSourcePreview);
        setSelectedImagePreview(preparedPreview);
        setSelectedImageFile(preparedFile);
        setStatusText(cropSquare ? "Image prepared with center crop. Click Recognize image." : "Image ready. Click Recognize image.");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "The selected image could not be prepared.";
        setStatusText(message);
        clearSelectedImage();
      })
      .finally(() => {
        if (!cancelled) {
          setIsPreparingImage(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cropSquare, sourceImageFile]);

  async function sendMessage(rawMessage = input) {
    const text = rawMessage.trim();
    if (!text || isSending || isRecognizingImage || isPreparingImage) {
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
    clearSelectedImage();
    setStatusText("Chat view cleared.");
  }

  async function handleVoiceButton() {
    if (isSending || isTranscribing || isRecognizingImage) {
      return;
    }
    if (voiceRecorder.isRecording) {
      voiceRecorder.stopRecording();
      return;
    }
    await voiceRecorder.startRecording();
  }

  function clearSelectedImage() {
    setSourceImageFile(null);
    setSourceImagePreview("");
    setSelectedImageFile(null);
    setSelectedImagePreview("");
    setIsDragActive(false);
  }

  async function handleImageSelection(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!isImageFile(file)) {
      setStatusText("Please choose an image file for Hunter x Hunter recognition.");
      event.target.value = "";
      return;
    }
    setSourceImageFile(file);
    event.target.value = "";
  }

  function handleDragOver(event) {
    event.preventDefault();
    if (!isSending && !isTranscribing && !isRecognizingImage) {
      setIsDragActive(true);
    }
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setIsDragActive(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragActive(false);
    if (isSending || isTranscribing || isRecognizingImage) {
      return;
    }
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    if (!isImageFile(file)) {
      setStatusText("Please drop an image file for Hunter x Hunter recognition.");
      return;
    }
    setSourceImageFile(file);
  }

  async function handleImageRecognition() {
    if (!selectedImageFile || !selectedImagePreview || isSending || isTranscribing || isRecognizingImage || isPreparingImage) {
      return;
    }

    stopSpeaking();
    setIsRecognizingImage(true);
    setStatusText("Analyzing Hunter x Hunter image...");

    const userMessage = createMessage(
      "user",
      "Identify this Hunter x Hunter subject from the uploaded image.",
      null,
      { imageUrl: selectedImagePreview, imageAlt: selectedImageFile.name || "Uploaded image" },
    );
    const assistantMessage = createMessage("bot", "");
    pendingAssistantIdRef.current = assistantMessage.id;

    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      const payload = await identifyHunterImage(sessionId, selectedImageFile);
      startTransition(() => {
        setMessages((current) =>
          current.map((message) =>
            message.id === pendingAssistantIdRef.current
              ? {
                  ...message,
                  content: payload.answer,
                  meta: buildMeta(payload),
                  actions: payload.follow_up_suggestions || [],
                  guesses:
                    payload.confidence === "low" || payload.intent !== "hxh_knowledge"
                      ? payload.top_guesses || []
                      : [],
                }
              : message,
          ),
        );
      });
      setStatusText(
        payload.recognized_entity
          ? `Image recognized: ${payload.recognized_entity}.`
          : "Image analysis finished.",
      );
      if (voiceEnabled && payload.answer) {
        await speak(payload.answer);
      }
      clearSelectedImage();
    } catch (error) {
      const message = error instanceof Error ? error.message : "NENBOT could not analyze the image right now.";
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
      setIsRecognizingImage(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-card hero-main">
          <p className="eyebrow">Nen-powered chat interface</p>
          <h1>NENBOT</h1>
          <p className="hero-copy">
            Hunter x Hunter-only assistant with Groq streaming, local Chroma retrieval, structured team answers,
            short-term memory, proper server-backed voice features, and Hunter x Hunter character image recognition.
          </p>
          <div className="badge-row">
            <span className="badge">Scope: Hunter x Hunter + team info only</span>
            <span className="badge">Memory: last 8 interactions</span>
            <span className="badge">Voice + image recognition</span>
            <span className="badge">{API_BASE ? `Backend: ${API_BASE}` : "Backend: not configured"}</span>
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
                disabled={!voiceRecorder.isSupported || isTranscribing || isPreparingImage || isRecognizingImage}
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
                {message.imageUrl ? (
                  <img className="message-image" src={message.imageUrl} alt={message.imageAlt || "Uploaded image"} />
                ) : null}
                <div className="message-content">{message.content || "NENBOT is answering..."}</div>
                {message.guesses?.length ? (
                  <div className="follow-up-block">
                    <strong className="follow-up-title">Top guesses</strong>
                    <div className="follow-up-actions">
                      {message.guesses.map((guess) => (
                        <button
                          className="follow-up-button"
                          key={`${message.id}-guess-${guess}`}
                          type="button"
                          disabled={isSending || isRecognizingImage || isPreparingImage}
                          onClick={() => {
                            void sendMessage(`Tell me about ${guess}`);
                          }}
                        >
                          {guess}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {message.actions?.length ? (
                  <div className="follow-up-block">
                    <strong className="follow-up-title">Try next</strong>
                    <div className="follow-up-actions">
                      {message.actions.map((action) => (
                        <button
                          className="follow-up-button"
                          key={`${message.id}-action-${action}`}
                          type="button"
                          disabled={isSending || isRecognizingImage || isPreparingImage}
                          onClick={() => {
                            void sendMessage(action);
                          }}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
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
              <button className="primary-button" type="submit" disabled={isSending || isTranscribing || isRecognizingImage || isPreparingImage}>
                {isSending ? "Streaming..." : isRecognizingImage ? "Analyzing image..." : isPreparingImage ? "Preparing image..." : "Send"}
              </button>
              <button
                className={`secondary-button ${voiceRecorder.isRecording ? "recording" : ""}`}
                type="button"
                onClick={handleVoiceButton}
                disabled={!voiceRecorder.isSupported || isSending || isTranscribing || isRecognizingImage || isPreparingImage}
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
            <p className="eyebrow">Character image recognition</p>
            <div className="vision-uploader">
              <label
                className={`upload-card ${isDragActive ? "drag-active" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input type="file" accept="image/*" onChange={handleImageSelection} />
                <span>
                  {sourceImageFile
                    ? "Change Hunter x Hunter image"
                    : "Drop a Hunter x Hunter image here or click to choose"}
                </span>
              </label>
              <div className="image-panel-actions">
                <button
                  className={`secondary-button ${cropSquare ? "active" : ""}`}
                  type="button"
                  onClick={() => setCropSquare((current) => !current)}
                  disabled={!sourceImageFile || isPreparingImage || isRecognizingImage}
                >
                  {cropSquare ? "Center Crop On" : "Center Crop Off"}
                </button>
              </div>
              {selectedImagePreview ? (
                <div className="image-preview-grid">
                  {cropSquare && sourceImagePreview ? (
                    <div className="image-preview-frame">
                      <p className="preview-label">Original</p>
                      <img src={sourceImagePreview} alt="Original upload preview" className="image-preview" />
                    </div>
                  ) : null}
                  <div className="image-preview-frame">
                    <p className="preview-label">{cropSquare ? "Prepared for recognition" : "Selected image"}</p>
                    <img src={selectedImagePreview} alt="Selected Hunter x Hunter preview" className="image-preview" />
                  </div>
                </div>
              ) : (
                <p className="subtle">
                  Upload a clean image of a Hunter x Hunter character and NENBOT will try to identify it.
                </p>
              )}
              <div className="image-panel-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleImageRecognition}
                  disabled={!selectedImageFile || isSending || isTranscribing || isRecognizingImage || isPreparingImage}
                >
                  {isRecognizingImage ? "Recognizing..." : isPreparingImage ? "Preparing..." : "Recognize image"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={clearSelectedImage}
                  disabled={!selectedImageFile || isRecognizingImage || isPreparingImage}
                >
                  Remove image
                </button>
              </div>
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
