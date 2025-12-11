(() => {
	"use strict";

	const suppliersListEl = document.getElementById("suppliersList");
	const geoStatusEl = document.getElementById("geoStatus");
	const detectBtn = document.getElementById("detectLocationBtn");
	const officeBtn = document.getElementById("officeBtn");
	const warehouseBtn = document.getElementById("warehouseBtn");
	const yearEl = document.getElementById("year");
	const searchInput = document.getElementById("searchInput");

	const OFFICE_COORDS = { lat: 53.883330, lon: 27.455246 };
	const WAREHOUSE_COORDS = { lat: 53.839569, lon: 27.455060 };
	
	// Ключ API для Яндекс.Навигатора (получить на https://yandex.ru/set/lp/navigatorb2b)
	// Если ключ не указан, будет работать с лимитом 5 вызовов в сутки
	const YANDEX_NAVIGATOR_API_KEY = "e50067ad-cd7a-48fa-b5f0-a6c751167c2d";

	let currentPosition = null; // { lat, lon, accuracy }
	let suppliers = [];
	let filteredSuppliers = [];
	let searchQuery = "";
	let openInfoMenu = null;
	let selectedSuppliers = new Set(); // Set of supplier names (unique identifier)
	let pendingRoute = null; // { type: 'single' | 'multi', data: {...} }
	let editingSupplierId = null; // ID поставщика, который редактируется

	function setYear() {
		if (yearEl) yearEl.textContent = String(new Date().getFullYear());
	}

	function formatCoords(lat, lon) {
		return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
	}

	function setGeoStatus(text) {
		geoStatusEl.textContent = text;
	}

	function closeInfoMenu() {
		if (openInfoMenu) {
			openInfoMenu.classList.remove("is-open");
			openInfoMenu = null;
		}
	}

	document.addEventListener("click", closeInfoMenu);

	function parseInfoPoints(info) {
		if (!info || typeof info !== "object") return [];
		const points = [];
		for (const [label, value] of Object.entries(info)) {
			let lat = null;
			let lon = null;
			if (typeof value === "string") {
				const parts = value.split(",").map((part) => part.trim());
				if (parts.length >= 2) {
					lat = Number(parts[0]);
					lon = Number(parts[1]);
				}
			} else if (value && typeof value === "object") {
				if ("lat" in value) lat = Number(value.lat);
				if ("lon" in value) lon = Number(value.lon);
				if ("lng" in value && (lon === null || Number.isNaN(lon))) lon = Number(value.lng);
			}
			if (Number.isFinite(lat) && Number.isFinite(lon)) {
				points.push({ label, lat, lon });
			}
		}
		return points;
	}

	function openRoute(toLat, toLon, label = "") {
		pendingRoute = {
			type: 'single',
			toLat,
			toLon,
			label
		};
		showRouteModal();
	}

	function openRouteDirect(app = 'navigator') {
		if (!pendingRoute) return;

		if (pendingRoute.type === 'single') {
			const { toLat, toLon, label } = pendingRoute;
			if (app === 'navigator') {
				if (currentPosition) {
					const naviUrl = buildYandexNavigatorRouteUrl(
						currentPosition.lat,
						currentPosition.lon,
						toLat,
						toLon
					);
					window.location.href = naviUrl;
				} else {
					const naviPlace = buildYandexNavigatorPlaceUrl(toLat, toLon, label);
					window.location.href = naviPlace;
				}
			} else {
				if (currentPosition) {
					const mapsUrl = buildYandexRouteUrl(
						currentPosition.lat,
						currentPosition.lon,
						toLat,
						toLon
					);
					window.location.href = mapsUrl;
				} else {
					const mapsPlace = buildYandexPlaceUrl(toLat, toLon);
					window.location.href = mapsPlace;
				}
			}
		} else if (pendingRoute.type === 'multi') {
			const { points } = pendingRoute;
			if (app === 'navigator') {
				// Для навигатора с несколькими точками
				// Яндекс.Навигатор через deeplink НЕ поддерживает множественные точки
				// Открываем через Яндекс.Карты, где все точки отображаются корректно
				// Пользователь сможет открыть маршрут в навигаторе из карт (кнопка "В навигатор")
				if (points.length >= 2) {
					// Открываем через Яндекс.Карты с множественными точками
					// В картах есть кнопка "В навигатор", которая откроет маршрут в приложении
					const mapsUrl = buildYandexMultiRouteUrl(points);
					window.location.href = mapsUrl;
				}
			} else {
				const mapsUrl = buildYandexMultiRouteUrl(points);
				window.location.href = mapsUrl;
			}
		}

		hideRouteModal();
	}

	function showRouteModal() {
		const modal = document.getElementById("routeModal");
		const warning = document.getElementById("navigatorWarning");
		const multiWarning = document.getElementById("multiRouteWarning");
		if (modal) {
			modal.classList.add("is-open");
			// Показываем предупреждение, если ключ API не указан
			if (warning) {
				warning.style.display = YANDEX_NAVIGATOR_API_KEY ? "none" : "flex";
			}
			// Показываем предупреждение для множественных маршрутов
			if (multiWarning && pendingRoute && pendingRoute.type === 'multi') {
				multiWarning.style.display = "flex";
			} else if (multiWarning) {
				multiWarning.style.display = "none";
			}
		}
	}

	function hideRouteModal() {
		const modal = document.getElementById("routeModal");
		if (modal) {
			modal.classList.remove("is-open");
		}
		pendingRoute = null;
	}

	function calculateDistance(lat1, lon1, lat2, lon2) {
		// Формула гаверсинуса для расчета расстояния между двумя точками
		const R = 6371000; // Радиус Земли в метрах
		const dLat = (lat2 - lat1) * Math.PI / 180;
		const dLon = (lon2 - lon1) * Math.PI / 180;
		const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
			Math.sin(dLon / 2) * Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	function optimizeRoute(startPoint, points) {
		// Алгоритм ближайшего соседа для оптимизации маршрута
		if (points.length === 0) return [];
		if (points.length === 1) return points;

		const route = [];
		const remaining = [...points];
		let current = startPoint;

		while (remaining.length > 0) {
			let nearestIndex = 0;
			let nearestDistance = calculateDistance(
				current.lat, current.lon,
				remaining[0].lat, remaining[0].lon
			);

			for (let i = 1; i < remaining.length; i++) {
				const distance = calculateDistance(
					current.lat, current.lon,
					remaining[i].lat, remaining[i].lon
				);
				if (distance < nearestDistance) {
					nearestDistance = distance;
					nearestIndex = i;
				}
			}

			const nearest = remaining.splice(nearestIndex, 1)[0];
			route.push(nearest);
			current = nearest;
		}

		return route;
	}

	function buildMultiRoute() {
		if (selectedSuppliers.size === 0) {
			alert("Выберите хотя бы одного поставщика");
			return;
		}

		if (!currentPosition) {
			alert("Необходимо определить вашу геопозицию");
			return;
		}

		// Получаем выбранных поставщиков по их ключам из полного списка
		const selected = suppliers.filter(s => {
			const key = `${s.name || ""}_${s.lat}_${s.lon}`;
			return selectedSuppliers.has(key);
		});

		if (selected.length === 0) {
			alert("Выбранные поставщики не найдены");
			return;
		}

		// Преобразуем в точки
		const points = selected.map(s => ({ lat: s.lat, lon: s.lon }));

		// Оптимизируем маршрут
		const startPoint = { lat: currentPosition.lat, lon: currentPosition.lon };
		const optimizedRoute = optimizeRoute(startPoint, points);

		// Строим маршрут: от текущей позиции через все точки
		const allPoints = [startPoint, ...optimizedRoute];
		
		// Сохраняем данные маршрута и показываем модальное окно
		pendingRoute = {
			type: 'multi',
			points: allPoints
		};
		showRouteModal();
	}

	function createInfoDropdown(points, supplierName) {
		const dropdown = document.createElement("div");
		dropdown.className = "dropdown";

		const toggleBtn = document.createElement("button");
		toggleBtn.className = "btn btn-outline dropdown-toggle";
		toggleBtn.type = "button";
		toggleBtn.textContent = "Информация";

		const menu = document.createElement("div");
		menu.className = "dropdown-menu";

		points.forEach((point) => {
			const item = document.createElement("button");
			item.type = "button";
			item.className = "dropdown-item";
			item.textContent = point.label;
			item.addEventListener("click", (event) => {
				event.stopPropagation();
				closeInfoMenu();
				const label = supplierName ? `${supplierName} — ${point.label}` : point.label;
				openRoute(point.lat, point.lon, label.trim());
			});
			menu.appendChild(item);
		});

		menu.addEventListener("click", (event) => event.stopPropagation());

		toggleBtn.addEventListener("click", (event) => {
			event.stopPropagation();
			const willOpen = !menu.classList.contains("is-open");
			closeInfoMenu();
			if (willOpen) {
				menu.classList.add("is-open");
				openInfoMenu = menu;
			}
		});

		dropdown.appendChild(toggleBtn);
		dropdown.appendChild(menu);
		return dropdown;
	}

	function updateButtonsEnabledState() {
		const goButtons = document.querySelectorAll("[data-role='go']");
		goButtons.forEach((btn) => {
			btn.disabled = !currentPosition;
		});
		updateRouteButton();
	}

	async function loadSuppliers() {
		try {
			// Проверяем подключение к Supabase
			const connection = await window.SuppliersDB.checkConnection();
			if (!connection.connected) {
				setGeoStatus(`Ошибка подключения к базе данных: ${connection.message || 'Проверьте, запущен ли Docker контейнер'}`);
				suppliers = [];
				filteredSuppliers = [];
				return;
			}

			// Проверяем, есть ли данные в базе
			const hasData = await window.SuppliersDB.hasData();
			
			if (!hasData) {
				// Если база пуста, пытаемся импортировать из suppliers.json
				try {
					const res = await fetch("suppliers.json", { cache: "no-store" });
					if (res.ok) {
						const data = await res.json();
						if (Array.isArray(data) && data.length > 0) {
							await window.SuppliersDB.import(data);
							setGeoStatus(`Импортировано ${data.length} поставщиков из suppliers.json`);
						}
					}
				} catch (err) {
					console.warn("Не удалось загрузить suppliers.json для импорта:", err);
				}
			}
			
			// Загружаем данные из базы с ID
			suppliers = await window.SuppliersDB.getAllWithId();
			filteredSuppliers = suppliers.slice();
			
			if (suppliers.length === 0) {
				setGeoStatus("База данных пуста. Добавьте первого поставщика.");
			} else {
				setGeoStatus(`Загружено ${suppliers.length} поставщиков из PostgreSQL`);
			}
		} catch (err) {
			console.error("Ошибка загрузки поставщиков:", err);
			setGeoStatus(`Ошибка загрузки данных: ${err.message || 'Проверьте подключение к базе данных'}`);
			suppliers = [];
			filteredSuppliers = [];
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

	function buildYandexMultiRouteUrl(points) {
		// points: array of {lat, lon}
		// Формат: lat1,lon1~lat2,lon2~lat3,lon3
		const rtext = points.map(p => `${p.lat},${p.lon}`).join("~");
		const params = new URLSearchParams({
			rtext,
			rtt: "auto"
		});
		return `https://yandex.ru/maps/?${params.toString()}`;
	}

	function buildYandexNavigatorRouteUrl(fromLat, fromLon, toLat, toLon) {
		// Официальная схема deeplink Яндекс.Навигатора
		// Если не указать from, маршрут строится от текущей позиции, но мы передаём явные координаты
		const params = new URLSearchParams({
			lat_to: String(toLat),
			lon_to: String(toLon),
			lat_from: String(fromLat),
			lon_from: String(fromLon)
		});
		
		// Добавляем ключ API, если он указан (для обхода лимита 5 вызовов в сутки)
		if (YANDEX_NAVIGATOR_API_KEY) {
			params.append("api_key", YANDEX_NAVIGATOR_API_KEY);
		}
		
		return `yandexnavi://build_route_on_map?${params.toString()}`;
	}

	function buildYandexNavigatorMultiRouteUrl(points) {
		// Для навигатора с несколькими точками
		// Яндекс.Навигатор поддерживает промежуточные точки через параметр via
		// Формат: lat1,lon1|lat2,lon2|... (разделитель |)
		if (points.length < 2) return null;
		
		const start = points[0];
		const end = points[points.length - 1];
		const viaPoints = points.slice(1, -1);
		
		const params = new URLSearchParams({
			lat_from: String(start.lat),
			lon_from: String(start.lon),
			lat_to: String(end.lat),
			lon_to: String(end.lon)
		});
		
		// Добавляем промежуточные точки через параметр via
		// Формат: lat1,lon1|lat2,lon2|lat3,lon3
		if (viaPoints.length > 0) {
			const viaStr = viaPoints.map(p => `${p.lat},${p.lon}`).join("|");
			params.append("via", viaStr);
		}
		
		// Добавляем ключ API, если он указан
		if (YANDEX_NAVIGATOR_API_KEY) {
			params.append("api_key", YANDEX_NAVIGATOR_API_KEY);
		}
		
		return `yandexnavi://build_route_on_map?${params.toString()}`;
	}

	function buildYandexPlaceUrl(lat, lon) {
		// Fallback: просто открыть точку
		return `https://yandex.ru/maps/?pt=${lon},${lat}&z=16&l=map`;
	}

	function buildYandexNavigatorPlaceUrl(lat, lon, name = "") {
		const params = new URLSearchParams({
			lat: String(lat),
			lon: String(lon),
			desc: name
		});
		
		// Добавляем ключ API, если он указан
		if (YANDEX_NAVIGATOR_API_KEY) {
			params.append("api_key", YANDEX_NAVIGATOR_API_KEY);
		}
		
		return `yandexnavi://show_point_on_map?${params.toString()}`;
	}

	function openWithFallback(primaryUrl, fallbackUrl) {
		// Пытаемся открыть приложение по кастомной схеме, иначе — веб-ссылка
		const timeout = setTimeout(() => {
			window.location.href = fallbackUrl;
		}, 800);
		window.location.href = primaryUrl;
		// На некоторых устройствах будет переход сразу — очистим таймер немного позже
		setTimeout(() => clearTimeout(timeout), 1500);
	}

	function renderSuppliers(list = filteredSuppliers) {
		if (!suppliersListEl) return;
		suppliersListEl.innerHTML = "";
		closeInfoMenu();

		for (let i = 0; i < list.length; i++) {
			const supplier = list[i];
			const li = document.createElement("li");
			li.className = "card";

			const header = document.createElement("div");
			header.className = "card-header";

			const checkboxWrap = document.createElement("div");
			checkboxWrap.className = "checkbox-wrap";
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.className = "supplier-checkbox";
			checkbox.id = `supplier-${i}`;
			const supplierKey = `${supplier.name || ""}_${supplier.lat}_${supplier.lon}`;
			checkbox.checked = selectedSuppliers.has(supplierKey);
			checkbox.addEventListener("change", (e) => {
				if (e.target.checked) {
					selectedSuppliers.add(supplierKey);
				} else {
					selectedSuppliers.delete(supplierKey);
				}
				updateRouteButton();
			});
			checkboxWrap.appendChild(checkbox);

			const titleWrap = document.createElement("div");
			titleWrap.className = "title-wrap";
			const title = document.createElement("h3");
			title.className = "card-title";
			title.textContent = supplier.name || "Без названия";
			const subtitle = document.createElement("p");
			subtitle.className = "card-subtitle";
			subtitle.textContent = supplier.address || "Адрес не указан";
			titleWrap.appendChild(title);
			titleWrap.appendChild(subtitle);

			// Добавляем время работы, если есть
			if (supplier.working_hours) {
				const workingHours = document.createElement("p");
				workingHours.className = "card-working-hours";
				workingHours.textContent = `🕐 ${supplier.working_hours}`;
				titleWrap.appendChild(workingHours);
			}

			// Добавляем дополнительную информацию, если есть
			if (supplier.additional_info) {
				const additionalInfo = document.createElement("p");
				additionalInfo.className = "card-additional-info";
				additionalInfo.textContent = supplier.additional_info;
				titleWrap.appendChild(additionalInfo);
			}

			const coords = document.createElement("div");
			coords.className = "coords";
			coords.textContent = formatCoords(supplier.lat, supplier.lon);

			header.appendChild(checkboxWrap);
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
				openRoute(supplier.lat, supplier.lon, supplier.name || "");
			});

			const openBtn = document.createElement("button");
			openBtn.className = "btn btn-outline";
			openBtn.type = "button";
			openBtn.textContent = "Открыть точку";
			openBtn.addEventListener("click", () => {
				const naviPlace = buildYandexNavigatorPlaceUrl(supplier.lat, supplier.lon, supplier.name || "");
				const mapsPlace = buildYandexPlaceUrl(supplier.lat, supplier.lon);
				openWithFallback(naviPlace, mapsPlace);
			});

			// Кнопка редактирования
			const editBtn = document.createElement("button");
			editBtn.className = "btn btn-outline btn-icon-only";
			editBtn.type = "button";
			editBtn.title = "Редактировать";
			editBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
				<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
			</svg>`;
			editBtn.addEventListener("click", () => {
				openSupplierModal(supplier);
			});

			actions.appendChild(goBtn);
			actions.appendChild(openBtn);
			actions.appendChild(editBtn);

			const infoPoints = parseInfoPoints(supplier.info);
			if (infoPoints.length) {
				const dropdown = createInfoDropdown(infoPoints, supplier.name || "");
				actions.appendChild(dropdown);
			}

			li.appendChild(header);
			li.appendChild(actions);
			suppliersListEl.appendChild(li);
		}

		updateButtonsEnabledState();
		updateRouteButton();
	}

	function updateRouteButton() {
		const routeBtn = document.getElementById("buildRouteBtn");
		const clearBtn = document.getElementById("clearSelectionBtn");
		if (routeBtn) {
			const count = selectedSuppliers.size;
			routeBtn.disabled = count === 0 || !currentPosition;
			if (count > 0) {
				routeBtn.textContent = `Поехать по маршруту (${count})`;
			} else {
				routeBtn.textContent = "Поехать по маршруту";
			}
		}
		if (clearBtn) {
			clearBtn.disabled = selectedSuppliers.size === 0;
		}
	}

	function clearSelection() {
		selectedSuppliers.clear();
		// Обновляем все чекбоксы
		const checkboxes = document.querySelectorAll(".supplier-checkbox");
		checkboxes.forEach(checkbox => {
			checkbox.checked = false;
		});
		updateRouteButton();
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

	function openSupplierModal(supplier = null) {
		const modal = document.getElementById("supplierModal");
		const form = document.getElementById("supplierForm");
		const title = document.getElementById("supplierModalTitle");
		const deleteBtn = document.getElementById("deleteSupplierBtn");
		
		if (!modal || !form) return;
		
		editingSupplierId = supplier ? supplier.id : null;
		
		if (supplier) {
			title.textContent = "Редактировать поставщика";
			document.getElementById("supplierName").value = supplier.name || "";
			document.getElementById("supplierAddress").value = supplier.address || "";
			document.getElementById("supplierLat").value = supplier.lat || "";
			document.getElementById("supplierLon").value = supplier.lon || "";
			document.getElementById("supplierWorkingHours").value = supplier.working_hours || "";
			document.getElementById("supplierAdditionalInfo").value = supplier.additional_info || "";
			document.getElementById("supplierInfo").value = supplier.info ? JSON.stringify(supplier.info, null, 2) : "";
			deleteBtn.style.display = "block";
		} else {
			title.textContent = "Добавить поставщика";
			form.reset();
			deleteBtn.style.display = "none";
		}
		
		modal.classList.add("is-open");
	}

	function closeSupplierModal() {
		const modal = document.getElementById("supplierModal");
		if (modal) {
			modal.classList.remove("is-open");
		}
		editingSupplierId = null;
	}

	async function saveSupplier(formData) {
		try {
			const supplier = {
				name: formData.get("name").trim(),
				address: formData.get("address")?.trim() || "",
				lat: parseFloat(formData.get("lat")),
				lon: parseFloat(formData.get("lon")),
				working_hours: formData.get("working_hours")?.trim() || null,
				additional_info: formData.get("additional_info")?.trim() || null
			};
			
			// Валидация
			if (!supplier.name) {
				alert("Название обязательно для заполнения");
				return false;
			}
			if (isNaN(supplier.lat) || isNaN(supplier.lon)) {
				alert("Координаты должны быть числами");
				return false;
			}
			if (supplier.lat < -90 || supplier.lat > 90) {
				alert("Широта должна быть от -90 до 90");
				return false;
			}
			if (supplier.lon < -180 || supplier.lon > 180) {
				alert("Долгота должна быть от -180 до 180");
				return false;
			}
			
			// Парсим дополнительную информацию (JSON для дополнительных точек), если есть
			const infoText = formData.get("info")?.trim();
			if (infoText) {
				try {
					supplier.info = JSON.parse(infoText);
				} catch (e) {
					alert("Ошибка в формате JSON дополнительных точек. Поле будет проигнорировано.");
				}
			}
			
			// Обновляем или добавляем поставщика
			if (editingSupplierId) {
				// Редактируем существующего
				await window.SuppliersDB.update(editingSupplierId, supplier);
			} else {
				// Добавляем нового
				await window.SuppliersDB.add(supplier);
			}
			
			// Перезагружаем список
			await loadSuppliers();
			renderSuppliers(filteredSuppliers);
			closeSupplierModal();
			return true;
		} catch (err) {
			console.error("Ошибка сохранения поставщика:", err);
			alert("Не удалось сохранить поставщика: " + err.message);
			return false;
		}
	}

	async function deleteSupplier() {
		if (!editingSupplierId) return;
		
		if (!confirm("Вы уверены, что хотите удалить этого поставщика?")) {
			return;
		}
		
		try {
			await window.SuppliersDB.delete(editingSupplierId);
			await loadSuppliers();
			renderSuppliers(filteredSuppliers);
			closeSupplierModal();
		} catch (err) {
			console.error("Ошибка удаления поставщика:", err);
			alert("Не удалось удалить поставщика: " + err.message);
		}
	}

	function attachEvents() {
		if (detectBtn) detectBtn.addEventListener("click", detectLocation);
		if (officeBtn) {
			officeBtn.addEventListener("click", () => {
				openRoute(OFFICE_COORDS.lat, OFFICE_COORDS.lon, "Офис");
			});
		}
		if (warehouseBtn) {
			warehouseBtn.addEventListener("click", () => {
				openRoute(WAREHOUSE_COORDS.lat, WAREHOUSE_COORDS.lon, "Склад");
			});
		}
		const addSupplierBtn = document.getElementById("addSupplierBtn");
		if (addSupplierBtn) {
			addSupplierBtn.addEventListener("click", () => openSupplierModal());
		}
		const buildRouteBtn = document.getElementById("buildRouteBtn");
		if (buildRouteBtn) {
			buildRouteBtn.addEventListener("click", buildMultiRoute);
		}
		const clearSelectionBtn = document.getElementById("clearSelectionBtn");
		if (clearSelectionBtn) {
			clearSelectionBtn.addEventListener("click", clearSelection);
		}
		const openNaviBtn = document.getElementById("openNaviBtn");
		if (openNaviBtn) {
			openNaviBtn.addEventListener("click", () => openRouteDirect('navigator'));
		}
		const openMapsBtn = document.getElementById("openMapsBtn");
		if (openMapsBtn) {
			openMapsBtn.addEventListener("click", () => openRouteDirect('maps'));
		}
		const cancelRouteBtn = document.getElementById("cancelRouteBtn");
		if (cancelRouteBtn) {
			cancelRouteBtn.addEventListener("click", hideRouteModal);
		}
		const routeModal = document.getElementById("routeModal");
		if (routeModal) {
			routeModal.addEventListener("click", (e) => {
				if (e.target === routeModal) {
					hideRouteModal();
				}
			});
		}
		const supplierModal = document.getElementById("supplierModal");
		if (supplierModal) {
			supplierModal.addEventListener("click", (e) => {
				if (e.target === supplierModal) {
					closeSupplierModal();
				}
			});
		}
		const supplierForm = document.getElementById("supplierForm");
		if (supplierForm) {
			supplierForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const formData = new FormData(e.target);
				await saveSupplier(formData);
			});
		}
		const cancelSupplierBtn = document.getElementById("cancelSupplierBtn");
		if (cancelSupplierBtn) {
			cancelSupplierBtn.addEventListener("click", closeSupplierModal);
		}
		const deleteSupplierBtn = document.getElementById("deleteSupplierBtn");
		if (deleteSupplierBtn) {
			deleteSupplierBtn.addEventListener("click", deleteSupplier);
		}
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


