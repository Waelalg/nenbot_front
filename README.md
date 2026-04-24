# NENBOT Frontend

React + Vite frontend for NENBOT. It contains no private secrets. The browser only needs the public backend URL and the backend handles Groq chat, speech-to-text, and text-to-speech.

## Frontend Repo Layout

```text
nenbot-frontend/
  index.html
  package.json
  vite.config.js
  public/
    config.js
    config.example.js
  src/
    App.jsx
    main.jsx
    styles.css
  README.md
```

## Configure Backend URL

Edit `public/config.js` before deployment:

```js
window.NENBOT_API_BASE = "https://your-backend-host.example.com";
```

This value is public and safe to expose. Never put server secrets in the frontend.

You can also override the backend URL through the browser:

```text
https://your-frontend-host.example.com/?api=https://your-backend-host.example.com
```

## Local Run

From the `frontend/` directory:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The frontend falls back to `http://127.0.0.1:8000` for local backend calls during Vite development.

## Voice Features

- `Start Mic`: records real microphone audio with `MediaRecorder`.
- `Stop & Send`: uploads the recording to `POST /voice/transcribe` and fills the chat box with the transcript.
- `Voice On`: plays bot answers through `POST /voice/speak`, with browser speech as fallback if server audio is unavailable.

This is more reliable than browser dictation because transcription happens on the backend through Groq speech-to-text, and you can review the transcript before sending it.

## Production Build

```powershell
npm run build
```

This creates `frontend/dist/`. The FastAPI backend serves that build automatically when it exists.
