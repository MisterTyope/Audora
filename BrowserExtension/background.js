const SERVER_URL = "http://127.0.0.1:47935";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "DOWNLOAD_REQUEST") return false;

  // POST + JSON : le navigateur ajoute alors l'en-tete Origin "chrome-extension://...",
  // que l'application verifie pour refuser les demandes venant de sites web.
  fetch(SERVER_URL + "/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: message.videoUrl, format: message.format }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
    .then((data) => sendResponse({ ok: true, data: data }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true; // reponse envoyee de facon asynchrone
});
