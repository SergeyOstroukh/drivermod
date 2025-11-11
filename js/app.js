(() => {
	"use strict";

	const suppliersListEl = document.getElementById("suppliersList");
	const geoStatusEl = document.getElementById("geoStatus");
	const detectBtn = document.getElementById("detectLocationBtn");
	const yearEl = document.getElementById("year");
	const searchInput = document.getElementById("searchInput");

	let currentPosition = null; // { lat, lon, accuracy }
	let suppliers = [];
	let filteredSuppliers = [];
	let searchQuery = "";

	function setYear() {
		if (yearEl) yearEl.textContent = String(new Date().getFullYear());
	}

	function formatCoords(lat, lon) {
		return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
	}

	function setGeoStatus(text) {
		geoStatusEl.textContent = text;
	}

	function updateButtonsEnabledState() {
		const goButtons = document.querySelectorAll("[data-role='go']");
		goButtons.forEach((btn) => {
			btn.disabled = !currentPosition;
		});
	}

	async function loadSuppliers() {
		try {
			const res = await fetch("suppliers.json", { cache: "no-store" });
			if (!res.ok) throw new Error("Не удалось загрузить suppliers.json");
			const data = await res.json();
			if (!Array.isArray(data)) throw new Error("Неверный формат suppliers.json");
			suppliers = data;
			filteredSuppliers = suppliers.slice();
		} catch (err) {
			console.error(err);
			// Fallback sample if file missing
			suppliers = [
				{ name: "Поставщик 1", address: "Склад на МКАД", lat: 55.751999, lon: 37.617734 },
				{ name: "Поставщик 2", address: "Терминал Юг", lat: 55.579210, lon: 37.692110 }
			];
			setGeoStatus("Не удалось загрузить suppliers.json — использую пример.");
			filteredSuppliers = suppliers.slice();
		}
	}

	function buildYandexRouteUrl(fromLat, fromLon, toLat, toLon) {
		const rtext = `${fromLat},${fromLon}~${toLat},${toLon}`;
		const params = new URLSearchParams({
			rtext,
			rtt: "auto"
		});
		return `https://yandex.ru/maps/?${params.toString()}`;
	}

	function buildYandexPlaceUrl(lat, lon) {
		// Fallback: просто открыть точку
		return `https://yandex.ru/maps/?pt=${lon},${lat}&z=16&l=map`;
	}

	function renderSuppliers(list = filteredSuppliers) {
		if (!suppliersListEl) return;
		suppliersListEl.innerHTML = "";

		for (const supplier of list) {
			const li = document.createElement("li");
			li.className = "card";

			const header = document.createElement("div");
			header.className = "card-header";

			const titleWrap = document.createElement("div");
			const title = document.createElement("h3");
			title.className = "card-title";
			title.textContent = supplier.name || "Без названия";
			const subtitle = document.createElement("p");
			subtitle.className = "card-subtitle";
			subtitle.textContent = supplier.address || "Адрес не указан";
			titleWrap.appendChild(title);
			titleWrap.appendChild(subtitle);

			const coords = document.createElement("div");
			coords.className = "coords";
			coords.textContent = formatCoords(supplier.lat, supplier.lon);

			header.appendChild(titleWrap);
			header.appendChild(coords);

			const actions = document.createElement("div");
			actions.className = "actions";

			const goBtn = document.createElement("button");
			goBtn.className = "btn btn-primary";
			goBtn.type = "button";
			goBtn.textContent = "Поехали";
			goBtn.setAttribute("data-role", "go");
			goBtn.addEventListener("click", () => {
				if (currentPosition) {
					const url = buildYandexRouteUrl(
						currentPosition.lat,
						currentPosition.lon,
						supplier.lat,
						supplier.lon
					);
					window.location.href = url; // открывает Я.Карты (в браузере/приложении)
				} else {
					// Если нет геолокации — откроем просто точку
					const url = buildYandexPlaceUrl(supplier.lat, supplier.lon);
					window.location.href = url;
				}
			});

			const openBtn = document.createElement("button");
			openBtn.className = "btn btn-outline";
			openBtn.type = "button";
			openBtn.textContent = "Открыть точку";
			openBtn.addEventListener("click", () => {
				const url = buildYandexPlaceUrl(supplier.lat, supplier.lon);
				window.open(url, "_blank");
			});

			actions.appendChild(goBtn);
			actions.appendChild(openBtn);

			li.appendChild(header);
			li.appendChild(actions);
			suppliersListEl.appendChild(li);
		}

		updateButtonsEnabledState();
	}

	function applyFilter() {
		const q = (searchQuery || "").trim().toLowerCase();
		if (!q) {
			filteredSuppliers = suppliers.slice();
		} else {
			filteredSuppliers = suppliers.filter((s) => {
				const name = (s.name || "").toLowerCase();
				return name.includes(q);
			});
		}
		renderSuppliers(filteredSuppliers);
	}

	function detectLocation() {
		if (!("geolocation" in navigator)) {
			setGeoStatus("Геолокация не поддерживается устройством.");
			updateButtonsEnabledState();
			return;
		}
		setGeoStatus("Запрашиваю геопозицию…");
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const { latitude, longitude, accuracy } = pos.coords;
				currentPosition = { lat: latitude, lon: longitude, accuracy };
				setGeoStatus(`Моя позиция: ${formatCoords(latitude, longitude)} (±${Math.round(accuracy)} м)`);
				updateButtonsEnabledState();
			},
			(err) => {
				console.warn(err);
				currentPosition = null;
				const reasons = {
					1: "Доступ к геопозиции запрещён.",
					2: "Позиция недоступна.",
					3: "Таймаут определения позиции."
				};
				setGeoStatus(reasons[err.code] || "Не удалось определить геопозицию.");
				updateButtonsEnabledState();
			},
			{
				enableHighAccuracy: true,
				timeout: 10000,
				maximumAge: 0
			}
		);
	}

	function attachEvents() {
		if (detectBtn) detectBtn.addEventListener("click", detectLocation);
		if (searchInput) {
			searchInput.addEventListener("input", (e) => {
				searchQuery = e.target.value;
				applyFilter();
			});
		}
	}

	async function init() {
		setYear();
		attachEvents();
		await loadSuppliers();
		renderSuppliers(filteredSuppliers);
		detectLocation();
	}

	document.addEventListener("DOMContentLoaded", init);
})();


