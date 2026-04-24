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

If you see a hosted `404` for `/chat/stream`, `/voice/transcribe`, or `/vision/identify`, the frontend is still calling itself. That means `window.NENBOT_API_BASE` is not set correctly in `public/config.js`.

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
- `Stop & Send`: uploads the recording to `POST /voice/transcribe` and fills the chat box with an English transcript.
- `Voice On`: plays bot answers through `POST /voice/speak`, with browser speech as fallback if server audio is unavailable.

This is more reliable than browser dictation because transcription happens on the backend through Groq and is normalized to English before it reaches the chat input, and you can review the transcript before sending it.

## Image Recognition

- Upload a Hunter x Hunter character image from the sidebar panel, or drag and drop it.
- Optionally leave center crop on so the image is cropped before being sent to the backend.
- Click `Recognize image`.
- The frontend sends the file to `POST /vision/identify`.
- NENBOT returns a grounded Hunter x Hunter identity/profile answer in the same chat log, plus top guesses for unclear images and clickable follow-up prompts.

## Production Build

```powershell
npm run build
```

This creates `frontend/dist/`. The FastAPI backend serves that build automatically when it exists.
