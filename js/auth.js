(() => {
	"use strict";

	const AUTH_KEY = "dc_app_auth";
	const KICK_KEY = "dc_app_kick";
	const APP_PASSWORD = "s0103*";
	const VERSION_URL = "auth-version.json";
	const POLL_MS = 4000;

	let currentVersion = null;
	let pollTimer = null;
	let kickChannel = null;

	function getStoredAuth() {
		try {
			return sessionStorage.getItem(AUTH_KEY);
		} catch (e) {
			return null;
		}
	}

	function setStoredAuth(value) {
		try {
			if (value == null) sessionStorage.removeItem(AUTH_KEY);
			else sessionStorage.setItem(AUTH_KEY, value);
		} catch (e) { /* ignore */ }
	}

	function isUnlocked() {
		const stored = getStoredAuth();
		return Boolean(currentVersion && stored && stored === currentVersion);
	}

	function unlock() {
		if (!currentVersion) return;
		setStoredAuth(currentVersion);
		document.documentElement.classList.add("app-unlocked");
		const gate = document.getElementById("appAuthGate");
		if (gate) gate.setAttribute("aria-hidden", "true");
		const err = document.getElementById("appAuthError");
		if (err) err.style.display = "none";
	}

	function lock(reason) {
		setStoredAuth(null);
		document.documentElement.classList.remove("app-unlocked");
		const gate = document.getElementById("appAuthGate");
		if (gate) gate.setAttribute("aria-hidden", "false");
		const err = document.getElementById("appAuthError");
		const input = document.getElementById("appAuthPassword");
		if (input) input.value = "";
		if (err) {
			if (reason === "deploy") {
				err.textContent = "Сессия сброшена после обновления. Войдите снова.";
				err.style.display = "block";
			} else {
				err.style.display = "none";
			}
		}
		if (input) setTimeout(() => input.focus(), 50);
	}

	function notifyOtherTabs(version) {
		try {
			localStorage.setItem(KICK_KEY, JSON.stringify({ v: version, t: Date.now() }));
		} catch (e) { /* ignore */ }
		try {
			if (kickChannel) kickChannel.postMessage({ type: "DC_FORCE_LOGOUT", v: version });
		} catch (e) { /* ignore */ }
	}

	function forceLogout(nextVersion, options) {
		const propagate = !options || options.propagate !== false;
		if (nextVersion) currentVersion = String(nextVersion);
		const wasIn = Boolean(getStoredAuth()) || document.documentElement.classList.contains("app-unlocked");
		lock(wasIn ? "deploy" : undefined);
		if (propagate && nextVersion && wasIn) notifyOtherTabs(nextVersion);
	}

	function showError() {
		const err = document.getElementById("appAuthError");
		const input = document.getElementById("appAuthPassword");
		if (err) {
			err.textContent = "Неверный пароль";
			err.style.display = "block";
		}
		if (input) {
			input.classList.add("shake");
			setTimeout(() => input.classList.remove("shake"), 500);
			input.select();
		}
	}

	async function fetchVersion() {
		const res = await fetch(VERSION_URL + "?t=" + Date.now(), {
			cache: "no-store",
			headers: { "Cache-Control": "no-cache" },
		});
		if (!res.ok) throw new Error("version fetch failed");
		const data = await res.json();
		const v = data && data.v != null ? String(data.v) : null;
		if (!v) throw new Error("version missing");
		return v;
	}

	function applyVersion(nextVersion) {
		const prev = currentVersion;
		const stored = getStoredAuth();
		currentVersion = nextVersion;

		if (stored && stored !== nextVersion) {
			forceLogout(nextVersion);
			return;
		}

		if (prev && prev !== nextVersion && document.documentElement.classList.contains("app-unlocked")) {
			forceLogout(nextVersion);
			return;
		}

		if (isUnlocked()) {
			unlock();
			return;
		}

		lock();
	}

	async function refreshVersion() {
		try {
			const v = await fetchVersion();
			applyVersion(v);
		} catch (e) {
			/* Offline / transient: keep current UI state */
		}
	}

	async function onSubmit(e) {
		if (e) e.preventDefault();
		const input = document.getElementById("appAuthPassword");
		const value = input ? input.value : "";
		if (value !== APP_PASSWORD) {
			showError();
			return;
		}
		if (!currentVersion) {
			await refreshVersion();
		}
		if (!currentVersion) {
			const err = document.getElementById("appAuthError");
			if (err) {
				err.textContent = "Нет связи с сервером. Попробуйте ещё раз.";
				err.style.display = "block";
			}
			return;
		}
		unlock();
	}

	function onForceMessage(data) {
		if (!data || data.type !== "DC_FORCE_LOGOUT") return;
		forceLogout(data.v, { propagate: false });
	}

	function startPolling() {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = setInterval(refreshVersion, POLL_MS);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") refreshVersion();
		});
		window.addEventListener("focus", refreshVersion);
	}

	function listenCrossTab() {
		window.addEventListener("storage", (e) => {
			if (e.key !== KICK_KEY || !e.newValue) return;
			try {
				const payload = JSON.parse(e.newValue);
				forceLogout(payload.v, { propagate: false });
			} catch (err) { /* ignore */ }
		});

		try {
			kickChannel = new BroadcastChannel("dc_auth");
			kickChannel.onmessage = (e) => onForceMessage(e.data);
		} catch (e) { /* ignore */ }

		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.addEventListener("message", (e) => onForceMessage(e.data));
		}
	}

	async function registerServiceWorker() {
		if (!("serviceWorker" in navigator)) return;
		try {
			const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
			if (reg.active) {
				reg.active.postMessage({ type: "DC_CHECK_NOW" });
			}
			navigator.serviceWorker.ready.then((ready) => {
				if (ready.active) ready.active.postMessage({ type: "DC_CHECK_NOW" });
			});
		} catch (e) {
			/* SW optional — page polling still works */
		}
	}

	async function init() {
		const form = document.getElementById("appAuthForm");
		if (form) form.addEventListener("submit", onSubmit);

		listenCrossTab();
		await refreshVersion();
		startPolling();
		registerServiceWorker();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
