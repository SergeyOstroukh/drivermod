(() => {
	"use strict";

	const AUTH_KEY = "dc_app_auth";
	const APP_PASSWORD = "s0103*";

	function isUnlocked() {
		try {
			return sessionStorage.getItem(AUTH_KEY) === "1";
		} catch (e) {
			return false;
		}
	}

	function unlock() {
		try {
			sessionStorage.setItem(AUTH_KEY, "1");
		} catch (e) { /* ignore */ }
		document.documentElement.classList.add("app-unlocked");
		const gate = document.getElementById("appAuthGate");
		if (gate) gate.setAttribute("aria-hidden", "true");
	}

	function showError() {
		const err = document.getElementById("appAuthError");
		const input = document.getElementById("appAuthPassword");
		if (err) err.style.display = "block";
		if (input) {
			input.classList.add("shake");
			setTimeout(() => input.classList.remove("shake"), 500);
			input.select();
		}
	}

	function onSubmit(e) {
		if (e) e.preventDefault();
		const input = document.getElementById("appAuthPassword");
		const value = input ? input.value : "";
		if (value === APP_PASSWORD) {
			unlock();
			return;
		}
		showError();
	}

	function init() {
		if (isUnlocked()) {
			unlock();
			return;
		}

		const form = document.getElementById("appAuthForm");
		const input = document.getElementById("appAuthPassword");
		if (form) form.addEventListener("submit", onSubmit);
		if (input) setTimeout(() => input.focus(), 50);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
