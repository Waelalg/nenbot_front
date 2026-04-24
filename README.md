# NENBOT Frontend

Static chat UI for NENBOT. It contains no private secrets. It only needs the public URL of the deployed backend API.

## Frontend Repo Layout

```text
nenbot-frontend/
  index.html
  config.js
  config.example.js
  README.md
```

If you copy from the full project, copy the contents of the `frontend/` folder into the frontend GitHub repository.

## Configure Backend URL

Edit `config.js` before deployment:

```js
window.NENBOT_API_BASE = "https://your-backend-host.example.com";
```

This URL is public and safe to expose. Never put server secrets in frontend files.

For local testing, `config.js` can stay empty because the UI falls back to `http://localhost:8000` when served on port `5500`.

You can also override the backend URL in the browser with:

```text
https://your-frontend-host.example.com/?api=https://your-backend-host.example.com
```

The value is saved in `localStorage.nenbot_api_base`.

## Local Run

From the original project root:

```powershell
python -m http.server 5500
```

Open:

```text
http://localhost:5500/frontend/index.html
```

If the frontend folder is its own repo root, run the same command inside that frontend repo and open:

```text
http://localhost:5500/
```

## Voice Features

The UI includes:

- `Start Mic`: requests microphone access and starts listening.
- `Stop & Send`: stops listening and sends the transcribed question.
- `Voice off/on`: toggles speech synthesis for bot answers after streaming completes.

These features use browser Web Speech APIs. For reliable microphone access, use Chrome or Edge on `localhost` during development or HTTPS in production.

## Hosting

This frontend is static HTML/CSS/JavaScript. It can be hosted on GitHub Pages, Netlify, Vercel static hosting, or any static file host.

Required before publishing:

- Set `window.NENBOT_API_BASE` in `config.js` to the deployed backend URL.
- Verify the backend allows browser requests. The current FastAPI backend enables CORS.
- Do not commit private keys or server secrets.
