const queryApiBase = new URLSearchParams(window.location.search).get("api");

if (queryApiBase) {
  localStorage.setItem("nenbot_api_base", queryApiBase);
}

const localPorts = new Set(["5173", "4173", "5500"]);
export const IS_LOCAL_RUNTIME =
  window.location.protocol === "file:" || localPorts.has(window.location.port) || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

const fallbackApiBase = IS_LOCAL_RUNTIME ? "http://127.0.0.1:8000" : "";

export const API_BASE = (window.NENBOT_API_BASE || localStorage.getItem("nenbot_api_base") || fallbackApiBase).replace(/\/+$/, "");

export const API_BASE_ERROR =
  !API_BASE && !IS_LOCAL_RUNTIME
    ? "NENBOT backend URL is not configured. Set frontend/public/config.js with window.NENBOT_API_BASE = \"https://your-backend-host.example.com\" or open the site with ?api=https://your-backend-host.example.com."
    : "";
