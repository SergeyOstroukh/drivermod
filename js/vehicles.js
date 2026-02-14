(() => {
	"use strict";

	let drivers = [];
	let vehicles = [];
	let editingDriverId = null;
	let editingVehicleId = null;
	let currentRole = null; // 'driver' or 'logist'
	let currentDriverData = null; // объект водителя при роли 'driver'
	let driverEntryVehicle = null; // автомобиль для упрощённого ввода

	const driversListEl = document.getElementById("driversList");
	const vehiclesListEl = document.getElementById("vehiclesList");
	const addDriverBtn = document.getElementById("addDriverBtn");
	const addVehicleBtn = document.getElementById("addVehicleBtn");

	// Навигация между разделами
	function initNavigation() {
		const navTabs = document.querySelectorAll(".nav-tab");
		console.log("Инициализация навигации, найдено вкладок:", navTabs.length);
		navTabs.forEach(tab => {
			tab.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const section = tab.dataset.section;
				console.log("Клик по вкладке, секция:", section);
				switchSection(section);
			});
		});
	}

	function switchSection(section) {
		// Для раздела автомобилей требуется выбор роли
		if (section === "vehicles" && !currentRole) {
			loadDriversForRoleSelection();
			return;
		}
		// Распределение доступно только логисту
		if (section === "distribution" && currentRole !== "logist") {
			loadDriversForRoleSelection();
			return;
		}
		console.log("switchSection вызвана, section:", section);
		
		// Обновляем активную вкладку
		document.querySelectorAll(".nav-tab").forEach(tab => {
			tab.classList.toggle("active", tab.dataset.section === section);
		});

		// Скрываем все разделы (основные + подсекции)
		const allSections = [
			"suppliersSection", "driversSection", "vehiclesSection",
			"historySection", "mileageSection", "maintenanceSection",
			"distributionSection", "driverRouteSection"
		];
		allSections.forEach(sectionId => {
			const sec = document.getElementById(sectionId);
			if (sec) {
				sec.style.display = "none";
				sec.classList.remove("active");
			}
		});

		// Показываем нужный раздел
		const targetSection = document.getElementById(`${section}Section`);
		console.log("targetSection:", targetSection, "section:", section);
		if (targetSection) {
			// Убираем inline стили, если они есть
			targetSection.removeAttribute("style");
			targetSection.style.display = "block";
			targetSection.classList.add("active");
			console.log("Секция показана:", section, "display:", targetSection.style.display);
		} else {
			console.error("Секция не найдена:", `${section}Section`);
		}

		// Обновляем заголовок
		const titles = {
			suppliers: "Поставщики",
			drivers: "Водители",
			vehicles: "Автомобили",
			distribution: "Распределение маршрутов"
		};
		const pageTitle = document.getElementById("pageTitle");
		if (pageTitle) {
			pageTitle.textContent = titles[section] || "Поставщики";
		}

		// Скрываем/показываем элементы поиска и действий
		const searchInput = document.getElementById("searchInput");
		const headerActions = document.querySelector(".header-actions");
		const headerTop = document.querySelector(".header-top");
		const appContainer = document.getElementById("app");
		
		if (section === "distribution") {
			// Для распределения скрываем header-top и даём full-width
			if (headerTop) headerTop.style.display = "none";
			if (appContainer) appContainer.classList.add("dc-fullwidth");
		} else if (section === "suppliers") {
			if (headerTop) headerTop.style.display = "";
			if (appContainer) appContainer.classList.remove("dc-fullwidth");
			if (searchInput) searchInput.style.display = "block";
			if (headerActions) {
				headerActions.style.display = "flex";
				// Восстанавливаем видимость кнопок поставщиков
				["addSupplierBtn", "officeBtn", "warehouseBtn", "detectLocationBtn", "viewToggleBtn"].forEach(id => {
					const btn = document.getElementById(id);
					if (btn) btn.style.display = "";
				});
			}
		} else {
			if (headerTop) headerTop.style.display = "";
			if (appContainer) appContainer.classList.remove("dc-fullwidth");
			if (searchInput) searchInput.style.display = "none";
			if (headerActions) {
				// Скрываем кнопки поставщиков
				["addSupplierBtn", "officeBtn", "warehouseBtn", "detectLocationBtn", "viewToggleBtn"].forEach(id => {
					const btn = document.getElementById(id);
					if (btn) btn.style.display = "none";
				});
			}
		}

		// Загружаем данные при переключении
		if (section === "drivers") {
			loadDrivers();
		} else if (section === "vehicles") {
			loadVehicles();
		} else if (section === "distribution") {
			if (window.DistributionUI) window.DistributionUI.onSectionActivated();
		}

		// Обновляем user bar
		updateUserBar();

		// Сохраняем текущую секцию в сессию (если залогинен)
		if (currentRole) {
			saveSession(section);
		}
	}

	// ============================================
	// ВОДИТЕЛИ
	// ============================================

	async function loadDrivers() {
		try {
			drivers = await window.VehiclesDB.getAllDrivers();
			renderDrivers();
		} catch (err) {
			console.error("Ошибка загрузки водителей:", err);
			drivers = [];
			renderDrivers();
		}
	}

	function renderDrivers() {
		if (!driversListEl) return;
		driversListEl.innerHTML = "";

		if (drivers.length === 0) {
			const empty = document.createElement("li");
			empty.className = "card";
			empty.textContent = "Водители не добавлены";
			driversListEl.appendChild(empty);
			return;
		}

		drivers.forEach((driver, i) => {
			const li = document.createElement("li");
			li.className = "card";

			const header = document.createElement("div");
			header.className = "card-header";

			const titleWrap = document.createElement("div");
			titleWrap.className = "title-wrap";
			const title = document.createElement("h3");
			title.className = "card-title";
			title.textContent = driver.name || "Без имени";
			
			const subtitle = document.createElement("p");
			subtitle.className = "card-subtitle";
			if (driver.phone) {
				subtitle.textContent = `📞 ${driver.phone}`;
			}
			if (driver.license_number) {
				const license = document.createElement("p");
				license.className = "card-subtitle";
				license.textContent = `🪪 ${driver.license_number}`;
				if (driver.license_expiry) {
					const expiry = new Date(driver.license_expiry);
					const today = new Date();
					const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
					if (daysLeft < 30) {
						license.textContent += ` (истекает через ${daysLeft} дн.)`;
						license.style.color = "var(--danger)";
					}
				}
				titleWrap.appendChild(license);
			}

			titleWrap.appendChild(title);
			if (subtitle.textContent) titleWrap.appendChild(subtitle);

			if (driver.notes) {
				const notes = document.createElement("p");
				notes.className = "card-additional-info";
				notes.textContent = driver.notes;
				titleWrap.appendChild(notes);
			}

			header.appendChild(titleWrap);

			const actions = document.createElement("div");
			actions.className = "actions";

			// Кнопка маршрутов
			const routeBtn = document.createElement("button");
			routeBtn.className = "btn btn-outline btn-icon-only driver-route-btn";
			routeBtn.title = "Маршруты";
			routeBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
				<circle cx="12" cy="10" r="3"></circle>
			</svg>`;
			routeBtn.addEventListener("click", () => openDriverRoute(driver));

			const editBtn = document.createElement("button");
			editBtn.className = "btn btn-outline btn-icon-only";
			editBtn.title = "Редактировать";
			editBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
				<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
			</svg>`;
			editBtn.addEventListener("click", () => openDriverModal(driver));

			actions.appendChild(routeBtn);
			actions.appendChild(editBtn);
			li.appendChild(header);
			li.appendChild(actions);
			driversListEl.appendChild(li);
		});
	}

	function openDriverModal(driver = null) {
		const modal = document.getElementById("driverModal");
		const form = document.getElementById("driverForm");
		const title = document.getElementById("driverModalTitle");
		const deleteBtn = document.getElementById("deleteDriverBtn");

		if (!modal || !form) return;

		editingDriverId = driver ? driver.id : null;

		if (driver) {
			title.textContent = "Редактировать водителя";
			document.getElementById("driverName").value = driver.name || "";
			document.getElementById("driverPhone").value = driver.phone || "";
			document.getElementById("driverLicense").value = driver.license_number || "";
			document.getElementById("driverLicenseExpiry").value = driver.license_expiry || "";
			document.getElementById("driverNotes").value = driver.notes || "";
			deleteBtn.style.display = "block";
		} else {
			title.textContent = "Добавить водителя";
			form.reset();
			deleteBtn.style.display = "none";
		}

		modal.classList.add("is-open");
	}

	function closeDriverModal() {
		const modal = document.getElementById("driverModal");
		if (modal) {
			modal.classList.remove("is-open");
		}
		editingDriverId = null;
	}

	async function saveDriver(formData) {
		try {
			const driver = {
				name: formData.get("name").trim(),
				phone: formData.get("phone")?.trim() || null,
				license_number: formData.get("license_number")?.trim() || null,
				license_expiry: formData.get("license_expiry") || null,
				notes: formData.get("notes")?.trim() || null
			};

			if (!driver.name) {
				alert("ФИО обязательно для заполнения");
				return false;
			}

			if (editingDriverId) {
				await window.VehiclesDB.updateDriver(editingDriverId, driver);
			} else {
				await window.VehiclesDB.addDriver(driver);
			}

			await loadDrivers();
			closeDriverModal();
			return true;
		} catch (err) {
			console.error("Ошибка сохранения водителя:", err);
			alert("Не удалось сохранить водителя: " + err.message);
			return false;
		}
	}

	async function deleteDriver() {
		if (!editingDriverId) return;

		if (!confirm("Вы уверены, что хотите удалить этого водителя?")) {
			return;
		}

		try {
			await window.VehiclesDB.deleteDriver(editingDriverId);
			await loadDrivers();
			closeDriverModal();
		} catch (err) {
			console.error("Ошибка удаления водителя:", err);
			alert("Не удалось удалить водителя: " + err.message);
		}
	}

	// ============================================
	// МАРШРУТЫ ВОДИТЕЛЕЙ
	// ============================================

	const MINSK_CENTER_ROUTE = [53.9006, 27.559];
	let driverRouteMapInstance = null;
	let driverRoutePlacemarks = [];
	let currentRouteDriverId = null;

	async function openDriverRoute(driver) {
		currentRouteDriverId = driver.id;
		const section = document.getElementById("driverRouteSection");
		if (!section) return;

		// Hide drivers list, show route section
		const driversSection = document.getElementById("driversSection");
		if (driversSection) driversSection.style.display = "none";

		section.style.display = "block";
		section.classList.add("active");
		window.scrollTo(0, 0);

		// Set title
		const titleEl = document.getElementById("driverRouteTitle");
		if (titleEl) titleEl.textContent = "Маршрут: " + (driver.name || "Водитель");

		// Load route
		const today = new Date().toISOString().split("T")[0];
		try {
			const route = await window.VehiclesDB.getDriverRoute(driver.id, today);
			renderDriverRoute(route);
		} catch (err) {
			console.error("Ошибка загрузки маршрута:", err);
			renderDriverRoute(null);
		}
	}

	function closeDriverRoute() {
		const section = document.getElementById("driverRouteSection");
		if (section) {
			section.style.display = "none";
			section.classList.remove("active");
		}
		const driversSection = document.getElementById("driversSection");
		if (driversSection) {
			driversSection.style.display = "block";
			driversSection.classList.add("active");
		}
		window.scrollTo(0, 0);
		currentRouteDriverId = null;
	}

	let currentRouteData = null; // текущий объект маршрута из БД
	let showCompletedPoints = false;

	function renderDriverRoute(route) {
		const listEl = document.getElementById("driverRouteList");
		const mapEl = document.getElementById("driverRouteMap");
		if (!listEl) return;

		currentRouteData = route;

		if (!route || !route.points || route.points.length === 0) {
			listEl.innerHTML = '<div class="route-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg><p>На сегодня маршрут не назначен</p></div>';
			return;
		}

		const allPoints = route.points.slice();
		allPoints.sort(function(a, b) { return (a.orderNum || 0) - (b.orderNum || 0); });

		const activePoints = allPoints.filter(function(pt) { return pt.status !== 'completed'; });
		const completedPoints = allPoints.filter(function(pt) { return pt.status === 'completed'; });
		const displayPoints = showCompletedPoints ? allPoints : activePoints;

		let html = '';

		// Header with stats and actions
		html += '<div class="route-header">';
		html += '<div class="route-header-stats">';
		html += '<span class="route-stat active-stat">' + activePoints.length + ' активных</span>';
		if (completedPoints.length > 0) {
			html += '<span class="route-stat completed-stat">' + completedPoints.length + ' завершённых</span>';
		}
		html += '</div>';
		html += '<div class="route-header-actions">';
		// Build full route button
		if (activePoints.length > 0) {
			html += '<button class="btn btn-primary btn-sm route-build-btn" id="routeBuildAllBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg> Построить маршрут</button>';
		}
		if (completedPoints.length > 0) {
			html += '<button class="btn btn-outline btn-sm route-toggle-completed" id="routeToggleCompleted">' + (showCompletedPoints ? 'Скрыть завершённые' : 'Показать завершённые') + '</button>';
		}
		html += '</div>';
		html += '</div>';

		// Points list
		let num = 0;
		displayPoints.forEach(function (pt, idx) {
			const isCompleted = pt.status === 'completed';
			const ptIndex = allPoints.indexOf(pt);
			if (!isCompleted) num++;

			html += '<div class="route-point' + (isCompleted ? ' route-point-completed' : '') + '">';
			html += '<div class="route-point-num' + (isCompleted ? ' completed' : '') + '">' + (isCompleted ? '✓' : num) + '</div>';
			html += '<div class="route-point-info">';
			html += '<div class="route-point-addr' + (isCompleted ? ' completed-text' : '') + '">' + pt.address + '</div>';
			if (pt.formattedAddress) {
				html += '<div class="route-point-faddr">' + pt.formattedAddress + '</div>';
			}
			if (pt.isKbt) {
				html += '<div class="route-point-kbt" style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">';
				html += '<span style="background:#a855f7;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:3px;">📦 КБТ</span>';
				if (pt.isKbtHelper && pt.mainDriverName) {
					html += '<span style="font-size:11px;color:#a855f7;font-weight:600;">Вы помогаете: ' + pt.mainDriverName + '</span>';
				} else if (pt.helperDriverName) {
					html += '<span style="font-size:11px;color:#a855f7;font-weight:600;">Помощник: ' + pt.helperDriverName + '</span>';
				}
				html += '</div>';
			}
			if (pt.timeSlot) {
				html += '<div class="route-point-meta">⏰ ' + pt.timeSlot + '</div>';
			}
			if (pt.phone) {
				html += '<div class="route-point-meta"><a href="tel:' + pt.phone + '">📞 ' + pt.phone + '</a></div>';
			}
			html += '</div>';
			html += '<div class="route-point-actions">';
			if (!isCompleted) {
				// Navigate to single point
				if (pt.lat && pt.lng) {
					const webNavUrl = 'https://yandex.by/maps/?rtext=~' + pt.lat + ',' + pt.lng + '&rtt=auto';
					html += '<a href="' + webNavUrl + '" target="_blank" rel="noopener" class="btn btn-outline btn-sm route-nav-btn">Ехать</a>';
				}
				// Complete button
				html += '<button class="btn btn-primary btn-sm route-complete-btn" data-pt-index="' + ptIndex + '" title="Завершить">✓</button>';
			}
			html += '</div>';
			html += '</div>';
			if (idx < displayPoints.length - 1) {
				html += '<div class="route-connector"></div>';
			}
		});

		if (activePoints.length === 0 && completedPoints.length > 0 && !showCompletedPoints) {
			html += '<div class="route-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg><p>Все точки завершены!</p></div>';
		}

		listEl.innerHTML = html;

		// Bind events
		bindRouteEvents(allPoints);

		// Init or update route map (show only active points)
		initDriverRouteMap(activePoints, mapEl);
	}

	function bindRouteEvents(allPoints) {
		// Complete point buttons
		document.querySelectorAll('.route-complete-btn').forEach(function(btn) {
			btn.addEventListener('click', async function() {
				const ptIndex = parseInt(btn.dataset.ptIndex);
				await completeRoutePoint(ptIndex);
			});
		});

		// Build full route
		const buildBtn = document.getElementById('routeBuildAllBtn');
		if (buildBtn) {
			buildBtn.addEventListener('click', function() {
				buildOptimizedRoute();
			});
		}

		// Toggle completed visibility
		const toggleBtn = document.getElementById('routeToggleCompleted');
		if (toggleBtn) {
			toggleBtn.addEventListener('click', function() {
				showCompletedPoints = !showCompletedPoints;
				renderDriverRoute(currentRouteData);
			});
		}
	}

	async function completeRoutePoint(pointIndex) {
		if (!currentRouteData || !currentRouteData.points) return;

		// Update point status in the array
		const updatedPoints = currentRouteData.points.map(function(pt, idx) {
			if (idx === pointIndex) {
				return Object.assign({}, pt, { status: 'completed' });
			}
			return pt;
		});

		try {
			const updated = await window.VehiclesDB.updateRoutePoints(currentRouteData.id, updatedPoints);
			currentRouteData = updated;
			renderDriverRoute(updated);
		} catch (err) {
			console.error("Ошибка обновления статуса точки:", err);
			alert("Не удалось обновить статус: " + err.message);
		}
	}

	function buildOptimizedRoute() {
		if (!currentRouteData || !currentRouteData.points) return;

		const activePoints = currentRouteData.points
			.filter(function(pt) { return pt.status !== 'completed' && pt.lat && pt.lng; });

		if (activePoints.length === 0) return;

		// Оптимизация порядка (nearest neighbor от ближайшей к центру Минска)
		const optimized = optimizePointsOrder(activePoints);

		// Строим URL для Яндекс Карт с маршрутом через все точки
		// Формат: rtext=lat1,lng1~lat2,lng2~lat3,lng3&rtt=auto
		const rtextParts = optimized.map(function(pt) { return pt.lat + ',' + pt.lng; });
		const webUrl = 'https://yandex.by/maps/?rtext=' + rtextParts.join('~') + '&rtt=auto';

		// Всегда открываем в новой вкладке, чтобы не уходить из приложения
		window.open(webUrl, '_blank');
	}

	function optimizePointsOrder(points) {
		if (points.length <= 2) return points.slice();
		// Nearest neighbor: начинаем с ближайшей к центру Минска
		const center = MINSK_CENTER_ROUTE;
		let remaining = points.slice();
		let startIdx = 0;
		let minDist = Infinity;
		for (let i = 0; i < remaining.length; i++) {
			const d = haversineSimple(remaining[i].lat, remaining[i].lng, center[0], center[1]);
			if (d < minDist) { minDist = d; startIdx = i; }
		}
		const ordered = [remaining.splice(startIdx, 1)[0]];
		while (remaining.length > 0) {
			const last = ordered[ordered.length - 1];
			let nearIdx = 0;
			let nearDist = Infinity;
			for (let i = 0; i < remaining.length; i++) {
				const d = haversineSimple(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
				if (d < nearDist) { nearDist = d; nearIdx = i; }
			}
			ordered.push(remaining.splice(nearIdx, 1)[0]);
		}
		return ordered;
	}

	function haversineSimple(lat1, lng1, lat2, lng2) {
		const R = 6371;
		const dLat = ((lat2 - lat1) * Math.PI) / 180;
		const dLng = ((lng2 - lng1) * Math.PI) / 180;
		const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
			Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
			Math.sin(dLng/2) * Math.sin(dLng/2);
		return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}

	async function initDriverRouteMap(points, mapEl) {
		if (!mapEl) return;
		try {
			const ymaps = await window.DistributionGeocoder.loadYmaps();

			// Remove old placemarks if map exists
			if (driverRouteMapInstance) {
				driverRoutePlacemarks.forEach(function(pm) { driverRouteMapInstance.geoObjects.remove(pm); });
				driverRoutePlacemarks = [];
			} else {
				driverRouteMapInstance = new ymaps.Map(mapEl, {
					center: MINSK_CENTER_ROUTE,
					zoom: 12,
					controls: ['zoomControl']
				}, { suppressMapOpenBlock: true });
			}

			const bounds = [];
			points.forEach(function (pt, idx) {
				if (!pt.lat || !pt.lng) return;
				const pm = new ymaps.Placemark([pt.lat, pt.lng], {
					iconContent: String(idx + 1),
					balloonContentBody: '<div style="font-family:system-ui;"><strong>' + pt.address + '</strong>' +
						(pt.phone ? '<br>📞 ' + pt.phone : '') +
						(pt.timeSlot ? '<br>⏰ ' + pt.timeSlot : '') + '</div>'
				}, {
					preset: 'islands#darkBlueCircleIcon'
				});
				driverRouteMapInstance.geoObjects.add(pm);
				driverRoutePlacemarks.push(pm);
				bounds.push([pt.lat, pt.lng]);
			});

			if (bounds.length > 1) {
				driverRouteMapInstance.setBounds(ymaps.util.bounds.fromPoints(bounds), { checkZoomRange: true, zoomMargin: 40 });
			} else if (bounds.length === 1) {
				driverRouteMapInstance.setCenter(bounds[0], 15);
			}
		} catch (err) {
			console.error("Ошибка инициализации карты маршрута:", err);
		}
	}

	// ============================================
	// АВТОМОБИЛИ
	// ============================================

	async function loadVehicles() {
		try {
			vehicles = await window.VehiclesDB.getAllVehicles();
			await loadDrivers(); // Загружаем водителей для выпадающего списка
			renderVehicles();
		} catch (err) {
			console.error("Ошибка загрузки автомобилей:", err);
			vehicles = [];
			renderVehicles();
		}
	}

	function renderVehicles() {
		if (!vehiclesListEl) return;
		vehiclesListEl.innerHTML = "";

		// Обновляем панель пользователя
		updateUserBar();

		// Водитель видит все машины (могут меняться машинами)
		let displayVehicles = vehicles;

		// Скрываем кнопку добавления для водителей
		if (addVehicleBtn) {
			addVehicleBtn.style.display = currentRole === "driver" ? "none" : "";
		}

		if (displayVehicles.length === 0) {
			const empty = document.createElement("li");
			empty.className = "card";
			empty.textContent = "Автомобили не добавлены";
			vehiclesListEl.appendChild(empty);
			return;
		}

		displayVehicles.forEach((vehicle) => {
			const li = document.createElement("li");
			li.className = "card";

			const header = document.createElement("div");
			header.className = "card-header";

			const titleWrap = document.createElement("div");
			titleWrap.className = "title-wrap";
			const title = document.createElement("h3");
			title.className = "card-title";
			title.textContent = vehicle.plate_number || "Без номера";
			titleWrap.appendChild(title);

			// Текущий водитель (выделяем жирным)
			// Проверяем разные варианты структуры данных
			let driver = null;
			if (vehicle.drivers) {
				// Если это объект
				if (typeof vehicle.drivers === 'object' && !Array.isArray(vehicle.drivers)) {
					driver = vehicle.drivers;
				}
				// Если это массив
				else if (Array.isArray(vehicle.drivers) && vehicle.drivers.length > 0) {
					driver = vehicle.drivers[0];
				}
			}
			
			if (driver && driver.name) {
				const driverInfo = document.createElement("p");
				driverInfo.className = "card-subtitle";
				driverInfo.style.fontWeight = "600";
				driverInfo.style.color = "var(--accent)";
				driverInfo.textContent = `👤 Водитель: ${driver.name}`;
				if (driver.phone) {
					driverInfo.textContent += ` (${driver.phone})`;
				}
				titleWrap.appendChild(driverInfo);
			} else if (vehicle.driver_id) {
				// Если водитель назначен, но данные не загрузились
				const driverInfo = document.createElement("p");
				driverInfo.className = "card-subtitle";
				driverInfo.style.fontStyle = "italic";
				driverInfo.style.color = "var(--muted)";
				driverInfo.textContent = `👤 Водитель: загрузка...`;
				titleWrap.appendChild(driverInfo);
			}

			// Пробег
			if (vehicle.mileage) {
				const mileageInfo = document.createElement("p");
				mileageInfo.className = "card-subtitle";
				mileageInfo.textContent = `📊 Пробег: ${vehicle.mileage.toLocaleString()} км`;
				titleWrap.appendChild(mileageInfo);
			}

			// Расход топлива
			if (vehicle.fuel_consumption) {
				const fuelInfo = document.createElement("p");
				fuelInfo.className = "card-subtitle";
				fuelInfo.textContent = `⛽ Расход: ${vehicle.fuel_consumption} л/100км`;
				titleWrap.appendChild(fuelInfo);
			}

			// Информация о техосмотре
			if (vehicle.inspection_start || vehicle.inspection_expiry) {
				const inspection = document.createElement("p");
				inspection.className = "card-subtitle";
				const start = vehicle.inspection_start ? new Date(vehicle.inspection_start).toLocaleDateString('ru-RU') : '?';
				const end = vehicle.inspection_expiry ? new Date(vehicle.inspection_expiry).toLocaleDateString('ru-RU') : '?';
				inspection.textContent = `🔧 Техосмотр: ${start} - ${end}`;
				
				// Проверка срока действия
				if (vehicle.inspection_expiry) {
					const expiry = new Date(vehicle.inspection_expiry);
					const today = new Date();
					const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
					if (daysLeft < 30) {
						inspection.style.color = "var(--danger)";
						inspection.textContent += ` (⚠️ ${daysLeft} дн.)`;
					}
				}
				titleWrap.appendChild(inspection);
			}

			// Информация о страховке
			if (vehicle.insurance_start || vehicle.insurance_expiry) {
				const insurance = document.createElement("p");
				insurance.className = "card-subtitle";
				const start = vehicle.insurance_start ? new Date(vehicle.insurance_start).toLocaleDateString('ru-RU') : '?';
				const end = vehicle.insurance_expiry ? new Date(vehicle.insurance_expiry).toLocaleDateString('ru-RU') : '?';
				insurance.textContent = `🛡️ Страховка: ${start} - ${end}`;
				
				// Проверка срока действия
				if (vehicle.insurance_expiry) {
					const expiry = new Date(vehicle.insurance_expiry);
					const today = new Date();
					const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
					if (daysLeft < 30) {
						insurance.style.color = "var(--danger)";
						insurance.textContent += ` (⚠️ ${daysLeft} дн.)`;
					}
				}
				titleWrap.appendChild(insurance);
			}

			// Информация о замене масла
			if (vehicle.oil_change_mileage || vehicle.oil_change_interval) {
				const oil = document.createElement("p");
				oil.className = "card-subtitle";
				const changeMileage = vehicle.oil_change_mileage || 0;
				const interval = vehicle.oil_change_interval || 0;
				const nextChange = changeMileage + interval;
				oil.textContent = `🛢️ Масло: заменили на ${changeMileage.toLocaleString()} км, следующая замена на ${nextChange.toLocaleString()} км`;
				
				// Проверка необходимости замены
				if (vehicle.mileage && nextChange > 0) {
					const kmLeft = nextChange - vehicle.mileage;
					if (kmLeft < 500) {
						oil.style.color = "var(--danger)";
						oil.textContent += ` (⚠️ осталось ${kmLeft} км)`;
					}
				}
				titleWrap.appendChild(oil);
			}

			if (vehicle.notes) {
				const notes = document.createElement("p");
				notes.className = "card-additional-info";
				notes.textContent = vehicle.notes;
				titleWrap.appendChild(notes);
			}

			header.appendChild(titleWrap);

			if (currentRole === "driver") {
				// Для водителя: большая кнопка ввода данных + история
				const driverActions = document.createElement("div");
				driverActions.className = "driver-actions";

				const entryBtn = document.createElement("button");
				entryBtn.className = "btn btn-primary btn-driver-entry";
				entryBtn.innerHTML = `<svg class="btn-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
				</svg> Ввести данные за смену`;
				entryBtn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					openDriverEntry(vehicle);
				});

				const viewHistoryBtn = document.createElement("button");
				viewHistoryBtn.className = "btn btn-outline";
				viewHistoryBtn.style.width = "100%";
				viewHistoryBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 3h18v18H3zM7 3v18M3 7h18M3 12h18M3 17h18"></path>
				</svg> Посмотреть историю`;
				viewHistoryBtn.addEventListener("click", () => openMileageModal(vehicle));

				driverActions.appendChild(entryBtn);
				driverActions.appendChild(viewHistoryBtn);
				li.appendChild(header);
				li.appendChild(driverActions);
			} else {
				// Для логиста: стандартные кнопки
				const actions = document.createElement("div");
				actions.className = "actions";

				const mileageBtn = document.createElement("button");
				mileageBtn.className = "btn btn-outline btn-icon-only";
				mileageBtn.title = "Ввести пробег";
				mileageBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M5 17h2m10 0h2M2 9h1m18 0h1"></path>
					<rect x="3" y="7" width="18" height="8" rx="2"></rect>
					<circle cx="7" cy="17" r="2"></circle>
					<circle cx="17" cy="17" r="2"></circle>
					<path d="M6 7V5a1 1 0 0 1 1-1h4l3 3h4a1 1 0 0 1 1 1v0"></path>
				</svg>`;
				mileageBtn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					openMileageModal(vehicle);
				});

				const historyBtn = document.createElement("button");
				historyBtn.className = "btn btn-outline btn-icon-only";
				historyBtn.title = "История использования";
				historyBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 3h18v18H3zM7 3v18M3 7h18M3 12h18M3 17h18"></path>
				</svg>`;
				historyBtn.addEventListener("click", () => openHistoryTable(vehicle));

				const editBtn = document.createElement("button");
				editBtn.className = "btn btn-outline btn-icon-only";
				editBtn.title = "Редактировать";
				editBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
					<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
				</svg>`;
				editBtn.addEventListener("click", () => openVehicleModal(vehicle));

				const maintenanceBtn = document.createElement("button");
				maintenanceBtn.className = "btn btn-outline btn-icon-only";
				maintenanceBtn.title = "Журнал ТО";
				maintenanceBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
				</svg>`;
				maintenanceBtn.addEventListener("click", () => openMaintenanceSection(vehicle));

				actions.appendChild(mileageBtn);
				actions.appendChild(historyBtn);
				actions.appendChild(maintenanceBtn);
				actions.appendChild(editBtn);
				li.appendChild(header);
				li.appendChild(actions);
			}
			vehiclesListEl.appendChild(li);
		});
	}

	function openVehicleModal(vehicle = null) {
		const modal = document.getElementById("vehicleModal");
		const form = document.getElementById("vehicleForm");
		const title = document.getElementById("vehicleModalTitle");
		const deleteBtn = document.getElementById("deleteVehicleBtn");
		const driverSelect = document.getElementById("vehicleDriver");

		if (!modal || !form) return;

		editingVehicleId = vehicle ? vehicle.id : null;

		// Заполняем список водителей
		if (driverSelect) {
			driverSelect.innerHTML = '<option value="">Не назначен</option>';
			drivers.forEach(driver => {
				const option = document.createElement("option");
				option.value = driver.id;
				option.textContent = driver.name;
				if (vehicle && vehicle.driver_id === driver.id) {
					option.selected = true;
				}
				driverSelect.appendChild(option);
			});
		}

		if (vehicle) {
			title.textContent = "Редактировать автомобиль";
			document.getElementById("vehiclePlate").value = vehicle.plate_number || "";
			document.getElementById("vehicleDriver").value = vehicle.driver_id || "";
			document.getElementById("vehicleMileage").value = vehicle.mileage || "";
			document.getElementById("vehicleFuelConsumption").value = vehicle.fuel_consumption || "";
			document.getElementById("vehicleOilChangeMileage").value = vehicle.oil_change_mileage || "";
			document.getElementById("vehicleOilInfo").value = vehicle.oil_change_info || "";
			document.getElementById("vehicleOilInterval").value = vehicle.oil_change_interval || "";
			document.getElementById("vehicleInspectionStart").value = vehicle.inspection_start || "";
			document.getElementById("vehicleInspection").value = vehicle.inspection_expiry || "";
			document.getElementById("vehicleInsuranceStart").value = vehicle.insurance_start || "";
			document.getElementById("vehicleInsurance").value = vehicle.insurance_expiry || "";
			document.getElementById("vehiclePeriodStart").value = vehicle.driver_period_start || "";
			document.getElementById("vehiclePeriodEnd").value = vehicle.driver_period_end || "";
			document.getElementById("vehicleNotes").value = vehicle.notes || "";
			deleteBtn.style.display = "block";
		} else {
			title.textContent = "Добавить автомобиль";
			form.reset();
			deleteBtn.style.display = "none";
		}

		modal.classList.add("is-open");
	}

	function closeVehicleModal() {
		const modal = document.getElementById("vehicleModal");
		if (modal) {
			modal.classList.remove("is-open");
		}
		editingVehicleId = null;
	}

		async function saveVehicle(formData) {
		try {
			const vehicle = {
				plate_number: formData.get("plate_number").trim(),
				driver_id: formData.get("driver_id") || null,
				mileage: parseInt(formData.get("mileage")) || 0,
				fuel_consumption: parseFloat(formData.get("fuel_consumption")) || null,
				oil_change_mileage: parseInt(formData.get("oil_change_mileage")) || null,
				oil_change_info: formData.get("oil_change_info")?.trim() || null,
				oil_change_interval: parseInt(formData.get("oil_change_interval")) || null,
				inspection_start: formData.get("inspection_start") || null,
				inspection_expiry: formData.get("inspection_expiry") || null,
				insurance_start: formData.get("insurance_start") || null,
				insurance_expiry: formData.get("insurance_expiry") || null,
				driver_period_start: formData.get("driver_period_start") || null,
				driver_period_end: formData.get("driver_period_end") || null,
				notes: formData.get("notes")?.trim() || null
			};

			if (!vehicle.plate_number) {
				alert("Гос. номер обязательно для заполнения");
				return false;
			}

			if (editingVehicleId) {
				await window.VehiclesDB.updateVehicle(editingVehicleId, vehicle);
			} else {
				await window.VehiclesDB.addVehicle(vehicle);
			}

			await loadVehicles();
			closeVehicleModal();
			return true;
		} catch (err) {
			console.error("Ошибка сохранения автомобиля:", err);
			alert("Не удалось сохранить автомобиль: " + err.message);
			return false;
		}
	}

	async function deleteVehicle() {
		if (!editingVehicleId) return;

		if (!confirm("Вы уверены, что хотите удалить этот автомобиль?")) {
			return;
		}

		try {
			await window.VehiclesDB.deleteVehicle(editingVehicleId);
			await loadVehicles();
			closeVehicleModal();
		} catch (err) {
			console.error("Ошибка удаления автомобиля:", err);
			alert("Не удалось удалить автомобиль: " + err.message);
		}
	}

	// ============================================
	// ИСТОРИЯ ИСПОЛЬЗОВАНИЯ
	// ============================================

	let currentHistoryVehicleId = null;
	let historyEntries = [];

	async function loadHistory(vehicleId) {
		try {
			// Загружаем ручные записи истории
			historyEntries = await window.VehiclesDB.getVehicleHistory(vehicleId);

			// Подтягиваем автоматическую историю из лога пробега
			const mileageEntries = await window.VehiclesDB.getMileageLog(vehicleId);
			const autoHistory = buildAutoHistoryFromMileage(mileageEntries);

			renderHistory(autoHistory);
		} catch (err) {
			console.error("Ошибка загрузки истории:", err);
			historyEntries = [];
			renderHistory([]);
		}
	}

	/**
	 * Строит автоматическую историю водителей из лога пробега.
	 * Группирует последовательные записи одного водителя в периоды.
	 */
	function buildAutoHistoryFromMileage(mileageEntries) {
		if (!mileageEntries || mileageEntries.length === 0) return [];

		// Сортируем по дате
		const sorted = [...mileageEntries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));

		const periods = [];
		let currentPeriod = null;

		for (const entry of sorted) {
			const driverId = entry.driver_id;
			const driverObj = entry.driver || entry.drivers || null;
			const date = entry.log_date;

			if (!driverId) continue;

			if (currentPeriod && currentPeriod.driver_id === driverId) {
				// Тот же водитель — расширяем период
				currentPeriod.end_date = date;
				currentPeriod.shifts++;
				currentPeriod.totalMileage += (entry.mileage || 0) - (entry.mileage_out || 0);
			} else {
				// Новый водитель — закрываем предыдущий и открываем новый
				if (currentPeriod) {
					periods.push(currentPeriod);
				}
				currentPeriod = {
					driver_id: driverId,
					driver: driverObj,
					start_date: date,
					end_date: date,
					shifts: 1,
					totalMileage: (entry.mileage || 0) - (entry.mileage_out || 0)
				};
			}
		}
		if (currentPeriod) {
			periods.push(currentPeriod);
		}

		return periods;
	}

	function renderHistory(autoHistory = []) {
		const historyTableBody = document.getElementById("historyTableBody");
		if (!historyTableBody) return;

		historyTableBody.innerHTML = "";

		const hasManual = historyEntries.length > 0;
		const hasAuto = autoHistory.length > 0;

		if (!hasManual && !hasAuto) {
			const row = document.createElement("tr");
			row.innerHTML = '<td colspan="5" style="text-align: center; color: var(--muted);">История пуста</td>';
			historyTableBody.appendChild(row);
			return;
		}

		// --- Автоматическая история из лога пробега ---
		if (hasAuto) {
			// Заголовок секции
			const headerRow = document.createElement("tr");
			headerRow.innerHTML = `<td colspan="5" class="history-section-divider">
				<span class="history-section-label">Автоматически (из лога пробега)</span>
			</td>`;
			historyTableBody.appendChild(headerRow);

			autoHistory.forEach((period) => {
				const row = document.createElement("tr");
				row.className = "auto-history-row";

				let driver = period.driver;
				if (driver && Array.isArray(driver)) driver = driver[0];
				if (driver && typeof driver === 'object' && driver.id) { /* ok */ }
				else driver = null;

				const driverName = driver && driver.name ? driver.name : "Водитель ID:" + period.driver_id;
				const driverPhone = driver && driver.phone ? driver.phone : "";
				const startDate = period.start_date ? new Date(period.start_date).toLocaleDateString('ru-RU') : '?';
				const endDate = period.end_date ? new Date(period.end_date).toLocaleDateString('ru-RU') : '?';
				const isSameDay = period.start_date === period.end_date;
				const endDisplay = isSameDay ? startDate : endDate;
				const mileageNote = period.totalMileage > 0 ? `${period.shifts} смен, ${period.totalMileage.toLocaleString()} км` : `${period.shifts} смен`;

				row.innerHTML = `
					<td>
						<div class="driver-name">👤 ${driverName}</div>
						${driverPhone ? `<div class="driver-phone">${driverPhone}</div>` : ''}
					</td>
					<td class="date-cell">${startDate}</td>
					<td class="date-cell">${isSameDay ? '—' : endDisplay}</td>
					<td class="notes-cell">${mileageNote}</td>
					<td class="actions-cell"></td>
				`;
				historyTableBody.appendChild(row);
			});
		}

		// --- Ручные записи ---
		if (hasManual) {
			if (hasAuto) {
				const headerRow = document.createElement("tr");
				headerRow.innerHTML = `<td colspan="5" class="history-section-divider">
					<span class="history-section-label">Добавлено вручную</span>
				</td>`;
				historyTableBody.appendChild(headerRow);
			}

			historyEntries.forEach((entry) => {
				const row = document.createElement("tr");

				let driver = null;
				if (entry.driver) {
					driver = entry.driver;
				} else if (entry.drivers) {
					if (Array.isArray(entry.drivers)) {
						driver = entry.drivers.length > 0 ? entry.drivers[0] : null;
					} else if (typeof entry.drivers === 'object') {
						driver = entry.drivers;
					}
				}
				
				const driverName = driver && driver.name ? driver.name : "Неизвестный водитель";
				const driverPhone = driver && driver.phone ? driver.phone : "";
				const startDate = entry.start_date ? new Date(entry.start_date).toLocaleDateString('ru-RU') : '?';
				const endDate = entry.end_date ? new Date(entry.end_date).toLocaleDateString('ru-RU') : 'по настоящее время';
				const notes = entry.notes || '—';

				row.innerHTML = `
					<td>
						<div class="driver-name">👤 ${driverName}</div>
						${driverPhone ? `<div class="driver-phone">${driverPhone}</div>` : ''}
					</td>
					<td class="date-cell">${startDate}</td>
					<td class="date-cell">${endDate}</td>
					<td class="notes-cell" title="${notes}">${notes}</td>
					<td class="actions-cell">
						<button class="btn btn-outline btn-icon-only history-delete" data-id="${entry.id}" title="Удалить">
							<svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
							</svg>
						</button>
					</td>
				`;

				const deleteBtn = row.querySelector(".history-delete");
				if (deleteBtn) {
					deleteBtn.addEventListener("click", async () => {
						if (confirm("Удалить эту запись из истории?")) {
							try {
								await window.VehiclesDB.deleteHistoryEntry(entry.id);
								await loadHistory(currentHistoryVehicleId);
							} catch (err) {
								alert("Ошибка удаления: " + err.message);
							}
						}
					});
				}

				historyTableBody.appendChild(row);
			});
		}
	}

	function openHistoryTable(vehicle) {
		const historySection = document.getElementById("historySection");
		const vehiclesSection = document.getElementById("vehiclesSection");
		const title = document.getElementById("historySectionTitle");
		const driverSelect = document.getElementById("historyDriver");
		
		if (!historySection || !vehiclesSection) return;

		currentHistoryVehicleId = vehicle.id;
		if (title) {
			title.textContent = `История использования: ${vehicle.plate_number}`;
		}

		// Заполняем список водителей
		if (driverSelect) {
			driverSelect.innerHTML = '<option value="">Выберите водителя</option>';
			drivers.forEach(driver => {
				const option = document.createElement("option");
				option.value = driver.id;
				option.textContent = driver.name;
				driverSelect.appendChild(option);
			});
		}

		// Очищаем форму
		const historyForm = document.getElementById("historyForm");
		if (historyForm) {
			historyForm.reset();
		}

		// Переключаем секции
		vehiclesSection.style.display = "none";
		vehiclesSection.classList.remove("active");
		historySection.style.display = "block";
		historySection.classList.add("active");
		window.scrollTo(0, 0);
		loadHistory(vehicle.id);
	}

	function closeHistoryTable() {
		const historySection = document.getElementById("historySection");
		const vehiclesSection = document.getElementById("vehiclesSection");
		
		if (historySection) {
			historySection.style.display = "none";
			historySection.classList.remove("active");
		}
		if (vehiclesSection) {
			vehiclesSection.style.display = "block";
			vehiclesSection.classList.add("active");
		}
		window.scrollTo(0, 0);
		currentHistoryVehicleId = null;
		historyEntries = [];
	}

	async function saveHistoryEntry(formData) {
		try {
			if (!currentHistoryVehicleId) {
				alert("Ошибка: не выбран автомобиль");
				return false;
			}

			const entry = {
				vehicle_id: currentHistoryVehicleId,
				driver_id: parseInt(formData.get("history_driver_id")),
				start_date: formData.get("history_start_date"),
				end_date: formData.get("history_end_date") || null,
				notes: formData.get("history_notes")?.trim() || null
			};

			console.log("Сохранение записи истории:", entry);

			if (!entry.driver_id || isNaN(entry.driver_id)) {
				alert("Выберите водителя");
				return false;
			}

			if (!entry.start_date) {
				alert("Укажите дату начала");
				return false;
			}

			const savedEntry = await window.VehiclesDB.addHistoryEntry(entry);
			console.log("Сохраненная запись:", savedEntry);
			await loadHistory(currentHistoryVehicleId);
			
			// Очищаем форму
			document.getElementById("historyForm").reset();
			return true;
		} catch (err) {
			console.error("Ошибка сохранения записи истории:", err);
			alert("Не удалось сохранить: " + err.message);
			return false;
		}
	}

	// ============================================
	// ЖУРНАЛ ТО
	// ============================================

	let currentMaintenanceVehicleId = null;
	let maintenanceEntries = [];
	let editingMaintenanceId = null;

	function openMaintenanceSection(vehicle) {
		const maintenanceSection = document.getElementById("maintenanceSection");
		const vehiclesSection = document.getElementById("vehiclesSection");
		const title = document.getElementById("maintenanceSectionTitle");

		if (!maintenanceSection || !vehiclesSection) return;

		currentMaintenanceVehicleId = vehicle.id;
		editingMaintenanceId = null;

		if (title) {
			title.textContent = `Журнал ТО: ${vehicle.plate_number}`;
		}

		// Устанавливаем текущую дату
		const dateInput = document.getElementById("maintenanceDate");
		if (dateInput) {
			dateInput.value = new Date().toISOString().split('T')[0];
		}

		// Устанавливаем текущий пробег как подсказку
		const mileageInput = document.getElementById("maintenanceMileage");
		if (mileageInput && vehicle.mileage) {
			mileageInput.placeholder = `Текущий: ${vehicle.mileage.toLocaleString()} км`;
		}

		// Очищаем форму
		const form = document.getElementById("maintenanceForm");
		if (form) form.reset();
		if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

		// Сбрасываем кнопку на "Добавить"
		const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
		if (submitBtn) submitBtn.textContent = "Добавить";

		// Переключаем секции
		vehiclesSection.style.display = "none";
		vehiclesSection.classList.remove("active");
		maintenanceSection.style.display = "block";
		maintenanceSection.classList.add("active");
		window.scrollTo(0, 0);

		loadMaintenanceLog(vehicle.id);
	}

	function closeMaintenanceSection() {
		const maintenanceSection = document.getElementById("maintenanceSection");
		const vehiclesSection = document.getElementById("vehiclesSection");

		if (maintenanceSection) {
			maintenanceSection.style.display = "none";
			maintenanceSection.classList.remove("active");
		}
		if (vehiclesSection) {
			vehiclesSection.style.display = "block";
			vehiclesSection.classList.add("active");
		}
		window.scrollTo(0, 0);
		currentMaintenanceVehicleId = null;
		maintenanceEntries = [];
		editingMaintenanceId = null;
	}

	async function loadMaintenanceLog(vehicleId) {
		try {
			maintenanceEntries = await window.VehiclesDB.getMaintenanceLog(vehicleId);
			renderMaintenanceLog();
		} catch (err) {
			console.error("Ошибка загрузки журнала ТО:", err);
			maintenanceEntries = [];
			renderMaintenanceLog();
		}
	}

	function renderMaintenanceLog() {
		const tbody = document.getElementById("maintenanceTableBody");
		if (!tbody) return;

		tbody.innerHTML = "";

		if (maintenanceEntries.length === 0) {
			const row = document.createElement("tr");
			row.innerHTML = '<td colspan="7" style="text-align: center; color: var(--muted);">Записи ТО отсутствуют</td>';
			tbody.appendChild(row);
			return;
		}

		maintenanceEntries.forEach((entry) => {
			const row = document.createElement("tr");

			const date = entry.service_date
				? new Date(entry.service_date).toLocaleDateString('ru-RU')
				: '—';
			const mileage = entry.mileage ? entry.mileage.toLocaleString() : '—';
			const workTypes = entry.work_types || '—';
			const parts = entry.parts_replaced || '—';
			const cost = entry.total_cost
				? parseFloat(entry.total_cost).toLocaleString('ru-RU', { minimumFractionDigits: 2 })
				: '—';
			const notes = entry.notes || '—';

			row.innerHTML = `
				<td class="date-cell">${date}</td>
				<td class="mileage-cell">${mileage}</td>
				<td class="work-types-cell" title="${workTypes}">${workTypes}</td>
				<td class="parts-cell" title="${parts}">${parts}</td>
				<td class="cost-cell">${cost}</td>
				<td class="notes-cell" title="${notes}">${notes}</td>
				<td class="actions-cell">
					<button class="btn btn-outline btn-icon-only maintenance-edit" data-id="${entry.id}" title="Редактировать">
						<svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
							<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
						</svg>
					</button>
					<button class="btn btn-outline btn-icon-only maintenance-delete" data-id="${entry.id}" title="Удалить">
						<svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
						</svg>
					</button>
				</td>
			`;

			// Обработчик редактирования
			const editBtn = row.querySelector(".maintenance-edit");
			if (editBtn) {
				editBtn.addEventListener("click", () => editMaintenanceEntry(entry));
			}

			// Обработчик удаления
			const deleteBtn = row.querySelector(".maintenance-delete");
			if (deleteBtn) {
				deleteBtn.addEventListener("click", async () => {
					if (confirm("Удалить эту запись ТО?")) {
						try {
							await window.VehiclesDB.deleteMaintenanceEntry(entry.id);
							await loadMaintenanceLog(currentMaintenanceVehicleId);
						} catch (err) {
							alert("Ошибка удаления: " + err.message);
						}
					}
				});
			}

			tbody.appendChild(row);
		});
	}

	function editMaintenanceEntry(entry) {
		editingMaintenanceId = entry.id;

		document.getElementById("maintenanceMileage").value = entry.mileage || "";
		document.getElementById("maintenanceDate").value = entry.service_date || "";
		document.getElementById("maintenanceWorkTypes").value = entry.work_types || "";
		document.getElementById("maintenanceParts").value = entry.parts_replaced || "";
		document.getElementById("maintenanceCost").value = entry.total_cost || "";
		document.getElementById("maintenanceNotes").value = entry.notes || "";

		// Меняем кнопку на "Сохранить"
		const form = document.getElementById("maintenanceForm");
		const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
		if (submitBtn) submitBtn.textContent = "Сохранить изменения";

		// Прокручиваем к форме
		const formSection = document.querySelector(".maintenance-form-section");
		if (formSection) formSection.scrollIntoView({ behavior: "smooth" });
	}

	async function saveMaintenanceEntry(e) {
		e.preventDefault();

		if (!currentMaintenanceVehicleId) {
			alert("Ошибка: не выбран автомобиль");
			return;
		}

		const formData = new FormData(e.target);

		const entry = {
			vehicle_id: currentMaintenanceVehicleId,
			mileage: parseInt(formData.get("mileage")),
			service_date: formData.get("service_date"),
			work_types: formData.get("work_types")?.trim(),
			parts_replaced: formData.get("parts_replaced")?.trim() || null,
			total_cost: parseFloat(formData.get("total_cost")) || null,
			notes: formData.get("notes")?.trim() || null
		};

		if (!entry.mileage || isNaN(entry.mileage)) {
			alert("Укажите пробег при ТО");
			return;
		}
		if (!entry.service_date) {
			alert("Укажите дату ТО");
			return;
		}
		if (!entry.work_types) {
			alert("Укажите виды работ");
			return;
		}

		try {
			if (editingMaintenanceId) {
				await window.VehiclesDB.updateMaintenanceEntry(editingMaintenanceId, entry);
				editingMaintenanceId = null;
			} else {
				await window.VehiclesDB.addMaintenanceEntry(entry);
			}

			await loadMaintenanceLog(currentMaintenanceVehicleId);

			// Очищаем форму
			e.target.reset();
			const dateInput = document.getElementById("maintenanceDate");
			if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

			// Сбрасываем кнопку
			const submitBtn = e.target.querySelector('button[type="submit"]');
			if (submitBtn) submitBtn.textContent = "Добавить";
		} catch (err) {
			console.error("Ошибка сохранения ТО:", err);
			alert("Ошибка сохранения: " + err.message);
		}
	}

	// ============================================
	// СЕССИЯ (localStorage persistence)
	// ============================================

	const SESSION_KEY = 'dc_session';

	function saveSession(section) {
		try {
			const data = {
				role: currentRole,
				driverData: currentDriverData,
				section: section || null,
			};
			localStorage.setItem(SESSION_KEY, JSON.stringify(data));
		} catch (e) { /* ignore */ }
	}

	function clearSession() {
		try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
	}

	function loadSession() {
		try {
			const raw = localStorage.getItem(SESSION_KEY);
			if (!raw) return null;
			return JSON.parse(raw);
		} catch (e) { return null; }
	}

	async function restoreSession() {
		const session = loadSession();
		if (!session || !session.role) return false;

		if (session.role === 'driver' && session.driverData) {
			// Verify driver still exists in DB
			try {
				const allDrivers = await window.VehiclesDB.getAllDrivers();
				drivers = allDrivers;
				const found = allDrivers.find(function (d) { return d.id === session.driverData.id; });
				if (!found) { clearSession(); return false; }
				currentRole = 'driver';
				currentDriverData = found; // use fresh data from DB
			} catch (e) { clearSession(); return false; }
		} else if (session.role === 'logist') {
			currentRole = 'logist';
			currentDriverData = null;
			// Show distribution tab for logist
			const distTab = document.getElementById("distributionTab");
			if (distTab) distTab.style.display = "";
		} else {
			clearSession();
			return false;
		}

		// Navigate to saved section
		const section = session.section || 'vehicles';
		switchSection(section);
		return true;
	}

	// ============================================
	// СИСТЕМА РОЛЕЙ (Водитель / Логист)
	// ============================================

	async function loadDriversForRoleSelection() {
		try {
			drivers = await window.VehiclesDB.getAllDrivers();
		} catch (e) {
			console.error("Ошибка загрузки водителей для выбора роли:", e);
		}
		showRoleModal();
	}

	function showRoleModal() {
		const modal = document.getElementById("roleModal");
		if (!modal) return;

		// Сбрасываем на первый шаг
		document.getElementById("roleStep1").style.display = "block";
		document.getElementById("roleStep2Driver").style.display = "none";
		document.getElementById("roleStep2Logist").style.display = "none";

		modal.classList.add("is-open");
	}

	function closeRoleModal() {
		const modal = document.getElementById("roleModal");
		if (modal) modal.classList.remove("is-open");
	}

	function showDriverSelection() {
		document.getElementById("roleStep1").style.display = "none";
		const step = document.getElementById("roleStep2Driver");
		step.style.display = "block";

		const list = document.getElementById("driverSelectList");
		list.innerHTML = "";

		if (drivers.length === 0) {
			list.innerHTML = '<p style="text-align:center; color:var(--muted); padding:20px 0;">Нет зарегистрированных водителей</p>';
			return;
		}

		drivers.forEach(driver => {
			const btn = document.createElement("button");
			btn.className = "btn btn-outline driver-select-item";
			btn.type = "button";
			btn.textContent = driver.name;
			btn.addEventListener("click", () => loginAsDriver(driver));
			list.appendChild(btn);
		});
	}

	function showLogistPassword() {
		document.getElementById("roleStep1").style.display = "none";
		document.getElementById("roleStep2Logist").style.display = "block";
		document.getElementById("logistPassword").value = "";
		document.getElementById("logistPasswordError").style.display = "none";
		setTimeout(() => document.getElementById("logistPassword").focus(), 100);
	}

	function backToRoleStep1() {
		document.getElementById("roleStep2Driver").style.display = "none";
		document.getElementById("roleStep2Logist").style.display = "none";
		document.getElementById("roleStep1").style.display = "block";
	}

	function loginAsDriver(driver) {
		currentRole = "driver";
		currentDriverData = driver;
		closeRoleModal();
		saveSession("vehicles");
		switchSection("vehicles");
	}

	function loginAsLogist(e) {
		if (e) e.preventDefault();
		const password = document.getElementById("logistPassword").value;
		if (password !== "kosmo123") {
			document.getElementById("logistPasswordError").style.display = "block";
			document.getElementById("logistPassword").classList.add("shake");
			setTimeout(() => document.getElementById("logistPassword").classList.remove("shake"), 500);
			return;
		}
		currentRole = "logist";
		currentDriverData = null;
		closeRoleModal();
		// Показываем вкладку «Распределение» для логиста
		const distTab = document.getElementById("distributionTab");
		if (distTab) distTab.style.display = "";
		saveSession("vehicles");
		switchSection("vehicles");
	}

	function logoutFromVehicles() {
		currentRole = null;
		currentDriverData = null;
		driverEntryVehicle = null;
		clearSession();
		// Скрываем вкладку «Распределение» при выходе
		const distTab = document.getElementById("distributionTab");
		if (distTab) distTab.style.display = "none";
		// Переключаемся на раздел поставщиков
		switchSection("suppliers");
	}

	function updateUserBar() {
		const bar = document.getElementById("vehiclesUserBar");
		const info = document.getElementById("vehiclesUserInfo");
		const icon = document.getElementById("vehiclesUserIcon");

		if (!bar || !info) return;

		if (currentRole === "driver" && currentDriverData) {
			bar.style.display = "flex";
			icon.textContent = "🚗";
			info.textContent = `Водитель: ${currentDriverData.name}`;
		} else if (currentRole === "logist") {
			bar.style.display = "flex";
			icon.textContent = "📋";
			info.textContent = "Логист (полный доступ)";
		} else {
			bar.style.display = "none";
		}
	}

	// ============================================
	// УПРОЩЁННЫЙ ВВОД ДАННЫХ (для водителей)
	// ============================================

	async function openDriverEntry(vehicle) {
		driverEntryVehicle = vehicle;
		const modal = document.getElementById("driverEntryModal");
		const form = document.getElementById("driverEntryForm");
		const title = document.getElementById("driverEntryTitle");
		const infoDiv = document.getElementById("driverEntryInfo");

		if (!modal || !form) return;

		title.textContent = `Данные за смену`;

		// Показываем инфо об автомобиле
		const currentMileage = vehicle.mileage ? vehicle.mileage.toLocaleString() : "0";
		infoDiv.innerHTML = `
			<div><strong>${vehicle.plate_number}</strong></div>
			<div>Текущий пробег: ${currentMileage} км</div>
		`;

		form.reset();

		// Устанавливаем дату по умолчанию — сегодня
		const dateInput = document.getElementById("driverEntryDate");
		if (dateInput) {
			dateInput.value = new Date().toISOString().split('T')[0];
		}

		// Проверяем, нужен ли начальный уровень топлива (первая запись)
		try {
			const entries = await window.VehiclesDB.getMileageLog(vehicle.id);
			const fuelGroup = document.getElementById("driverEntryFuelLevelGroup");
			const fuelInput = document.getElementById("driverEntryFuelLevel");

			if (entries.length === 0) {
				fuelGroup.style.display = "block";
				fuelInput.required = true;
			} else {
				fuelGroup.style.display = "none";
				fuelInput.required = false;
			}
		} catch (e) {
			console.error("Ошибка проверки записей:", e);
		}

		modal.classList.add("is-open");
		setTimeout(() => document.getElementById("driverEntryMileage").focus(), 150);
	}

	function closeDriverEntry() {
		const modal = document.getElementById("driverEntryModal");
		if (modal) modal.classList.remove("is-open");
		driverEntryVehicle = null;
	}

	async function saveDriverEntry(e) {
		e.preventDefault();
		if (!driverEntryVehicle || !currentDriverData) return;

		const mileageInput = document.getElementById("driverEntryMileage");
		const fuelInput = document.getElementById("driverEntryFuel");
		const fuelLevelInput = document.getElementById("driverEntryFuelLevel");

		const mileageReturn = parseInt(mileageInput.value);
		const fuelRefill = parseFloat(fuelInput.value) || null;

		if (!mileageReturn || isNaN(mileageReturn)) {
			alert("Укажите показания одометра");
			return;
		}

		const dateInput = document.getElementById("driverEntryDate");
		const logDate = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];

		if (!logDate) {
			alert("Укажите дату");
			return;
		}

		try {
			// Проверяем существующие записи
			const existingEntries = await window.VehiclesDB.getMileageLog(driverEntryVehicle.id);
			const hasEntries = existingEntries.length > 0;

			// Определяем fuel_level_out
			let fuelLevelOut = null;
			if (!hasEntries) {
				fuelLevelOut = parseFloat(fuelLevelInput.value) || null;
				if (!fuelLevelOut || fuelLevelOut <= 0) {
					alert("Укажите начальный уровень топлива при выезде");
					return;
				}
			} else {
				const sorted = [...existingEntries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
				const lastEntry = sorted[sorted.length - 1];
				fuelLevelOut = lastEntry.fuel_level_return !== null && lastEntry.fuel_level_return !== undefined
					? parseFloat(lastEntry.fuel_level_return)
					: null;
			}

			// Определяем mileage_out
			let mileageOut = 0;
			if (!hasEntries) {
				mileageOut = driverEntryVehicle.mileage || 0;
			} else {
				const sorted = [...existingEntries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
				const lastEntry = sorted[sorted.length - 1];
				mileageOut = lastEntry.mileage || 0;
			}

			// Проверяем корректность пробега
			if (mileageReturn <= mileageOut) {
				alert(`Показания одометра (${mileageReturn}) должны быть больше предыдущего значения (${mileageOut})`);
				return;
			}

			const shiftMileage = mileageReturn - mileageOut;

			// Формируем запись
			const entry = {
				vehicle_id: driverEntryVehicle.id,
				driver_id: currentDriverData.id,
				mileage: mileageReturn,
				log_date: logDate,
				fuel_level_out: fuelLevelOut,
				fuel_refill: fuelRefill,
				mileage_out: mileageOut,
				notes: null
			};

			// Рассчитываем остаток топлива при возвращении
			if (fuelLevelOut !== null && shiftMileage > 0) {
				const fuelConsumption = driverEntryVehicle.fuel_consumption || 0;
				if (fuelConsumption > 0) {
					const expectedConsumption = (shiftMileage * fuelConsumption / 100);
					entry.fuel_level_return = fuelLevelOut - expectedConsumption + (fuelRefill || 0);
					entry.actual_fuel_consumption = fuelLevelOut - entry.fuel_level_return + (fuelRefill || 0);
				} else {
					entry.fuel_level_return = fuelLevelOut + (fuelRefill || 0);
					entry.actual_fuel_consumption = 0;
				}
			} else if (fuelLevelOut !== null) {
				entry.fuel_level_return = fuelLevelOut + (fuelRefill || 0);
				entry.actual_fuel_consumption = 0;
			}

			await window.VehiclesDB.addMileageLog(entry);

			// Обновляем данные автомобилей
			vehicles = await window.VehiclesDB.getAllVehicles();
			const updated = vehicles.find(v => v.id === driverEntryVehicle.id);
			if (updated) driverEntryVehicle = updated;

			renderVehicles();
			closeDriverEntry();

			// Показываем подтверждение
			const msg = `Сохранено!\nПробег за смену: ${shiftMileage} км` +
				(fuelRefill ? `\nЗаправка: ${fuelRefill} л` : '');
			alert(msg);
		} catch (err) {
			console.error("Ошибка сохранения:", err);
			alert("Ошибка сохранения: " + err.message);
		}
	}

	// Инициализация
	function init() {
		initNavigation();

		if (addDriverBtn) {
			addDriverBtn.addEventListener("click", () => openDriverModal());
		}

		if (addVehicleBtn) {
			addVehicleBtn.addEventListener("click", () => openVehicleModal());
		}

		const driverForm = document.getElementById("driverForm");
		if (driverForm) {
			driverForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const formData = new FormData(e.target);
				await saveDriver(formData);
			});
		}

		const cancelDriverBtn = document.getElementById("cancelDriverBtn");
		if (cancelDriverBtn) {
			cancelDriverBtn.addEventListener("click", closeDriverModal);
		}

		const deleteDriverBtn = document.getElementById("deleteDriverBtn");
		if (deleteDriverBtn) {
			deleteDriverBtn.addEventListener("click", deleteDriver);
		}

		const vehicleForm = document.getElementById("vehicleForm");
		if (vehicleForm) {
			vehicleForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const formData = new FormData(e.target);
				await saveVehicle(formData);
			});
		}

		const cancelVehicleBtn = document.getElementById("cancelVehicleBtn");
		if (cancelVehicleBtn) {
			cancelVehicleBtn.addEventListener("click", closeVehicleModal);
		}

		const deleteVehicleBtn = document.getElementById("deleteVehicleBtn");
		if (deleteVehicleBtn) {
			deleteVehicleBtn.addEventListener("click", deleteVehicle);
		}

		// Закрытие модальных окон по клику вне их
		const driverModal = document.getElementById("driverModal");
		if (driverModal) {
			driverModal.addEventListener("click", (e) => {
				if (e.target === driverModal) {
					closeDriverModal();
				}
			});
		}

		const vehicleModal = document.getElementById("vehicleModal");
		if (vehicleModal) {
			vehicleModal.addEventListener("click", (e) => {
				if (e.target === vehicleModal) {
					closeVehicleModal();
				}
			});
		}

		const historyForm = document.getElementById("historyForm");
		if (historyForm) {
			historyForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const formData = new FormData(e.target);
				await saveHistoryEntry(formData);
			});
		}

		const backToVehiclesBtn = document.getElementById("backToVehiclesBtn");
		if (backToVehiclesBtn) {
			backToVehiclesBtn.addEventListener("click", closeHistoryTable);
		}

		// Заполняем список водителей в форме истории при открытии
		const historyDriverSelect = document.getElementById("historyDriver");
		if (historyDriverSelect) {
			// Будет заполняться при открытии модального окна
		}

		// Лог пробега
		const mileageForm = document.getElementById("mileageForm");
		if (mileageForm) {
			mileageForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const formData = new FormData(e.target);
				await saveMileageEntry(formData);
			});
		}

		const backToVehiclesFromMileageBtn = document.getElementById("backToVehiclesFromMileageBtn");
		if (backToVehiclesFromMileageBtn) {
			backToVehiclesFromMileageBtn.addEventListener("click", closeMileageTable);
		}

		const mileageFilterBtn = document.getElementById("mileageFilterBtn");
		if (mileageFilterBtn) {
			mileageFilterBtn.addEventListener("click", () => {
				if (currentMileageVehicleId) {
					loadMileageLog(currentMileageVehicleId);
				}
			});
		}

		const printMileageBtn = document.getElementById("printMileageBtn");
		if (printMileageBtn) {
			printMileageBtn.addEventListener("click", printMileageTable);
		}

		// ---- Обработчики для журнала ТО ----

		const maintenanceForm = document.getElementById("maintenanceForm");
		if (maintenanceForm) {
			maintenanceForm.addEventListener("submit", saveMaintenanceEntry);
		}

		const backToVehiclesFromMaintenanceBtn = document.getElementById("backToVehiclesFromMaintenanceBtn");
		if (backToVehiclesFromMaintenanceBtn) {
			backToVehiclesFromMaintenanceBtn.addEventListener("click", closeMaintenanceSection);
		}

		// ---- Обработчики для системы ролей ----

		const roleDriverBtn = document.getElementById("roleDriverBtn");
		if (roleDriverBtn) {
			roleDriverBtn.addEventListener("click", showDriverSelection);
		}

		const roleLogistBtn = document.getElementById("roleLogistBtn");
		if (roleLogistBtn) {
			roleLogistBtn.addEventListener("click", showLogistPassword);
		}

		const backToRolesBtn = document.getElementById("backToRolesBtn");
		if (backToRolesBtn) {
			backToRolesBtn.addEventListener("click", backToRoleStep1);
		}

		const backToRolesFromLogistBtn = document.getElementById("backToRolesFromLogistBtn");
		if (backToRolesFromLogistBtn) {
			backToRolesFromLogistBtn.addEventListener("click", backToRoleStep1);
		}

		const logistForm = document.getElementById("logistForm");
		if (logistForm) {
			logistForm.addEventListener("submit", loginAsLogist);
		}

		const vehiclesLogoutBtn = document.getElementById("vehiclesLogoutBtn");
		if (vehiclesLogoutBtn) {
			vehiclesLogoutBtn.addEventListener("click", logoutFromVehicles);
		}

		// Закрытие модального окна роли по клику вне
		const roleModal = document.getElementById("roleModal");
		if (roleModal) {
			roleModal.addEventListener("click", (e) => {
				if (e.target === roleModal) {
					closeRoleModal();
				}
			});
		}

		// ---- Обработчики для упрощённого ввода данных (водитель) ----

		const driverEntryForm = document.getElementById("driverEntryForm");
		if (driverEntryForm) {
			driverEntryForm.addEventListener("submit", saveDriverEntry);
		}

		const cancelDriverEntryBtn = document.getElementById("cancelDriverEntryBtn");
		if (cancelDriverEntryBtn) {
			cancelDriverEntryBtn.addEventListener("click", closeDriverEntry);
		}

		const driverEntryModal = document.getElementById("driverEntryModal");
		if (driverEntryModal) {
			driverEntryModal.addEventListener("click", (e) => {
				if (e.target === driverEntryModal) {
					closeDriverEntry();
				}
			});
		}

		// Восстановление сессии при загрузке страницы
		restoreSession();
	}

	// ============================================
	// ЛОГ ПРОБЕГА
	// ============================================

	let currentMileageVehicleId = null;
	let mileageLogEntries = [];
	let currentVehicle = null;
	let previousVehicleMileage = null; // Сохраняем предыдущий пробег перед добавлением записи

	function openMileageModal(vehicle) {
		console.log("openMileageModal вызвана, vehicle:", vehicle);
		// Находим актуальные данные автомобиля из массива vehicles
		const actualVehicle = vehicles.find(v => v.id === vehicle.id) || vehicle;
		currentVehicle = actualVehicle;
		console.log("currentVehicle установлен:", currentVehicle);
		openMileageTable(actualVehicle);
	}

	async function openMileageTable(vehicle) {
		console.log("openMileageTable вызвана, vehicle:", vehicle);
		const mileageSection = document.getElementById("mileageSection");
		const vehiclesSection = document.getElementById("vehiclesSection");
		const title = document.getElementById("mileageSectionTitle");
		const driverSelect = document.getElementById("mileageDriver");
		
		if (!mileageSection) {
			console.error("mileageSection не найдена!");
			alert("Ошибка: секция лога пробега не найдена. Проверьте консоль браузера.");
			return;
		}
		
		if (!vehiclesSection) {
			console.error("vehiclesSection не найдена!");
			alert("Ошибка: секция автомобилей не найдена. Проверьте консоль браузера.");
			return;
		}

		currentMileageVehicleId = vehicle.id;
		if (title) {
			title.textContent = `Лог пробега: ${vehicle.plate_number}`;
		}

		// Заполняем список водителей
		if (driverSelect) {
			driverSelect.innerHTML = '<option value="">Выберите водителя</option>';
			drivers.forEach(driver => {
				const option = document.createElement("option");
				option.value = driver.id;
				option.textContent = driver.name;
				driverSelect.appendChild(option);
			});
		}

		// Устанавливаем текущую дату по умолчанию
		const mileageDate = document.getElementById("mileageDate");
		if (mileageDate) {
			const today = new Date().toISOString().split('T')[0];
			mileageDate.value = today;
		}

		// Сбрасываем фильтр месяца — при открытии показываем ВСЕ записи
		const monthFilter = document.getElementById("mileageMonthFilter");
		if (monthFilter) {
			monthFilter.value = "";
		}

		// Очищаем форму
		const mileageForm = document.getElementById("mileageForm");
		if (mileageForm) {
			mileageForm.reset();
			if (mileageDate) {
				const today = new Date().toISOString().split('T')[0];
				mileageDate.value = today;
			}
		}

		// Переключаем секции
		vehiclesSection.style.display = "none";
		vehiclesSection.classList.remove("active");
		mileageSection.style.display = "block";
		mileageSection.classList.add("active");

		// Прокручиваем наверх (важно для мобильных)
		window.scrollTo(0, 0);

		// Для водителя: скрываем форму, показываем только таблицу
		const mileageContent = mileageSection.querySelector('.mileage-content');
		if (mileageContent) {
			if (currentRole === "driver") {
				mileageContent.classList.add("driver-view");
			} else {
				mileageContent.classList.remove("driver-view");
			}
		}
		
		// Загружаем записи и проверяем, нужно ли показывать поле начального уровня топлива
		await loadMileageLog(vehicle.id);
		await checkAndShowFuelLevelField();
	}

	function closeMileageTable() {
		const mileageSection = document.getElementById("mileageSection");
		const vehiclesSection = document.getElementById("vehiclesSection");
		
		if (mileageSection) {
			mileageSection.style.display = "none";
			mileageSection.classList.remove("active");
		}
		if (vehiclesSection) {
			vehiclesSection.style.display = "block";
			vehiclesSection.classList.add("active");
		}
		window.scrollTo(0, 0);
		currentMileageVehicleId = null;
		mileageLogEntries = [];
		currentVehicle = null;
		previousVehicleMileage = null;
	}

	async function loadMileageLog(vehicleId) {
		try {
			const monthFilter = document.getElementById("mileageMonthFilter");
			let startDate = null;
			let endDate = null;

			if (monthFilter && monthFilter.value) {
				const [year, month] = monthFilter.value.split('-');
				startDate = `${year}-${month}-01`;
				const lastDay = new Date(year, month, 0).getDate();
				endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
			}

			mileageLogEntries = await window.VehiclesDB.getMileageLog(vehicleId, startDate, endDate);
			// Сортируем по дате (от старых к новым) для правильного расчета пробега за смену
			mileageLogEntries.sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
			renderMileageLog();
		} catch (err) {
			console.error("Ошибка загрузки лога пробега:", err);
			mileageLogEntries = [];
			renderMileageLog();
		}
	}

	function renderMileageLog() {
		const mileageTableBody = document.getElementById("mileageTableBody");
		if (!mileageTableBody) return;

		mileageTableBody.innerHTML = "";

			if (mileageLogEntries.length === 0) {
			const row = document.createElement("tr");
			row.innerHTML = '<td colspan="11" style="text-align: center; color: var(--muted);">Записи отсутствуют</td>';
			mileageTableBody.appendChild(row);
			return;
		}

		// Обновляем colspan для пустой таблицы
		const emptyRow = mileageTableBody.querySelector('tr');
		if (emptyRow && emptyRow.innerHTML.includes('colspan')) {
			emptyRow.innerHTML = '<td colspan="11" style="text-align: center; color: var(--muted);">Записи отсутствуют</td>';
		}

		// Получаем текущий пробег из карточки автомобиля (для расчета первой записи)
		const vehicleMileage = currentVehicle ? (currentVehicle.mileage || 0) : 0;

		// Сортируем записи по дате (от старых к новым) для правильного расчета
		const sortedEntries = [...mileageLogEntries].sort((a, b) => {
			const dateA = new Date(a.log_date);
			const dateB = new Date(b.log_date);
			return dateA - dateB;
		});

		// Определяем previousVehicleMileage для первой записи
		// Используем сохраненное значение mileage_out из БД, если оно есть
		if (previousVehicleMileage === null && sortedEntries.length > 0) {
			const firstEntry = sortedEntries[0];
			if (firstEntry.mileage_out !== null && firstEntry.mileage_out !== undefined) {
				// Используем сохраненное значение из БД
				previousVehicleMileage = parseInt(firstEntry.mileage_out);
			} else {
				// Если mileage_out не сохранен в БД, вычисляем на основе текущего пробега
				// и суммы всех пробегов за смены
				let totalShiftMileage = 0;
				for (let i = 1; i < sortedEntries.length; i++) {
					const prevMileage = sortedEntries[i - 1].mileage || 0;
					const currentMileage = sortedEntries[i].mileage || 0;
					totalShiftMileage += (currentMileage - prevMileage);
				}
				// previousVehicleMileage = текущий пробег - сумма всех пробегов за смены - пробег первой записи
				// Но это неточно, так как текущий пробег уже обновлен
				// Лучше просто использовать 0 или вычислять: текущий пробег - пробег первой записи
				if (sortedEntries.length === 1) {
					// Для одной записи: пробег за смену = текущий пробег - previousVehicleMileage
					// Но мы не знаем previousVehicleMileage, поэтому используем 0
					previousVehicleMileage = 0;
				} else {
					// Для нескольких записей: вычисляем на основе текущего пробега
					previousVehicleMileage = vehicleMileage - totalShiftMileage - (firstEntry.mileage || 0);
					if (previousVehicleMileage < 0) {
						previousVehicleMileage = 0;
					}
				}
			}
		}

		// Теперь создаем строки таблицы с расчетом всех полей
		sortedEntries.forEach((entry, index) => {
			const row = document.createElement("tr");

			// 1. Номер смены (фактическое число управления ТС)
			// Используем порядковый номер записи в отсортированном списке
			const shiftNumber = index + 1;

			// 2. Километраж при выезде
			let mileageOut = 0;
			// Используем сохраненное значение из БД, если есть
			if (entry.mileage_out !== null && entry.mileage_out !== undefined) {
				mileageOut = parseInt(entry.mileage_out);
			} else if (index === 0) {
				// Для первой записи: если нет в БД, используем previousVehicleMileage
				if (previousVehicleMileage !== null) {
					mileageOut = previousVehicleMileage;
				} else {
					mileageOut = 0;
				}
			} else {
				// Для последующих записей: километраж при возвращении предыдущей записи
				mileageOut = sortedEntries[index - 1].mileage || 0;
			}

			// 3. Километраж при возвращении (то, что вводит водитель)
			const mileageReturn = entry.mileage || 0;

			// 4. Пробег за сегодня (автоматически)
			const shiftMileage = mileageReturn - mileageOut;

			// 5. Остаток топлива при выезде
			let fuelLevelOut = null;
			if (index === 0) {
				// Для первой записи: используем введенное значение (fuel_level_out или старое поле fuel_level)
				fuelLevelOut = entry.fuel_level_out ? parseFloat(entry.fuel_level_out) : 
				              (entry.fuel_level ? parseFloat(entry.fuel_level) : null);
			} else {
				// Для последующих записей: остаток при возвращении предыдущей записи из БД
				const prevEntry = sortedEntries[index - 1];
				if (prevEntry.fuel_level_return !== null && prevEntry.fuel_level_return !== undefined) {
					fuelLevelOut = parseFloat(prevEntry.fuel_level_return);
				} else {
					// Если в БД нет значения, используем вычисленное (для обратной совместимости)
					fuelLevelOut = prevEntry.calculated_fuel_level_return || null;
				}
			}

			// 6. Заправка литров (вводит водитель)
			const fuelRefill = entry.fuel_refill ? parseFloat(entry.fuel_refill) : 0;

			// 7. Остаток топлива при возвращении (автоматически)
			// Сначала проверяем, есть ли сохраненное значение в БД - оно имеет приоритет
			let fuelLevelReturn = null;
			if (entry.fuel_level_return !== null && entry.fuel_level_return !== undefined) {
				// Если есть сохраненное значение в БД, используем его (это может быть исправленное вручную значение)
				fuelLevelReturn = parseFloat(entry.fuel_level_return);
			} else if (fuelLevelOut !== null && shiftMileage > 0) {
				// Если нет сохраненного значения, рассчитываем по нормативному расходу
				const fuelConsumption = currentVehicle ? (currentVehicle.fuel_consumption || 0) : 0;
				if (fuelConsumption > 0) {
					// Рассчитываем ожидаемый расход по нормативу
					const expectedConsumption = (shiftMileage * fuelConsumption / 100);
					// Остаток при возвращении = остаток при выезде - нормативный расход + заправка
					fuelLevelReturn = fuelLevelOut - expectedConsumption + fuelRefill;
				} else {
					// Если нет нормативного расхода, остаток при возвращении = остаток при выезде + заправка
					fuelLevelReturn = fuelLevelOut + fuelRefill;
				}
			}

			// 8. Фактический расход топлива за смену (автоматически)
			// Фактический расход = остаток при выезде - остаток при возвращении + заправка
			let actualFuelConsumption = null;
			if (fuelLevelOut !== null && fuelLevelReturn !== null) {
				actualFuelConsumption = fuelLevelOut - fuelLevelReturn + fuelRefill;
			} else if (entry.actual_fuel_consumption !== null && entry.actual_fuel_consumption !== undefined) {
				// Если есть сохраненное значение в БД, используем его
				actualFuelConsumption = parseFloat(entry.actual_fuel_consumption);
			}

			// Сохраняем рассчитанные значения для использования в следующей итерации
			entry.calculated_mileage_out = mileageOut;
			entry.calculated_fuel_level_out = fuelLevelOut;
			entry.calculated_fuel_level_return = fuelLevelReturn;
			entry.calculated_actual_fuel_consumption = actualFuelConsumption;

			// Форматируем значения для отображения
			const shiftNumberDisplay = shiftNumber;
			const date = entry.log_date ? new Date(entry.log_date).toLocaleDateString('ru-RU') : '—';
			const mileageOutDisplay = mileageOut > 0 ? mileageOut.toLocaleString() : '—';
			const mileageReturnDisplay = mileageReturn.toLocaleString();
			const shiftMileageDisplay = shiftMileage > 0 ? shiftMileage.toLocaleString() : '—';
			const fuelLevelOutDisplay = fuelLevelOut !== null ? fuelLevelOut.toFixed(2) : '—';
			const fuelLevelReturnDisplay = fuelLevelReturn !== null ? fuelLevelReturn.toFixed(2) : '—';
			const fuelRefillDisplay = fuelRefill > 0 ? fuelRefill.toFixed(2) : '—';
			const actualFuelConsumptionDisplay = actualFuelConsumption !== null ? actualFuelConsumption.toFixed(2) : '—';

			// Создаем редактируемое поле для остатка топлива при возвращении
			const fuelLevelReturnInput = document.createElement("input");
			fuelLevelReturnInput.type = "number";
			fuelLevelReturnInput.className = "fuel-level-return-input";
			fuelLevelReturnInput.step = "0.1";
			fuelLevelReturnInput.min = "0";
			fuelLevelReturnInput.value = fuelLevelReturn !== null ? fuelLevelReturn.toFixed(2) : "";
			fuelLevelReturnInput.style.width = "80px";
			fuelLevelReturnInput.style.padding = "4px 6px";
			fuelLevelReturnInput.style.border = "1px solid var(--border)";
			fuelLevelReturnInput.style.borderRadius = "4px";
			fuelLevelReturnInput.style.fontSize = "14px";
			fuelLevelReturnInput.style.textAlign = "right";
			fuelLevelReturnInput.title = "Нажмите для редактирования остатка топлива при возвращении. Изменение автоматически пересчитает фактический расход.";
			
			// Сохраняем исходное значение для отмены изменений
			const originalValue = fuelLevelReturn !== null ? fuelLevelReturn : null;
			
			// Обработчик изменения значения
			fuelLevelReturnInput.addEventListener("blur", async () => {
				let inputValue = fuelLevelReturnInput.value.trim();
				if (inputValue === "") {
					// Если поле пустое, восстанавливаем старое значение
					fuelLevelReturnInput.value = originalValue !== null ? originalValue.toFixed(2) : "";
					return;
				}
				
				// Заменяем запятую на точку для корректного парсинга
				inputValue = inputValue.replace(',', '.');
				
				const newValue = parseFloat(inputValue);
				if (isNaN(newValue) || newValue < 0) {
					// Восстанавливаем старое значение при неверном вводе
					fuelLevelReturnInput.value = originalValue !== null ? originalValue.toFixed(2) : "";
					alert("Введите корректное значение (число >= 0)");
					return;
				}
				
				// Если значение не изменилось, ничего не делаем
				if (originalValue !== null && Math.abs(newValue - originalValue) < 0.01) {
					return;
				}
				
				// Пересчитываем фактический расход
				const newActualConsumption = fuelLevelOut !== null 
					? fuelLevelOut - newValue + fuelRefill 
					: null;
				
				// Обновляем запись в БД
				try {
					// Показываем индикацию сохранения
					fuelLevelReturnInput.style.backgroundColor = "#2a3a2a";
					fuelLevelReturnInput.disabled = true;
					
					const updateData = {
						fuel_level_return: newValue,
						actual_fuel_consumption: newActualConsumption
					};
					
					console.log("Обновление записи:", entry.id, updateData);
					const updatedEntry = await window.VehiclesDB.updateMileageLog(entry.id, updateData);
					
					console.log("Запись обновлена:", updatedEntry);
					
					// Проверяем, что значение действительно обновлено
					if (updatedEntry && updatedEntry.fuel_level_return !== null && updatedEntry.fuel_level_return !== undefined) {
						const savedValue = parseFloat(updatedEntry.fuel_level_return);
						if (Math.abs(savedValue - newValue) > 0.01) {
							console.warn("Значение не совпадает! Ожидалось:", newValue, "Получено:", savedValue);
						} else {
							console.log("Значение успешно сохранено:", savedValue);
						}
					}
					
					// Перезагружаем таблицу для обновления всех зависимых записей
					await loadMileageLog(currentMileageVehicleId);
					
					// Восстанавливаем нормальный вид поля
					fuelLevelReturnInput.style.backgroundColor = "";
					fuelLevelReturnInput.disabled = false;
				} catch (err) {
					console.error("Ошибка обновления остатка топлива:", err);
					alert("Ошибка обновления: " + err.message);
					// Восстанавливаем старое значение
					fuelLevelReturnInput.value = originalValue !== null ? originalValue.toFixed(2) : "";
					fuelLevelReturnInput.style.backgroundColor = "";
					fuelLevelReturnInput.disabled = false;
				}
			});
			
			// Обработчик Enter для сохранения
			fuelLevelReturnInput.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					fuelLevelReturnInput.blur();
				} else if (e.key === "Escape") {
					// Отменяем изменения при Escape
					fuelLevelReturnInput.value = originalValue !== null ? originalValue.toFixed(2) : "";
					fuelLevelReturnInput.blur();
				}
			});
			
			// Обработчик ввода для замены запятой на точку в реальном времени
			fuelLevelReturnInput.addEventListener("input", (e) => {
				let value = e.target.value;
				// Заменяем запятую на точку
				if (value.includes(',')) {
					value = value.replace(',', '.');
					e.target.value = value;
				}
			});

			const fuelLevelReturnCell = document.createElement("td");
			fuelLevelReturnCell.className = "fuel-level-return-cell";
			fuelLevelReturnCell.appendChild(fuelLevelReturnInput);

			// Создаём редактируемую ячейку даты
			const dateCell = document.createElement("td");
			dateCell.className = "date-cell date-editable";
			dateCell.textContent = date;
			dateCell.title = "Нажмите для изменения даты";
			dateCell.addEventListener("click", () => {
				// Заменяем текст на input[type=date]
				if (dateCell.querySelector("input")) return; // уже открыт
				const dateInput = document.createElement("input");
				dateInput.type = "date";
				dateInput.className = "date-edit-input";
				dateInput.value = entry.log_date || "";
				dateCell.textContent = "";
				dateCell.appendChild(dateInput);
				dateInput.focus();

				const finishEdit = async () => {
					const newDate = dateInput.value;
					if (!newDate || newDate === entry.log_date) {
						// Не изменилось — вернуть текст
						dateCell.textContent = date;
						return;
					}
					try {
						dateInput.disabled = true;
						await window.VehiclesDB.updateMileageLog(entry.id, { log_date: newDate });
						await loadMileageLog(currentMileageVehicleId);
					} catch (err) {
						console.error("Ошибка обновления даты:", err);
						alert("Ошибка обновления даты: " + err.message);
						dateCell.textContent = date;
					}
				};

				dateInput.addEventListener("blur", finishEdit);
				dateInput.addEventListener("keydown", (e) => {
					if (e.key === "Enter") dateInput.blur();
					if (e.key === "Escape") {
						dateCell.textContent = date;
					}
				});
			});

			// Фамилия водителя за эту смену
			const driverObj = entry.driver || entry.drivers || null;
			let driverDisplay = '—';
			if (driverObj && driverObj.name) {
				// Берём фамилию (первое слово)
				const parts = driverObj.name.trim().split(/\s+/);
				driverDisplay = parts[0] || driverObj.name;
			}

			row.innerHTML = `
				<td class="shift-number-cell">${shiftNumberDisplay}</td>
				<td class="driver-cell">${driverDisplay}</td>
				<td class="mileage-out-cell">${mileageOutDisplay}</td>
				<td class="mileage-return-cell">${mileageReturnDisplay}</td>
				<td class="shift-mileage-cell">${shiftMileageDisplay}</td>
				<td class="fuel-level-out-cell">${fuelLevelOutDisplay}</td>
				<td class="fuel-refill-cell">${fuelRefillDisplay}</td>
				<td class="actual-fuel-consumption-cell">${actualFuelConsumptionDisplay}</td>
				<td class="actions-cell">
					<button class="btn btn-outline btn-icon-only mileage-delete" data-id="${entry.id}" title="Удалить">
						<svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
						</svg>
					</button>
				</td>
			`;

			// Вставляем ячейку даты после первого td (номер смены)
			const firstCell = row.querySelector(".shift-number-cell");
			if (firstCell) {
				firstCell.after(dateCell);
			}

			// Вставляем ячейку с редактируемым полем перед ячейкой с заправкой
			const fuelRefillCell = row.querySelector(".fuel-refill-cell");
			row.insertBefore(fuelLevelReturnCell, fuelRefillCell);

			const deleteBtn = row.querySelector(".mileage-delete");
			if (deleteBtn) {
				deleteBtn.addEventListener("click", async () => {
					if (confirm("Удалить эту запись из лога?")) {
						try {
							await window.VehiclesDB.deleteMileageLog(entry.id);
							await loadMileageLog(currentMileageVehicleId);
							await loadVehicles(); // Обновляем список автомобилей для обновления пробега
						} catch (err) {
							alert("Ошибка удаления: " + err.message);
						}
					}
				});
			}

			mileageTableBody.appendChild(row);
		});
	}

	async function saveMileageEntry(formData) {
		try {
			if (!currentMileageVehicleId) {
				alert("Ошибка: не выбран автомобиль");
				return false;
			}

			// Проверяем, есть ли уже записи для этого автомобиля
			const existingEntries = await window.VehiclesDB.getMileageLog(currentMileageVehicleId);
			const hasEntries = existingEntries.length > 0;

			// Получаем значения из формы
			const mileageReturn = parseInt(formData.get("mileage"));
			const fuelRefill = parseFloat(formData.get("fuel_refill")) || null;
			
			// Определяем fuel_level_out
			let fuelLevelOut = null;
			if (!hasEntries) {
				// Для первой записи получаем начальный уровень топлива при выезде
				fuelLevelOut = parseFloat(formData.get("fuel_level_out")) || null;
			} else {
				// Для последующих записей: fuel_level_out = предыдущий fuel_level_return
				const sortedExisting = [...existingEntries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
				const lastEntry = sortedExisting[sortedExisting.length - 1];
				fuelLevelOut = lastEntry.fuel_level_return !== null && lastEntry.fuel_level_return !== undefined 
					? parseFloat(lastEntry.fuel_level_return) 
					: null;
			}

			const entry = {
				vehicle_id: currentMileageVehicleId,
				driver_id: parseInt(formData.get("driver_id")),
				mileage: mileageReturn, // Километраж при возвращении
				log_date: formData.get("log_date"),
				fuel_level_out: fuelLevelOut, // Для первой записи - из формы, для последующих - из предыдущей записи
				fuel_refill: fuelRefill,
				notes: formData.get("notes")?.trim() || null
			};

			if (!entry.driver_id || isNaN(entry.driver_id)) {
				alert("Выберите водителя");
				return false;
			}

			if (!entry.mileage || isNaN(entry.mileage)) {
				alert("Укажите пробег");
				return false;
			}

			if (!entry.log_date) {
				alert("Укажите дату");
				return false;
			}

			// Если это первая запись, fuel_level_out обязателен
			if (!hasEntries && (!entry.fuel_level_out || entry.fuel_level_out <= 0)) {
				alert("Для первой записи необходимо указать начальный уровень топлива при выезде");
				return false;
			}

			// Сохраняем текущий пробег перед добавлением записи
			const currentMileage = currentVehicle ? (currentVehicle.mileage || 0) : 0;
			if (previousVehicleMileage === null) {
				previousVehicleMileage = currentMileage;
			}

			// Определяем mileage_out для сохранения в БД
			let mileageOut = 0;
			if (!hasEntries) {
				// Для первой записи
				entry.mileage_out = previousVehicleMileage;
				mileageOut = previousVehicleMileage;
			} else {
				// Для последующих записей: mileage_out = предыдущий mileage (километраж при возвращении)
				// Сортируем существующие записи по дате
				const sortedExisting = [...existingEntries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
				const lastEntry = sortedExisting[sortedExisting.length - 1];
				mileageOut = lastEntry.mileage || 0;
				entry.mileage_out = mileageOut;
			}

			// Рассчитываем пробег за смену
			const shiftMileage = mileageReturn - mileageOut;
			
			// Рассчитываем остаток при возвращении и фактический расход
			if (fuelLevelOut !== null && shiftMileage > 0) {
				const fuelConsumption = currentVehicle ? (currentVehicle.fuel_consumption || 0) : 0;
				if (fuelConsumption > 0) {
					const expectedConsumption = (shiftMileage * fuelConsumption / 100);
					entry.fuel_level_return = fuelLevelOut - expectedConsumption + (fuelRefill || 0);
					entry.actual_fuel_consumption = fuelLevelOut - entry.fuel_level_return + (fuelRefill || 0);
				} else {
					entry.fuel_level_return = fuelLevelOut + (fuelRefill || 0);
					entry.actual_fuel_consumption = fuelLevelOut - entry.fuel_level_return + (fuelRefill || 0);
				}
			} else if (fuelLevelOut !== null) {
				// Если пробег = 0, остаток при возвращении = остаток при выезде + заправка
				entry.fuel_level_return = fuelLevelOut + (fuelRefill || 0);
				entry.actual_fuel_consumption = fuelLevelOut - entry.fuel_level_return + (fuelRefill || 0);
			}
			
			await window.VehiclesDB.addMileageLog(entry);
			await loadVehicles(); // Обновляем список автомобилей для обновления пробега
			// Обновляем currentVehicle после загрузки
			vehicles = await window.VehiclesDB.getAllVehicles();
			const updatedVehicle = vehicles.find(v => v.id === currentMileageVehicleId);
			if (updatedVehicle) {
				currentVehicle = updatedVehicle;
			}
			await loadMileageLog(currentMileageVehicleId);
			
			// Очищаем форму
			document.getElementById("mileageForm").reset();
			const mileageDate = document.getElementById("mileageDate");
			if (mileageDate) {
				const today = new Date().toISOString().split('T')[0];
				mileageDate.value = today;
			}
			
			// Проверяем, нужно ли показывать поле начального уровня топлива
			await checkAndShowFuelLevelField();
			
			return true;
		} catch (err) {
			console.error("Ошибка сохранения записи пробега:", err);
			alert("Ошибка сохранения: " + err.message);
			return false;
		}
	}

	function printMileageTable() {
		// Получаем информацию для заголовка
		const printHeader = document.getElementById("mileagePrintHeader");
		const printDriverName = document.getElementById("printDriverName");
		const printVehicleName = document.getElementById("printVehicleName");
		const printPeriod = document.getElementById("printPeriod");

		if (printHeader && printDriverName && printVehicleName && printPeriod) {
			// Информация об автомобиле
			const vehicleName = currentVehicle ? 
				`${currentVehicle.brand || ''} ${currentVehicle.model || ''} ${currentVehicle.plate_number || ''}`.trim() || 
				currentVehicle.plate_number || '—' : '—';
			printVehicleName.textContent = vehicleName;

			// Информация о водителе - берем из записей
			// Если все записи от одного водителя, показываем только его фамилию
			let driverNames = [];
			if (mileageLogEntries.length > 0) {
				const uniqueDrivers = new Set();
				mileageLogEntries.forEach(entry => {
					if (entry.driver && entry.driver.name) {
						uniqueDrivers.add(entry.driver.name);
					}
				});
				driverNames = Array.from(uniqueDrivers);
			}
			
			// Если водитель один, берем только фамилию (первое слово)
			let driverDisplay = '—';
			if (driverNames.length === 1) {
				const fullName = driverNames[0];
				const nameParts = fullName.trim().split(/\s+/);
				driverDisplay = nameParts[0] || fullName; // Берем первое слово (фамилию)
			} else if (driverNames.length > 1) {
				// Если несколько водителей, показываем все фамилии
				driverDisplay = driverNames.map(name => {
					const nameParts = name.trim().split(/\s+/);
					return nameParts[0] || name;
				}).join(', ');
			}
			printDriverName.textContent = driverDisplay;

			// Информация о периоде
			const monthFilter = document.getElementById("mileageMonthFilter");
			let periodText = '—';
			if (monthFilter && monthFilter.value) {
				const [year, month] = monthFilter.value.split('-');
				const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
				                   'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
				periodText = `${monthNames[parseInt(month) - 1]} ${year}`;
			} else if (mileageLogEntries.length > 0) {
				// Если нет фильтра, определяем период по датам записей
				const dates = mileageLogEntries.map(e => new Date(e.log_date)).sort((a, b) => a - b);
				if (dates.length > 0) {
					const firstDate = dates[0];
					const lastDate = dates[dates.length - 1];
					const firstDateStr = firstDate.toLocaleDateString('ru-RU');
					const lastDateStr = lastDate.toLocaleDateString('ru-RU');
					if (firstDateStr === lastDateStr) {
						periodText = firstDateStr;
					} else {
						periodText = `${firstDateStr} - ${lastDateStr}`;
					}
				}
			}
			printPeriod.textContent = periodText;

			// Показываем заголовок
			printHeader.style.display = 'block';
		}

		window.print();

		// Скрываем заголовок после печати
		if (printHeader) {
			setTimeout(() => {
				printHeader.style.display = 'none';
			}, 100);
		}
	}

	async function checkAndShowFuelLevelField() {
		const fuelLevelGroup = document.getElementById("fuelLevelGroup");
		const fuelLevelInput = document.getElementById("mileageFuelLevel");
		
		if (!fuelLevelGroup || !fuelLevelInput) {
			console.warn("Элементы fuelLevelGroup или mileageFuelLevel не найдены");
			return;
		}
		
		try {
			// Проверяем, есть ли уже записи для этого автомобиля
			if (currentMileageVehicleId) {
				const allEntries = await window.VehiclesDB.getMileageLog(currentMileageVehicleId);
				if (allEntries.length === 0) {
					// Нет записей - показываем поле и делаем его обязательным
					fuelLevelGroup.style.display = "block";
					fuelLevelInput.required = true;
					console.log("Поле начального уровня топлива показано (нет записей)");
				} else {
					// Есть записи - скрываем поле
					fuelLevelGroup.style.display = "none";
					fuelLevelInput.required = false;
					fuelLevelInput.value = "";
					console.log("Поле начального уровня топлива скрыто (есть записи)");
				}
			} else {
				// Если автомобиль не выбран, скрываем поле
				fuelLevelGroup.style.display = "none";
				fuelLevelInput.required = false;
			}
		} catch (err) {
			console.error("Ошибка проверки записей:", err);
			// В случае ошибки показываем поле на всякий случай
			fuelLevelGroup.style.display = "block";
			fuelLevelInput.required = true;
		}
	}

	// Expose functions needed by inline HTML handlers
	window.closeDriverRoute = closeDriverRoute;

	document.addEventListener("DOMContentLoaded", init);
})();

