import { API_BASE } from "../config";

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function readError(response, fallback) {
  try {
    const payload = await response.json();
    return payload.detail || payload.message || fallback;
  } catch {
    return fallback;
  }
}

export async function streamChat(payload, callbacks) {
  const response = await fetch(apiUrl("/chat/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(await readError(response, "NENBOT could not start the streaming response."));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventText of events) {
      handleEvent(eventText, callbacks);
    }
  }

  if (buffer.trim()) {
    handleEvent(buffer, callbacks);
  }
}

function handleEvent(eventText, callbacks) {
  const lines = eventText.split("\n");
  let eventType = "message";
  let dataText = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      dataText += line.slice(5).trim();
    }
  }

  if (!dataText) {
    return;
  }

  const data = JSON.parse(dataText);
  if (eventType === "metadata") {
    callbacks.onMetadata?.(data);
    return;
  }
  if (eventType === "done") {
    callbacks.onDone?.();
    return;
  }
  callbacks.onToken?.(data.token || "");
}

export async function resetMemory(sessionId) {
  const response = await fetch(apiUrl("/reset"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "NENBOT could not reset the session memory."));
  }
}

export async function transcribeAudio(blob) {
  const response = await fetch(apiUrl("/voice/transcribe"), {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "audio/webm",
    },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(await readError(response, "NENBOT could not transcribe the recorded audio."));
  }

  return response.json();
}

export async function synthesizeSpeech(text) {
  const response = await fetch(apiUrl("/voice/speak"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "NENBOT could not generate voice output."));
  }

  return response.blob();
}
