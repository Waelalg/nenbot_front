const queryApiBase = new URLSearchParams(window.location.search).get("api");

if (queryApiBase) {
  localStorage.setItem("nenbot_api_base", queryApiBase);
}

const localPorts = new Set(["5173", "4173", "5500"]);
const fallbackApiBase =
  window.location.protocol === "file:" || localPorts.has(window.location.port)
    ? "http://127.0.0.1:8000"
    : "";

export const API_BASE = (window.NENBOT_API_BASE || localStorage.getItem("nenbot_api_base") || fallbackApiBase).replace(/\/+$/, "");
