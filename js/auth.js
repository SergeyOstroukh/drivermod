(() => {
	"use strict";

	const AUTH_KEY = "dc_app_auth";
	const APP_PASSWORD = "s0103*";
	const VERSION_URL = "auth-version.json";
	const POLL_MS = 15000;

	let currentVersion = null;
	let pollTimer = null;

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
		currentVersion = nextVersion;

		if (isUnlocked()) {
			unlock();
			return;
		}

		// Deploy changed version while user was already in — kick session
		if (prev && prev !== nextVersion && getStoredAuth()) {
			lock("deploy");
			return;
		}

		if (getStoredAuth() && getStoredAuth() !== nextVersion) {
			lock("deploy");
			return;
		}

		lock();
	}

	async function refreshVersion() {
		try {
			const v = await fetchVersion();
			applyVersion(v);
		} catch (e) {
			// Offline / transient: keep current UI state
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

	function startPolling() {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = setInterval(refreshVersion, POLL_MS);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") refreshVersion();
		});
		window.addEventListener("focus", refreshVersion);
	}

	async function init() {
		const form = document.getElementById("appAuthForm");
		if (form) form.addEventListener("submit", onSubmit);

		await refreshVersion();
		startPolling();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
