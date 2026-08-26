/* Forces logout on open tabs when auth-version.json changes — no page reload needed. */
const VERSION_URL = "auth-version.json";
const POLL_MS = 4000;

let knownVersion = null;
let pollTimer = null;

async function fetchVersion() {
	const res = await fetch(VERSION_URL + "?t=" + Date.now(), { cache: "no-store" });
	if (!res.ok) throw new Error("version fetch failed");
	const data = await res.json();
	if (!data || data.v == null) throw new Error("version missing");
	return String(data.v);
}

async function broadcastLogout(version) {
	const clientsList = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	for (const client of clientsList) {
		client.postMessage({ type: "DC_FORCE_LOGOUT", v: version });
	}
}

async function checkVersion() {
	try {
		const next = await fetchVersion();
		if (knownVersion && knownVersion !== next) {
			await broadcastLogout(next);
		}
		knownVersion = next;
	} catch (e) {
		/* ignore transient errors */
	}
}

function startPolling() {
	if (pollTimer) clearInterval(pollTimer);
	pollTimer = setInterval(checkVersion, POLL_MS);
	checkVersion();
}

self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			await self.clients.claim();
			startPolling();
		})()
	);
});

self.addEventListener("message", (event) => {
	const data = event.data || {};
	if (data.type === "DC_CHECK_NOW") {
		checkVersion();
	}
});

startPolling();
