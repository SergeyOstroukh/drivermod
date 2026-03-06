(() => {
	"use strict";

	let drivers = [];
	let vehicles = [];
	/** ID автомобилей, для которых заполнен пробег за сегодня (для индикатора на карточке) */
	let mileageFilledTodayVehicleIds = new Set();
	/** Статус водителя на сегодня: { driverId: 'work'|'off'|'sick'|'extra'|'vacation'|'duty' } */
	let driverStatusToday = {};
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
			"suppliersSection", "partnersSection", "driversSection", "vehiclesSection",
			"orders1cSection", "inworkSection",
			"historySection", "mileageSection", "maintenanceSection",
			"distributionSection", "driverRouteSection", "scheduleSection"
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
			partners: "Партнёры",
			drivers: "Водители",
			vehicles: "Автомобили",
			orders1c: "Заказы из 1С",
			inwork: "В работе",
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
				const addPartnerBtn = document.getElementById("addPartnerBtn");
				if (addPartnerBtn) addPartnerBtn.style.display = "none";
			}
		} else if (section === "partners") {
			if (headerTop) headerTop.style.display = "";
			if (appContainer) appContainer.classList.remove("dc-fullwidth");
			if (searchInput) searchInput.style.display = "block";
			if (headerActions) {
				headerActions.style.display = "flex";
				["addSupplierBtn", "officeBtn", "warehouseBtn", "detectLocationBtn", "viewToggleBtn"].forEach(id => {
					const btn = document.getElementById(id);
					if (btn) btn.style.display = "none";
				});
				const addPartnerBtn = document.getElementById("addPartnerBtn");
				if (addPartnerBtn) addPartnerBtn.style.display = "";
			}
		} else {
			if (headerTop) headerTop.style.display = "";
			if (appContainer) appContainer.classList.remove("dc-fullwidth");
			if (searchInput) searchInput.style.display = "none";
			if (headerActions) {
				// Скрываем кнопки поставщиков
				["addSupplierBtn", "addPartnerBtn", "officeBtn", "warehouseBtn", "detectLocationBtn", "viewToggleBtn"].forEach(id => {
					const btn = document.getElementById(id);
					if (btn) btn.style.display = "none";
				});
			}
		}

		// Загружаем данные при переключении
		if (section === "drivers") {
			loadDrivers();
			// Для водителя — сразу открыть его маршрут (карточки выездов)
			if (currentRole === "driver" && currentDriverData) {
				setTimeout(function () { openDriverRoute(currentDriverData); }, 100);
			}
		} else if (section === "inwork") {
			_distributedSectionOpen = true;
			if (!_distributedFilterDate) _distributedFilterDate = getTodayLocalDateString();
			var df = document.getElementById("distributedDateFilter");
			if (df) df.value = _distributedFilterDate;
			loadDistributedHistoryForDate(_distributedFilterDate).then(function () { renderDistributedSuppliers(); });
			switchInworkSubtab(_inworkSubTab || 'suppliers');
		} else {
			_distributedSectionOpen = false;
		}
		if (section === "partners") {
			if (window.PartnersUI && window.PartnersUI.onSectionActivated) {
				window.PartnersUI.onSectionActivated();
			}
		} else if (section === "vehicles") {
			loadVehicles();
		} else if (section === "orders1c") {
			if (window.Orders1C && window.Orders1C.refresh) window.Orders1C.refresh();
		} else if (section === "distribution") {
			if (window.DistributionUI) window.DistributionUI.onSectionActivated();
			setTimeout(function () {
				if (window.__dcPending1COrders && window.__dcPending1COrders.length && window.DistributionUI && typeof window.DistributionUI.applyPending1COrders === "function") {
					window.DistributionUI.applyPending1COrders();
				}
			}, 150);
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

			if (driver.telegram_chat_id) {
				const tgInfo = document.createElement("p");
				tgInfo.className = "card-subtitle";
				tgInfo.textContent = `✈️ Telegram подключён`;
				tgInfo.style.color = "var(--success, #229ED9)";
				titleWrap.appendChild(tgInfo);
			}

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
			document.getElementById("driverTelegram").value = driver.telegram_chat_id || "";
			document.getElementById("driverNotes").value = driver.notes || "";
			const showInSchedule = document.getElementById("driverShowInSchedule");
			if (showInSchedule) showInSchedule.checked = driver.show_in_schedule !== false;
			deleteBtn.style.display = "block";
		} else {
			title.textContent = "Добавить водителя";
			form.reset();
			const showInSchedule = document.getElementById("driverShowInSchedule");
			if (showInSchedule) showInSchedule.checked = true;
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

	// ─── График смен (общая таблица) ─────────────────────────────
	const DAY_LABELS = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
	const STATUS_LETTER = { work: "P", off: "В", sick: "Б", extra: "доп", vacation: "О", duty: "Д" };
	const STATUS_STYLE = {
		work: "background:rgba(74,222,128,0.25);color:#22c55e;border:1px solid rgba(34,197,94,0.4);",
		off: "background:rgba(148,163,184,0.2);color:#94a3b8;border:1px solid rgba(148,163,184,0.3);",
		sick: "background:rgba(96,165,250,0.2);color:#60a5fa;border:1px solid rgba(96,165,250,0.3);",
		extra: "background:rgba(250,204,21,0.2);color:#eab308;border:1px solid rgba(250,204,21,0.4);",
		vacation: "background:rgba(168,85,247,0.2);color:#a78bfa;border:1px solid rgba(168,85,247,0.4);",
		duty: "background:rgba(251,146,60,0.2);color:#fb923c;border:1px solid rgba(251,146,60,0.4);"
	};
	let scheduleSelectedCells = [];

	function getStatusByScheme(scheme, year, month, day) {
		const d = new Date(year, month - 1, day);
		const dayOfWeek = d.getDay();
		const ref = new Date(2020, 0, 1).getTime();
		const dayIndex = Math.floor((d.getTime() - ref) / 86400000);
		if (scheme === "5x2") {
			return dayOfWeek >= 1 && dayOfWeek <= 5 ? "work" : "off";
		}
		if (scheme === "3x3") {
			return dayIndex % 6 < 3 ? "work" : "off";
		}
		if (scheme === "2x2") {
			return dayIndex % 4 < 2 ? "work" : "off";
		}
		return "work";
	}

	function openSchedule() {
		document.getElementById("driversSection").style.display = "none";
		const sec = document.getElementById("scheduleSection");
		if (sec) {
			sec.style.display = "block";
			sec.classList.add("active");
		}
		const monthInput = document.getElementById("scheduleMonthInput");
		if (monthInput && !monthInput.value) {
			const now = new Date();
			monthInput.value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
		}
		renderScheduleTable();
	}

	function closeSchedule() {
		document.getElementById("scheduleSection").style.display = "none";
		const sec = document.getElementById("scheduleSection");
		if (sec) sec.classList.remove("active");
		document.getElementById("driversSection").style.display = "block";
	}

	const SCHEME_ORDER = { "5x2": 0, "3x3": 1, "2x2": 2 };
	const SCHEDULE_BASE_STYLE = "min-width:28px;padding:2px;border:1px solid rgba(71,85,105,0.5);text-align:center;font-weight:600;font-size:12px;";

	function updateScheduleSelectionUI() {
		const toolbar = document.getElementById("scheduleToolbar");
		const countEl = document.getElementById("scheduleSelectedCount");
		if (toolbar) toolbar.style.display = scheduleSelectedCells.length ? "flex" : "none";
		if (countEl) countEl.textContent = scheduleSelectedCells.length;
		scheduleSelectedCells.forEach(el => el.classList.add("schedule-cell-selected"));
		document.querySelectorAll(".schedule-cell").forEach(c => {
			if (!scheduleSelectedCells.includes(c)) c.classList.remove("schedule-cell-selected");
		});
	}

	function applyStatusToCell(td, status) {
		td.dataset.status = status;
		td.textContent = STATUS_LETTER[status];
		td.style.cssText = SCHEDULE_BASE_STYLE + STATUS_STYLE[status];
	}

	async function renderScheduleTable() {
		const monthInput = document.getElementById("scheduleMonthInput");
		const thead = document.getElementById("scheduleTableHead");
		const tbody = document.getElementById("scheduleTableBody");
		if (!monthInput || !thead || !tbody) return;
		const [year, month] = monthInput.value.split("-").map(Number);
		if (!year || !month) return;
		const daysInMonth = new Date(year, month, 0).getDate();
		const canEdit = currentRole === "logist";
		scheduleSelectedCells = [];
		updateScheduleSelectionUI();

		await loadDrivers();
		const visible = drivers.filter(d => d.show_in_schedule !== false);
		const hidden = drivers.filter(d => d.show_in_schedule === false);
		visible.sort((a, b) => {
			const sa = SCHEME_ORDER[a.schedule_scheme || "5x2"] ?? 99;
			const sb = SCHEME_ORDER[b.schedule_scheme || "5x2"] ?? 99;
			return sa !== sb ? sa - sb : (a.name || "").localeCompare(b.name || "");
		});
		const driverIds = visible.map(d => d.id);
		const overrides = await window.VehiclesDB.getDriverScheduleForMonth(driverIds.length ? driverIds : [], year, month);

		const hiddenWrap = document.getElementById("scheduleHiddenDrivers");
		const hiddenList = document.getElementById("scheduleHiddenDriversList");
		if (hiddenWrap && hiddenList) {
			if (hidden.length && canEdit) {
				hiddenWrap.style.display = "block";
				hiddenList.innerHTML = hidden.map(d =>
					`<button type="button" class="btn btn-outline btn-sm" style="margin:2px;" data-driver-id="${d.id}">${d.name || "Без имени"} ✓</button>`
				).join("");
				hiddenList.querySelectorAll("button").forEach(btn => {
					btn.addEventListener("click", async () => {
						await window.VehiclesDB.updateDriver(btn.dataset.driverId, { show_in_schedule: true });
						await loadDrivers();
						renderScheduleTable();
					});
				});
			} else {
				hiddenWrap.style.display = "none";
			}
		}

		thead.innerHTML = "";
		tbody.innerHTML = "";
		const headerRow = document.createElement("tr");
		headerRow.innerHTML = "<th style=\"min-width:140px;text-align:left;padding:6px 8px;border:1px solid rgba(71,85,105,0.5);\">ФИО</th><th style=\"width:70px;padding:6px 8px;border:1px solid rgba(71,85,105,0.5);\">Схема</th>";
		for (let d = 1; d <= daysInMonth; d++) {
			const th = document.createElement("th");
			th.style.cssText = "min-width:28px;padding:4px;border:1px solid rgba(71,85,105,0.5);font-size:11px;text-align:center;";
			th.textContent = d;
			const dow = new Date(year, month - 1, d).getDay();
			th.title = DAY_LABELS[dow];
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);

		let lastClickedCell = null;
		visible.forEach(driver => {
			const tr = document.createElement("tr");
			const scheme = driver.schedule_scheme || "5x2";
			const nameCell = document.createElement("td");
			nameCell.style.cssText = "padding:6px 8px;border:1px solid rgba(71,85,105,0.5);";
			const nameWrap = document.createElement("span");
			nameWrap.textContent = driver.name || "";
			nameCell.appendChild(nameWrap);
			if (canEdit) {
				const hideBtn = document.createElement("button");
				hideBtn.type = "button";
				hideBtn.className = "btn btn-outline btn-icon-only";
				hideBtn.style.cssText = "margin-left:6px;padding:2px 6px;font-size:11px;";
				hideBtn.title = "Убрать из графика";
				hideBtn.textContent = "✕";
				hideBtn.addEventListener("click", async (e) => {
					e.stopPropagation();
					await window.VehiclesDB.updateDriver(driver.id, { show_in_schedule: false });
					await loadDrivers();
					renderScheduleTable();
				});
				nameCell.appendChild(hideBtn);
			}
			tr.appendChild(nameCell);
			const schemeCell = document.createElement("td");
			schemeCell.style.cssText = "padding:4px;border:1px solid rgba(71,85,105,0.5);";
			if (canEdit) {
				const sel = document.createElement("select");
				sel.style.cssText = "width:100%;font-size:12px;padding:2px;";
				sel.innerHTML = "<option value=\"5x2\">5×2</option><option value=\"3x3\">3×3</option><option value=\"2x2\">2×2</option>";
				sel.value = scheme;
				sel.addEventListener("change", async () => {
					await window.VehiclesDB.updateDriverScheduleScheme(driver.id, sel.value);
					driver.schedule_scheme = sel.value;
					renderScheduleTable();
				});
				schemeCell.appendChild(sel);
			} else {
				schemeCell.textContent = scheme;
			}
			tr.appendChild(schemeCell);
			const driverOverrides = overrides[driver.id] || {};
			for (let day = 1; day <= daysInMonth; day++) {
				const dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
				let status = driverOverrides[dateStr];
				if (!status) status = getStatusByScheme(scheme, year, month, day);
				const td = document.createElement("td");
				td.className = "schedule-cell";
				td.style.cssText = SCHEDULE_BASE_STYLE + STATUS_STYLE[status];
				td.textContent = STATUS_LETTER[status];
				td.dataset.driverId = driver.id;
				td.dataset.date = dateStr;
				td.dataset.status = status;
				if (canEdit) {
					td.style.cursor = "pointer";
					td.title = "Ctrl+клик: выбор ячеек. Shift+клик: диапазон. Кнопки ниже — применить статус.";
					td.addEventListener("click", (e) => {
						if (e.ctrlKey || e.metaKey) {
							const idx = scheduleSelectedCells.indexOf(td);
							if (idx >= 0) scheduleSelectedCells.splice(idx, 1);
							else scheduleSelectedCells.push(td);
							updateScheduleSelectionUI();
							lastClickedCell = td;
							return;
						}
						if (e.shiftKey && lastClickedCell) {
							const cells = Array.from(tbody.querySelectorAll(".schedule-cell"));
							const i1 = cells.indexOf(lastClickedCell);
							const i2 = cells.indexOf(td);
							if (i1 >= 0 && i2 >= 0) {
								const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
								for (let i = lo; i <= hi; i++) {
									if (!scheduleSelectedCells.includes(cells[i])) scheduleSelectedCells.push(cells[i]);
								}
								updateScheduleSelectionUI();
							}
							return;
						}
						lastClickedCell = td;
					});
				}
				tr.appendChild(td);
			}
			tbody.appendChild(tr);
		});

		const today = new Date();
		const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
		const workingToday = visible.filter(d => {
			const override = overrides[d.id]?.[todayStr];
			const st = override || getStatusByScheme(d.schedule_scheme || "5x2", today.getFullYear(), today.getMonth() + 1, today.getDate());
			return st === "work" || st === "extra" || st === "duty";
		});
		const listEl = document.getElementById("scheduleTodayList");
		if (listEl) {
			if (workingToday.length) {
				listEl.innerHTML = workingToday.map(d => d.name || "—").join("<br>");
			} else {
				listEl.textContent = "Никого";
			}
		}
	}

	async function applyStatusToSelectedCells(status) {
		for (const td of scheduleSelectedCells) {
			const driverId = td.dataset.driverId;
			const dateStr = td.dataset.date;
			applyStatusToCell(td, status);
			await window.VehiclesDB.setDriverScheduleSlot(driverId, dateStr, status);
		}
		scheduleSelectedCells = [];
		updateScheduleSelectionUI();
	}

	function initScheduleSection() {
		const openBtn = document.getElementById("openScheduleBtn");
		const backBtn = document.getElementById("backFromScheduleBtn");
		const monthInput = document.getElementById("scheduleMonthInput");
		if (openBtn) openBtn.addEventListener("click", openSchedule);
		if (backBtn) backBtn.addEventListener("click", closeSchedule);
		if (monthInput) monthInput.addEventListener("change", () => renderScheduleTable());
		["work", "off", "sick", "extra", "duty", "vacation"].forEach(s => {
			const id = "scheduleSet" + (s === "work" ? "Work" : s === "off" ? "Off" : s === "sick" ? "Sick" : s === "extra" ? "Extra" : s === "duty" ? "Duty" : "Vacation");
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener("click", () => applyStatusToSelectedCells(s));
		});
		const clearBtn = document.getElementById("scheduleClearSelection");
		if (clearBtn) clearBtn.addEventListener("click", () => { scheduleSelectedCells = []; updateScheduleSelectionUI(); });
	}

	async function saveDriver(formData) {
		try {
			const driver = {
				name: formData.get("name").trim(),
				phone: formData.get("phone")?.trim() || null,
				license_number: formData.get("license_number")?.trim() || null,
				license_expiry: formData.get("license_expiry") || null,
				telegram_chat_id: formData.get("telegram_chat_id") ? parseInt(formData.get("telegram_chat_id")) : null,
				notes: formData.get("notes")?.trim() || null,
				show_in_schedule: formData.has("show_in_schedule")
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
		driverRouteViewTab = 'delivery';
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

		// Load all routes (multiple trips)
		const today = new Date().toISOString().split("T")[0];
		try {
			const routes = await window.VehiclesDB.getDriverRoutes(driver.id, today);
			renderDriverRoutes(routes);
		} catch (err) {
			console.error("Ошибка загрузки маршрутов:", err);
			renderDriverRoutes([]);
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

	let currentRoutesData = []; // массив маршрутов (выездов) из БД
	let showCompletedPoints = false;
	let driverRouteViewTab = 'delivery'; // 'delivery' | 'suppliers'

	function renderDriverRoutes(routes) {
		const listEl = document.getElementById("driverRouteList");
		const mapEl = document.getElementById("driverRouteMap");
		if (!listEl) return;

		currentRoutesData = routes || [];

		if (currentRoutesData.length === 0) {
			listEl.innerHTML = '<div class="route-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg><p>На сегодня маршрут не назначен</p></div>';
			return;
		}

		// Collect suppliers and deliveries from all routes
		var allSuppliers = [];
		var seenSupplierKeys = {};
		var trips = []; // { route, points (address-only), tripNum, isCompleted }
		var supplierMapPoints = [];
		var deliveryMapPoints = [];

		currentRoutesData.forEach(function (route, ri) {
			var pts = (route.points || []).slice();
			var suppliers = pts.filter(function (pt) { return pt.isSupplier; });
			var addresses = pts.filter(function (pt) { return !pt.isSupplier && !pt.isPoi; });

			suppliers.forEach(function (s) {
				var key = (s.address || '') + '|' + (s.lat || '') + '|' + (s.lng || '');
				if (seenSupplierKeys[key]) return; // skip duplicates across routes
				seenSupplierKeys[key] = true;
				var sup = Object.assign({}, s, { _routeId: route.id, _routeIdx: ri, _ptIdx: pts.indexOf(s) });
				allSuppliers.push(sup);
				if (sup.lat && sup.lng) {
					supplierMapPoints.push(Object.assign({}, sup, { _completed: sup.status === 'picked_up' || sup.status === 'cancelled' || sup.status === 'completed' }));
				}
			});

			trips.push({
				route: route,
				points: addresses,
				allPoints: pts,
				tripNum: ri + 1,
				isCompleted: route.status === 'completed',
			});

			// Delivery points for map
			addresses.forEach(function (pt) {
				if (pt.lat && pt.lng) {
					deliveryMapPoints.push(Object.assign({}, pt, { _completed: pt.status === 'completed' || pt.status === 'delivered' || pt.status === 'cancelled' }));
				}
			});
		});

		var html = '';
		html += '<div style="display:flex;gap:6px;margin-bottom:10px;">';
		html += '<button type="button" class="btn btn-outline btn-sm driver-route-view-tab' + (driverRouteViewTab === 'delivery' ? ' active' : '') + '" data-view-tab="delivery">Доставка (' + deliveryMapPoints.length + ')</button>';
		html += '<button type="button" class="btn btn-outline btn-sm driver-route-view-tab' + (driverRouteViewTab === 'suppliers' ? ' active' : '') + '" data-view-tab="suppliers">Поставщики (' + allSuppliers.length + ')</button>';
		html += '</div>';

		var has1COrders = currentRoutesData.some(function (r) {
			return (r.points || []).some(function (pt) { return (pt.order_1c_id || pt.customer_order_id); });
		});
		var any1CNotStarted = has1COrders && currentRoutesData.some(function (r) {
			return (r.points || []).some(function (pt) {
				return (pt.order_1c_id || pt.customer_order_id) && pt.status !== 'in_delivery' && pt.status !== 'delivered' && pt.status !== 'cancelled';
			});
		});
		if (driverRouteViewTab === 'delivery' && any1CNotStarted) {
			html += '<div style="margin-bottom:12px;">';
			html += '<button type="button" class="btn btn-primary route-start-1c-btn">Начать задание</button>';
			html += '<span style="font-size:12px;color:var(--muted);margin-left:8px;">Переведёт все заказы 1С в статус «В доставке»</span>';
			html += '</div>';
		}

		// ── Suppliers view ──
		if (driverRouteViewTab === 'suppliers' && allSuppliers.length > 0) {
			var activeSup = allSuppliers.filter(function (s) { return s.status !== 'completed' && s.status !== 'picked_up' && s.status !== 'cancelled'; }).length;
			html += '<details class="route-trip-details route-trip-card" open style="margin-bottom:12px;">';
			html += '<summary class="route-trip-summary" style="color:#10b981;font-weight:700;font-size:14px;cursor:pointer;padding:8px 0;list-style:none;display:flex;align-items:center;gap:6px;">';
			html += '<span style="transition:transform .2s;display:inline-block;">&#9654;</span> ';
			html += '\uD83C\uDFE2 Поставщики (' + allSuppliers.length + ')';
			if (activeSup < allSuppliers.length) html += ' <span style="font-weight:400;color:#888;font-size:12px;">' + activeSup + ' активных</span>';
			html += '</summary>';
			html += '<div style="padding-left:4px;">';
			allSuppliers.forEach(function (pt, idx) {
				html += renderRoutePointHtml(pt, idx + 1, idx === allSuppliers.length - 1, pt._routeId, pt._ptIdx);
			});
			html += '</div></details>';
		}

		// ── Delivery view (Trips) ──
		if (driverRouteViewTab === 'delivery') trips.forEach(function (trip) {
			if (trip.points.length === 0 && !trip.isCompleted) return;
			var activeCount = trip.points.filter(function (pt) {
				return pt.status !== 'completed' && pt.status !== 'delivered' && pt.status !== 'cancelled';
			}).length;
			var allDone = trip.isCompleted || (trip.points.length > 0 && activeCount === 0);
			var icon = allDone ? '\u2705' : '\uD83D\uDE97';
			var statusText = trip.isCompleted ? 'завершён' : (allDone ? 'все точки пройдены' : activeCount + ' из ' + trip.points.length + ' активных');

			html += '<details class="route-trip-details route-trip-card" ' + (allDone ? '' : 'open') + ' style="margin-bottom:12px;">';
			html += '<summary class="route-trip-summary" style="font-weight:700;font-size:14px;cursor:pointer;padding:8px 0;list-style:none;display:flex;align-items:center;gap:6px;">';
			html += '<span style="transition:transform .2s;display:inline-block;">&#9654;</span> ';
			html += icon + ' Выезд ' + trip.tripNum + ' <span style="font-weight:400;color:#888;font-size:12px;">(' + statusText + ')</span>';
			html += '</summary>';
			html += '<div style="padding-left:4px;">';

			// Actions for active trip
			if (!allDone) {
				html += '<div style="display:flex;gap:8px;margin-bottom:8px;padding:4px 0;">';
				html += '<button class="btn btn-primary btn-sm route-build-trip-btn" data-route-id="' + trip.route.id + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg> Построить маршрут</button>';
				html += '</div>';
			}

			var num = 0;
			trip.points.forEach(function (pt, idx) {
				if (pt.status !== 'completed') num++;
				var ptIdx = trip.allPoints.indexOf(pt);
				html += renderRoutePointHtml(pt, num || '\u2713', idx === trip.points.length - 1, trip.route.id, ptIdx);
			});

			if (trip.points.length === 0) {
				html += '<div style="padding:8px;color:#888;font-size:12px;">Нет адресов доставки</div>';
			}

			html += '</div></details>';
		});

		if ((driverRouteViewTab === 'delivery' && trips.length === 0) || (driverRouteViewTab === 'suppliers' && allSuppliers.length === 0)) {
			html += '<div class="route-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg><p>На сегодня маршрут не назначен</p></div>';
		}

		listEl.innerHTML = html;

		// Rotate arrows on details open/close
		listEl.querySelectorAll('.route-trip-details').forEach(function (det) {
			var arrow = det.querySelector('summary span');
			if (arrow) arrow.style.transform = det.open ? 'rotate(90deg)' : '';
			det.addEventListener('toggle', function () {
				if (arrow) arrow.style.transform = det.open ? 'rotate(90deg)' : '';
			});
		});

		// Bind events
		bindRouteEvents();

		// Init/update route map by active tab
		initDriverRouteMap(driverRouteViewTab === 'suppliers' ? supplierMapPoints : deliveryMapPoints, mapEl);
	}

	function renderRoutePointHtml(pt, num, isLast, routeId, ptIndex) {
		var isCompleted = pt.status === 'completed' || pt.status === 'delivered' || pt.status === 'cancelled' || pt.status === 'picked_up';
		var h = '';
		h += '<div class="route-point route-point-card' + (isCompleted ? ' route-point-completed' : '') + '">';
		h += '<div class="route-point-num' + (isCompleted ? ' completed' : '') + '">' + (isCompleted ? '✓' : num) + '</div>';
		h += '<div class="route-point-info">';
		h += '<div class="route-point-addr' + (isCompleted ? ' completed-text' : '') + '">' + pt.address + '</div>';
		if (pt.formattedAddress) {
			h += '<div class="route-point-faddr">' + pt.formattedAddress + '</div>';
		}
		if (pt.isKbt) {
			h += '<div class="route-point-kbt" style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">';
			h += '<span style="background:#a855f7;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:3px;">\uD83D\uDCE6 КБТ</span>';
			if (pt.isKbtHelper && pt.mainDriverName) {
				h += '<span style="font-size:11px;color:#a855f7;font-weight:600;">Вы помогаете: ' + pt.mainDriverName + '</span>';
			} else if (pt.helperDriverName) {
				h += '<span style="font-size:11px;color:#a855f7;font-weight:600;">Помощник: ' + pt.helperDriverName + '</span>';
			}
			h += '</div>';
		}
		if (pt.timeSlot) {
			h += '<div class="route-point-meta">\u23F0 ' + pt.timeSlot + '</div>';
		}
		if (pt.phone) {
			h += '<div class="route-point-meta"><a href="tel:' + pt.phone + '">\uD83D\uDCDE ' + pt.phone + '</a></div>';
		}
		// Статусы для ВСЕХ точек маршрута: поставщики, заказы 1С, адреса
		var s = pt.status || 'assigned';
		if (pt.isSupplier) {
			var typeLabel = 'Поставщик';
			var statusLabel = s === 'at_supplier' ? 'У поставщика' : (s === 'picked_up' ? 'Забран' : (s === 'cancelled' ? 'Отменён' : 'В маршруте'));
			h += '<div class="route-point-status" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
			h += '<span style="font-size:11px;color:#888;">' + typeLabel + ' — ' + statusLabel + '</span>';
			if (s !== 'picked_up' && s !== 'cancelled') {
				h += '<button type="button" class="btn btn-outline btn-sm route-supplier-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="at_supplier">У поставщика</button>';
				h += '<button type="button" class="btn btn-primary btn-sm route-supplier-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="picked_up">Забран</button>';
				h += '<button type="button" class="btn btn-outline btn-sm route-supplier-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="cancelled" style="color:var(--danger);border-color:var(--danger);">Отменён</button>';
			}
			h += '</div>';
		} else if (pt.isPartner) {
			var partnerStatusLabel = s === 'in_delivery' ? 'В доставке' : ((s === 'delivered' || s === 'picked_up') ? 'Доставлен' : (s === 'cancelled' ? 'Отменён' : 'В маршруте'));
			h += '<div class="route-point-status" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
			h += '<span style="font-size:11px;color:#888;">Партнёр — ' + partnerStatusLabel + '</span>';
			if (s !== 'delivered' && s !== 'cancelled') {
				h += '<button type="button" class="btn btn-outline btn-sm route-partner-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="in_delivery">В доставке</button>';
				h += '<button type="button" class="btn btn-primary btn-sm route-partner-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="delivered">Доставлен</button>';
				h += '<button type="button" class="btn btn-outline btn-sm route-partner-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="cancelled" style="color:var(--danger);border-color:var(--danger);">Отменён</button>';
			}
			h += '</div>';
		} else if (pt.order_1c_id || pt.customer_order_id) {
			var statusLabel = s === 'in_delivery' ? 'В доставке' : (s === 'delivered' ? 'Доставлен' : (s === 'cancelled' ? 'Отменён' : 'Распределён'));
			var orderLabel = pt.order_1c_id ? ('Заказ 1С: ' + pt.order_1c_id) : ('Заказ 1С #' + pt.customer_order_id);
			h += '<div class="route-point-status" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
			h += '<span style="font-size:11px;color:#888;">' + orderLabel + ' — ' + statusLabel + '</span>';
			if (s !== 'delivered' && s !== 'cancelled') {
				h += '<button type="button" class="btn btn-outline btn-sm route-1c-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="in_delivery">В доставке</button>';
				h += '<button type="button" class="btn btn-primary btn-sm route-1c-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="delivered">Доставлен</button>';
				h += '<button type="button" class="btn btn-outline btn-sm route-1c-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="cancelled" style="color:var(--danger);border-color:var(--danger);">Отменён</button>';
			}
			h += '</div>';
		} else {
			var statusLabel = s === 'in_delivery' ? 'В пути' : (s === 'completed' ? 'Доставлен' : (s === 'cancelled' ? 'Отменён' : 'В маршруте'));
			h += '<div class="route-point-status" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
			h += '<span style="font-size:11px;color:#888;">Адрес — ' + statusLabel + '</span>';
			if (s !== 'completed' && s !== 'cancelled') {
				h += '<button type="button" class="btn btn-outline btn-sm route-address-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="in_delivery">В пути</button>';
				h += '<button type="button" class="btn btn-primary btn-sm route-address-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="completed">Доставлен</button>';
				h += '<button type="button" class="btn btn-outline btn-sm route-address-status-btn" data-route-id="' + routeId + '" data-pt-index="' + ptIndex + '" data-status="cancelled" style="color:var(--danger);border-color:var(--danger);">Отменён</button>';
			}
			h += '</div>';
		}
		h += '</div>';
		h += '<div class="route-point-actions">';
		var pointCompleted = isCompleted || (pt.status === 'delivered' || pt.status === 'cancelled' || pt.status === 'picked_up');
		if (!pointCompleted) {
			if (pt.lat && pt.lng) {
				var webNavUrl = 'https://yandex.by/maps/?rtext=~' + pt.lat + ',' + pt.lng + '&rtt=auto';
				h += '<a href="' + webNavUrl + '" target="_blank" rel="noopener" class="btn btn-outline btn-sm route-nav-btn">Ехать</a>';
			}
		}
		h += '</div>';
		h += '</div>';
		if (!isLast) h += '<div class="route-connector"></div>';
		return h;
	}

	function bindRouteEvents() {
		document.querySelectorAll('.driver-route-view-tab').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var tab = btn.dataset.viewTab;
				if (!tab || tab === driverRouteViewTab) return;
				driverRouteViewTab = tab;
				renderDriverRoutes(currentRoutesData);
			});
		});

		// Complete point buttons
		document.querySelectorAll('.route-complete-btn').forEach(function (btn) {
			btn.addEventListener('click', async function () {
				var routeId = btn.dataset.routeId;
				var ptIndex = parseInt(btn.dataset.ptIndex);
				await completeRoutePointMulti(routeId, ptIndex);
			});
		});

		// 1C order status buttons
		document.querySelectorAll('.route-1c-status-btn').forEach(function (btn) {
			btn.addEventListener('click', async function () {
				var routeId = btn.dataset.routeId;
				var ptIndex = parseInt(btn.dataset.ptIndex);
				var newStatus = btn.dataset.status;
				await set1COrderStatus(routeId, ptIndex, newStatus);
			});
		});

		// Поставщик/партнёр — смена статуса
		document.querySelectorAll('.route-supplier-status-btn').forEach(function (btn) {
			btn.addEventListener('click', async function () {
				var routeId = btn.dataset.routeId;
				var ptIndex = parseInt(btn.dataset.ptIndex);
				var newStatus = btn.dataset.status;
				await setSupplierPointStatus(routeId, ptIndex, newStatus);
			});
		});
		document.querySelectorAll('.route-partner-status-btn').forEach(function (btn) {
			btn.addEventListener('click', async function () {
				var routeId = btn.dataset.routeId;
				var ptIndex = parseInt(btn.dataset.ptIndex);
				var newStatus = btn.dataset.status;
				await setPartnerPointStatus(routeId, ptIndex, newStatus);
			});
		});

		// Обычный адрес — смена статуса (В пути, Доставлен, Отменён)
		document.querySelectorAll('.route-address-status-btn').forEach(function (btn) {
			btn.addEventListener('click', async function () {
				var routeId = btn.dataset.routeId;
				var ptIndex = parseInt(btn.dataset.ptIndex);
				var newStatus = btn.dataset.status;
				await setAddressPointStatus(routeId, ptIndex, newStatus);
			});
		});

		// Начать задание (все заказы 1С → в доставке)
		document.querySelectorAll('.route-start-1c-btn').forEach(function (btn) {
			btn.addEventListener('click', async function () {
				btn.disabled = true;
				try {
					for (var ri = 0; ri < currentRoutesData.length; ri++) {
						var route = currentRoutesData[ri];
						var pts = route.points || [];
						var changed = false;
						var newPoints = pts.map(function (pt) {
							if ((pt.order_1c_id || pt.customer_order_id) && pt.status !== 'in_delivery' && pt.status !== 'delivered' && pt.status !== 'cancelled') {
								changed = true;
								return Object.assign({}, pt, { status: 'in_delivery' });
							}
							return pt;
						});
						if (changed) {
							var updated = await window.VehiclesDB.updateRoutePoints(route.id, newPoints);
							currentRoutesData[ri] = updated;
							for (var pi = 0; pi < newPoints.length; pi++) {
								var p = newPoints[pi];
								if (p.status === 'in_delivery' && p.customer_order_id) {
									var config = window.SUPABASE_CONFIG || {};
									if (config.url && window.supabase) {
										var client = window.supabase.createClient(config.url, config.anonKey);
										await client.from('customer_orders').update({ status: 'in_delivery' }).eq('id', p.customer_order_id);
									}
									if (p.order_1c_id) {
										var fnUrl = (config.url || '').replace(/\/$/, '') + '/functions/v1/push-order-status-to-1c';
										if (fnUrl && fnUrl.indexOf('http') === 0) {
											var hdrs = { 'Content-Type': 'application/json' };
											if (config.anonKey) hdrs['Authorization'] = 'Bearer ' + config.anonKey;
											fetch(fnUrl, { method: 'POST', headers: hdrs, body: JSON.stringify({ order_1c_id: p.order_1c_id, status: 'in_delivery' }) }).catch(function () {});
										}
									}
								}
							}
						}
					}
					renderDriverRoutes(currentRoutesData);
				} finally {
					btn.disabled = false;
				}
			});
		});

		// Build route per trip
		document.querySelectorAll('.route-build-trip-btn').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var routeId = btn.dataset.routeId;
				buildOptimizedRouteForTrip(routeId);
			});
		});
	}

	async function set1COrderStatus(routeId, ptIndex, newStatus) {
		var route = currentRoutesData.find(function (r) { return String(r.id) === String(routeId); });
		if (!route || !route.points) return;
		var pt = route.points[ptIndex];
		if (!pt || (!pt.order_1c_id && !pt.customer_order_id)) return;
		var newPoints = route.points.map(function (p, i) {
			return i === ptIndex ? Object.assign({}, p, { status: newStatus }) : p;
		});
		try {
			var updated = await window.VehiclesDB.updateRoutePoints(route.id, newPoints);
			currentRoutesData = currentRoutesData.map(function (r) {
				return String(r.id) === String(routeId) ? updated : r;
			});
			if (pt.customer_order_id != null) {
				var config = window.SUPABASE_CONFIG || {};
				if (config.url && window.supabase) {
					var client = window.supabase.createClient(config.url, config.anonKey);
					await client.from('customer_orders').update({ status: newStatus }).eq('id', pt.customer_order_id);
				}
				if (pt.order_1c_id) {
					var fnUrl = (config.url || '').replace(/\/$/, '') + '/functions/v1/push-order-status-to-1c';
					if (fnUrl && fnUrl.indexOf('http') === 0) {
						var hdrs = { 'Content-Type': 'application/json' };
						if (config.anonKey) hdrs['Authorization'] = 'Bearer ' + config.anonKey;
						fetch(fnUrl, {
							method: 'POST',
							headers: hdrs,
							body: JSON.stringify({ order_1c_id: pt.order_1c_id, status: newStatus }),
						}).catch(function () {});
					}
				}
			}
			renderDriverRoutes(currentRoutesData);
		} catch (err) {
			console.error('Ошибка обновления статуса заказа 1С:', err);
			alert('Не удалось обновить статус: ' + err.message);
		}
	}

	async function setAddressPointStatus(routeId, ptIndex, newStatus) {
		var route = currentRoutesData.find(function (r) { return String(r.id) === String(routeId); });
		if (!route || !route.points) return;
		var pt = route.points[ptIndex];
		if (!pt || pt.order_1c_id || pt.customer_order_id || pt.isSupplier || pt.isPartner) return;
		var newPoints = route.points.map(function (p, i) {
			return i === ptIndex ? Object.assign({}, p, { status: newStatus }) : p;
		});
		try {
			var updated = await window.VehiclesDB.updateRoutePoints(route.id, newPoints);
			currentRoutesData = currentRoutesData.map(function (r) {
				return String(r.id) === String(routeId) ? updated : r;
			});
			renderDriverRoutes(currentRoutesData);
		} catch (err) {
			console.error('Ошибка обновления статуса адреса:', err);
			alert('Не удалось обновить статус: ' + err.message);
		}
	}

	async function setSupplierPointStatus(routeId, ptIndex, newStatus) {
		var route = currentRoutesData.find(function (r) { return String(r.id) === String(routeId); });
		if (!route || !route.points) return;
		var pt = route.points[ptIndex];
		if (!pt || !pt.isSupplier) return;
		var newPoints = route.points.map(function (p, i) {
			return i === ptIndex ? Object.assign({}, p, { status: newStatus }) : p;
		});
		try {
			var updated = await window.VehiclesDB.updateRoutePoints(route.id, newPoints);
			currentRoutesData = currentRoutesData.map(function (r) {
				return String(r.id) === String(routeId) ? updated : r;
			});
			renderDriverRoutes(currentRoutesData);
		} catch (err) {
			console.error('Ошибка обновления статуса поставщика:', err);
			alert('Не удалось обновить статус: ' + err.message);
		}
	}

	async function setPartnerPointStatus(routeId, ptIndex, newStatus) {
		var route = currentRoutesData.find(function (r) { return String(r.id) === String(routeId); });
		if (!route || !route.points) return;
		var pt = route.points[ptIndex];
		if (!pt || !pt.isPartner) return;
		var newPoints = route.points.map(function (p, i) {
			return i === ptIndex ? Object.assign({}, p, { status: newStatus }) : p;
		});
		try {
			var updated = await window.VehiclesDB.updateRoutePoints(route.id, newPoints);
			currentRoutesData = currentRoutesData.map(function (r) {
				return String(r.id) === String(routeId) ? updated : r;
			});
			renderDriverRoutes(currentRoutesData);
		} catch (err) {
			console.error('Ошибка обновления статуса партнёра:', err);
			alert('Не удалось обновить статус: ' + err.message);
		}
	}

	async function completeRoutePointMulti(routeId, pointIndex) {
		var route = currentRoutesData.find(function (r) { return String(r.id) === String(routeId); });
		if (!route || !route.points) return;

		var pt = route.points[pointIndex];
		var is1COrder = pt && (pt.order_1c_id || pt.customer_order_id);
		var newPointStatus = is1COrder ? 'delivered' : 'completed';

		var updatedPoints = route.points.map(function (p, idx) {
			if (idx === pointIndex) {
				return Object.assign({}, p, { status: newPointStatus });
			}
			return p;
		});

		try {
			var updated = await window.VehiclesDB.updateRoutePoints(route.id, updatedPoints);
			currentRoutesData = currentRoutesData.map(function (r) {
				return String(r.id) === String(routeId) ? updated : r;
			});
			if (is1COrder && pt.customer_order_id != null) {
				var config = window.SUPABASE_CONFIG || {};
				if (config.url && window.supabase) {
					var client = window.supabase.createClient(config.url, config.anonKey);
					await client.from('customer_orders').update({ status: 'delivered' }).eq('id', pt.customer_order_id);
				}
				if (pt.order_1c_id) {
					var fnUrl = (config.url || '').replace(/\/$/, '') + '/functions/v1/push-order-status-to-1c';
					if (fnUrl && fnUrl.indexOf('http') === 0) {
						var hdrs = { 'Content-Type': 'application/json' };
						if (config.anonKey) hdrs['Authorization'] = 'Bearer ' + config.anonKey;
						fetch(fnUrl, {
							method: 'POST',
							headers: hdrs,
							body: JSON.stringify({ order_1c_id: pt.order_1c_id, status: 'delivered' }),
						}).catch(function () {});
					}
				}
			}
			renderDriverRoutes(currentRoutesData);
		} catch (err) {
			console.error("Ошибка обновления статуса точки:", err);
			alert("Не удалось обновить статус: " + err.message);
		}
	}

	function buildOptimizedRouteForTrip(routeId) {
		var route = currentRoutesData.find(function (r) { return String(r.id) === String(routeId); });
		if (!route || !route.points) return;

		var activePoints = route.points
			.filter(function (pt) { return pt.status !== 'completed' && !pt.isSupplier && pt.lat && pt.lng; });

		if (activePoints.length === 0) return;

		var optimized = optimizePointsOrder(activePoints);
		var rtextParts = optimized.map(function (pt) { return pt.lat + ',' + pt.lng; });
		var webUrl = 'https://yandex.by/maps/?rtext=' + rtextParts.join('~') + '&rtt=auto';
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
				var isDone = pt._completed || pt.status === 'completed' || pt.status === 'delivered' || pt.status === 'cancelled';
				const pm = new ymaps.Placemark([pt.lat, pt.lng], {
					iconContent: String(idx + 1),
					balloonContentBody: '<div style="font-family:system-ui;"><strong>' + pt.address + '</strong>' +
						(isDone ? ' <span style="color:#22c55e;">✓</span>' : '') +
						(pt.phone ? '<br>📞 ' + pt.phone : '') +
						(pt.timeSlot ? '<br>⏰ ' + pt.timeSlot : '') + '</div>'
				}, {
					preset: isDone ? 'islands#grayCircleIcon' : 'islands#darkBlueCircleIcon'
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
			await loadDrivers();
			const today = new Date().toISOString().split("T")[0];
			const [y, m, d] = today.split("-").map(Number);
			const filledIds = await window.VehiclesDB.getMileageFilledVehicleIdsForDate(today);
			mileageFilledTodayVehicleIds = new Set(filledIds || []);

			const driverIds = [...new Set(vehicles.map(v => v.driver_id).filter(Boolean))];
			const overrides = driverIds.length ? await window.VehiclesDB.getDriverScheduleForMonth(driverIds, y, m) : {};
			driverStatusToday = {};
			drivers.forEach(dr => {
				const ov = overrides[dr.id]?.[today];
				driverStatusToday[dr.id] = ov || getStatusByScheme(dr.schedule_scheme || "5x2", y, m, d);
			});

			renderVehicles();
		} catch (err) {
			console.error("Ошибка загрузки автомобилей:", err);
			vehicles = [];
			mileageFilledTodayVehicleIds = new Set();
			driverStatusToday = {};
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

			// Индикатор: пробег за смену / на ремонте / выходной
			const shiftMileageLine = document.createElement("p");
			shiftMileageLine.className = "card-subtitle";
			shiftMileageLine.style.fontWeight = "500";
			if (vehicle.on_repair) {
				shiftMileageLine.style.color = "var(--muted)";
				shiftMileageLine.textContent = "🔧 На ремонте";
				shiftMileageLine.title = "Автомобиль на ремонте";
			} else {
				const driverId = vehicle.driver_id || (driver && driver.id);
				const status = driverId ? driverStatusToday[driverId] : null;
				const mileageRequired = status === "work" || status === "extra";
				const mileageFilledToday = mileageFilledTodayVehicleIds.has(vehicle.id);
				if (mileageRequired) {
					if (mileageFilledToday) {
						shiftMileageLine.style.color = "var(--success, #22c55e)";
						shiftMileageLine.textContent = "✅ Пробег за смену: заполнен";
						shiftMileageLine.title = "Данные за сегодня внесены";
					} else {
						shiftMileageLine.style.color = "var(--danger, #ef4444)";
						shiftMileageLine.textContent = "⚠️ Пробег за смену: не заполнен";
						shiftMileageLine.title = "Введите пробег за смену";
					}
				} else {
					shiftMileageLine.style.color = "var(--muted)";
					const lbl = status === "off" ? "Выходной" : status === "duty" ? "Дежурный" : status === "vacation" ? "Отпуск" : status === "sick" ? "Больничный" : "—";
					shiftMileageLine.textContent = lbl + (lbl !== "—" ? ", пробег не требуется" : "");
					shiftMileageLine.title = "В этот день пробег не обязателен";
				}
			}
			titleWrap.appendChild(shiftMileageLine);

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

				if (!vehicle.on_repair) {
					const repairBtn = document.createElement("button");
					repairBtn.className = "btn btn-outline btn-sm";
					repairBtn.title = "Поставить на ремонт (с подтверждением)";
					repairBtn.textContent = "На ремонте";
					repairBtn.addEventListener("click", (e) => {
						e.preventDefault();
						e.stopPropagation();
						putVehicleOnRepair(vehicle);
					});
					actions.appendChild(repairBtn);
				} else {
					const offRepairBtn = document.createElement("button");
					offRepairBtn.className = "btn btn-outline btn-sm";
					offRepairBtn.title = "Снять с ремонта, назначить водителя";
					offRepairBtn.textContent = "Снять с ремонта";
					offRepairBtn.addEventListener("click", (e) => {
						e.preventDefault();
						e.stopPropagation();
						takeVehicleOffRepair(vehicle);
					});
					actions.appendChild(offRepairBtn);
				}
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

	async function putVehicleOnRepair(vehicle) {
		if (!confirm(`Поставить ${vehicle.plate_number || "автомобиль"} на ремонт?\n\nВодитель будет снят. Продолжить?`)) return;
		try {
			const today = new Date().toISOString().split("T")[0];
			await window.VehiclesDB.updateVehicle(vehicle.id, { driver_id: null, on_repair: true, repair_since: today });
			await window.VehiclesDB.addRepairMileageEntry(vehicle.id, today, vehicle.mileage || 0);
			await loadVehicles();
		} catch (err) {
			console.error("Ошибка постановки на ремонт:", err);
			alert("Не удалось поставить на ремонт: " + err.message);
		}
	}

	function takeVehicleOffRepair(vehicle) {
		const overlay = document.createElement("div");
		overlay.className = "modal-overlay";
		overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;";
		const box = document.createElement("div");
		box.className = "modal-content";
		box.style.cssText = "background:var(--card);padding:20px;border-radius:12px;min-width:280px;";
		box.innerHTML = `<h3 style="margin:0 0 12px;">Снять с ремонта</h3><p style="margin:0 0 12px;color:var(--muted);font-size:14px;">Назначить водителя для ${vehicle.plate_number || "автомобиля"}:</p>`;
		const sel = document.createElement("select");
		sel.className = "form-input";
		sel.style.width = "100%";
		sel.innerHTML = '<option value="">Выберите водителя</option>';
		drivers.forEach(d => {
			const opt = document.createElement("option");
			opt.value = d.id;
			opt.textContent = d.name;
			sel.appendChild(opt);
		});
		box.appendChild(sel);
		const btnRow = document.createElement("div");
		btnRow.style.cssText = "display:flex;gap:8px;margin-top:16px;justify-content:flex-end;";
		const okBtn = document.createElement("button");
		okBtn.className = "btn btn-primary";
		okBtn.textContent = "Назначить";
		okBtn.addEventListener("click", async () => {
			const driverId = sel.value ? parseInt(sel.value) : null;
			if (!driverId) { alert("Выберите водителя"); return; }
			try {
				overlay.remove();
				if (vehicle.repair_since) {
					const today = new Date().toISOString().split("T")[0];
					const logs = await window.VehiclesDB.getMileageLog(vehicle.id, vehicle.repair_since, today);
					const existingDates = new Set(logs.map(e => e.log_date));
					let d = new Date(vehicle.repair_since);
					const end = new Date(today);
					while (d <= end) {
						const ds = d.toISOString().split("T")[0];
						if (!existingDates.has(ds)) {
							await window.VehiclesDB.addRepairMileageEntry(vehicle.id, ds, vehicle.mileage || 0);
						}
						d.setDate(d.getDate() + 1);
					}
				}
				await window.VehiclesDB.updateVehicle(vehicle.id, { driver_id: driverId, on_repair: false, repair_since: null });
				await loadVehicles();
			} catch (err) {
				console.error("Ошибка снятия с ремонта:", err);
				alert("Не удалось снять с ремонта: " + err.message);
			}
		});
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "btn btn-outline";
		cancelBtn.textContent = "Отмена";
		cancelBtn.addEventListener("click", () => overlay.remove());
		btnRow.appendChild(cancelBtn);
		btnRow.appendChild(okBtn);
		box.appendChild(btnRow);
		overlay.appendChild(box);
		overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
		document.body.appendChild(overlay);
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

	// ─── Telegram ID auto-fetch ──────────────────────────────
	async function fetchTelegramUpdates() {
		// IMPORTANT:
		// Bot uses webhook now. Telegram forbids getUpdates while webhook is active.
		// Linking is done via deep-link: t.me/<bot>?start=<driverId>
		showTelegramLinkModal();
	}

	function showTelegramLinkModal() {
		// Remove existing modal if any
		var existing = document.getElementById('tgAssignModal');
		if (existing) existing.remove();

		var modal = document.createElement('div');
		modal.id = 'tgAssignModal';
		modal.className = 'modal is-open';
		modal.style.cssText = 'z-index:10000;';

		var botUser = (window.TELEGRAM_BOT_USERNAME || 'drivecontrol_route_bot').replace(/^@/, '').trim();
		var html = '<div class="modal-content modal-content-large" style="max-width:760px;">';
		html += '<h3 class="modal-title">Привязка Telegram</h3>';
		html += '<p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">Telegram-бот работает через webhook, поэтому <b>привязка делается ссылкой</b>. Отправьте ссылку водителю: он откроет её и нажмёт <b>Start</b> — Telegram привяжется автоматически.</p>';
		html += '<p style="margin-bottom:14px;color:var(--text-secondary);font-size:12px;">Если водитель уже нажимал Start раньше — ничего страшного: просто пусть откроет ссылку и нажмёт Start ещё раз.</p>';

		html += '<div style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow:auto;padding-right:6px;">';
		(drivers || []).forEach(function (d) {
			var link = 'https://t.me/' + encodeURIComponent(botUser) + '?start=' + encodeURIComponent(String(d.id));
			var linked = !!d.telegram_chat_id;
			html += '<div style="display:flex;gap:10px;align-items:center;padding:10px;background:var(--bg-card);border-radius:10px;border:1px solid var(--border-color);">';
			html += '<div style="flex:1;min-width:0;">';
			html += '<div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(d.name || ('Водитель #' + d.id)) + '</div>';
			html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">' + (linked ? ('✈️ Уже привязан (chat_id: ' + d.telegram_chat_id + ')') : 'Не привязан') + '</div>';
			html += '<input class="form-input tg-link-input" readonly value="' + escapeHtml(link) + '" style="margin-top:8px;font-size:12px;" />';
			html += '</div>';
			html += '<div style="display:flex;flex-direction:column;gap:8px;">';
			html += '<button type="button" class="btn btn-primary tg-copy-link-btn" data-link="' + escapeHtml(link) + '">' + (linked ? 'Перепривязать (ссылка)' : 'Скопировать ссылку') + '</button>';
			html += '<a class="btn btn-outline" href="' + link + '" target="_blank" rel="noopener noreferrer" style="text-align:center;">Открыть</a>';
			html += '</div>';
			html += '</div>';
		});
		html += '</div>';

		html += '<div class="form-actions" style="margin-top:16px;">';
		html += '<button type="button" id="tgAssignCancelBtn" class="btn btn-outline modal-btn">Закрыть</button>';
		html += '</div>';
		html += '</div>';

		modal.innerHTML = html;
		document.body.appendChild(modal);

		// Bind events
		document.getElementById('tgAssignCancelBtn').addEventListener('click', function () {
			modal.remove();
		});

		var copyBtns = modal.querySelectorAll('.tg-copy-link-btn');
		copyBtns.forEach(function (btn) {
			btn.addEventListener('click', async function () {
				var link = btn.dataset.link || '';
				try {
					if (navigator.clipboard && navigator.clipboard.writeText) {
						await navigator.clipboard.writeText(link);
					} else {
						// Fallback for older browsers
						var tmp = document.createElement('textarea');
						tmp.value = link;
						tmp.style.position = 'fixed';
						tmp.style.left = '-9999px';
						document.body.appendChild(tmp);
						tmp.focus();
						tmp.select();
						document.execCommand('copy');
						tmp.remove();
					}
					btn.textContent = 'Скопировано';
					setTimeout(function () {
						btn.textContent = (btn.textContent === 'Скопировано') ? 'Скопировать ссылку' : btn.textContent;
					}, 900);
				} catch (e) {
					alert('Не удалось скопировать. Скопируйте вручную из поля.');
				}
			});
		});
	}

	function escapeHtml(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	// Инициализация
	function init() {
		initNavigation();

		if (addDriverBtn) {
			addDriverBtn.addEventListener("click", () => openDriverModal());
		}
		initScheduleSection();

		var fetchTgBtn = document.getElementById('fetchTelegramBtn');
		if (fetchTgBtn) {
			fetchTgBtn.addEventListener('click', fetchTelegramUpdates);
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

		// ---- В работе: подвкладки ----
		var inworkSubtabBtns = document.querySelectorAll(".inwork-subtab");
		inworkSubtabBtns.forEach(function (btn) {
			btn.addEventListener("click", function () {
				var sub = btn.dataset.subtab;
				if (sub) switchInworkSubtab(sub);
			});
		});

		const distributedDriverFilter = document.getElementById("distributedDriverFilter");
		if (distributedDriverFilter) {
			distributedDriverFilter.addEventListener("change", function () {
				_distributedFilterDriverId = this.value;
				renderDistributedSuppliers();
			});
		}

		const distributedStatusFilter = document.getElementById("distributedStatusFilter");
		if (distributedStatusFilter) {
			distributedStatusFilter.addEventListener("change", function () {
				_distributedFilterStatus = this.value;
				renderDistributedSuppliers();
			});
		}
		const distributedDateFilter = document.getElementById("distributedDateFilter");
		if (distributedDateFilter) {
			if (!_distributedFilterDate) _distributedFilterDate = getTodayLocalDateString();
			distributedDateFilter.value = _distributedFilterDate;
			distributedDateFilter.addEventListener("change", async function () {
				_distributedFilterDate = this.value || getTodayLocalDateString();
				await loadDistributedHistoryForDate(_distributedFilterDate);
				renderDistributedSuppliers();
			});
		}
		const distributedExportBtn = document.getElementById("distributedExportBtn");
		if (distributedExportBtn) {
			distributedExportBtn.addEventListener("click", downloadDistributedSuppliersCsv);
		}
		var inworkRestoreSuppliersBtn = document.getElementById("inworkRestoreSuppliersBtn");
		if (inworkRestoreSuppliersBtn) {
			inworkRestoreSuppliersBtn.addEventListener("click", function () {
				restoreInworkPointsToMap('suppliers');
			});
		}
		var inworkRestorePairsBtn = document.getElementById("inworkRestorePairsBtn");
		if (inworkRestorePairsBtn) {
			inworkRestorePairsBtn.addEventListener("click", function () {
				restoreSupplierPairsFromText();
			});
		}

		// ---- Заказы / движки (фильтры) ----
		var deliveriesDateFilter = document.getElementById("deliveriesDateFilter");
		if (deliveriesDateFilter) {
			if (!_deliveriesFilterDate) _deliveriesFilterDate = getTodayLocalDateString();
			deliveriesDateFilter.value = _deliveriesFilterDate;
			deliveriesDateFilter.addEventListener("change", async function () {
				_deliveriesFilterDate = this.value || getTodayLocalDateString();
				await loadDistributedDeliveriesForDate(_deliveriesFilterDate);
				renderDistributedDeliveries();
			});
		}
		var deliveriesDriverFilter = document.getElementById("deliveriesDriverFilter");
		if (deliveriesDriverFilter) {
			deliveriesDriverFilter.addEventListener("change", function () {
				_deliveriesFilterDriverId = this.value;
				renderDistributedDeliveries();
			});
		}
		var deliveriesStatusFilter = document.getElementById("deliveriesStatusFilter");
		if (deliveriesStatusFilter) {
			deliveriesStatusFilter.addEventListener("change", function () {
				_deliveriesFilterStatus = this.value;
				renderDistributedDeliveries();
			});
		}
		var inworkRestoreDeliveriesBtn = document.getElementById("inworkRestoreDeliveriesBtn");
		if (inworkRestoreDeliveriesBtn) {
			inworkRestoreDeliveriesBtn.addEventListener("click", function () {
				restoreInworkPointsToMap('deliveries');
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

			if (currentVehicle && currentVehicle.on_repair && currentVehicle.repair_since) {
				const repairSince = currentVehicle.repair_since;
				const today = new Date().toISOString().split("T")[0];
				const existingDates = new Set(mileageLogEntries.map(e => e.log_date));
				let d = new Date(repairSince);
				const end = new Date(today);
				while (d <= end) {
					const ds = d.toISOString().split("T")[0];
					if (!existingDates.has(ds)) {
						const inRange = (!startDate || ds >= startDate) && (!endDate || ds <= endDate);
						if (inRange) {
							mileageLogEntries.push({
								id: null,
								vehicle_id: vehicleId,
								driver_id: null,
								mileage: currentVehicle.mileage || 0,
								log_date: ds,
								notes: "ремонт",
								is_repair: true
							});
						}
					}
					d.setDate(d.getDate() + 1);
				}
			}

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
			if (entry.notes === "ремонт" || entry.is_repair) {
				const date = entry.log_date ? new Date(entry.log_date).toLocaleDateString("ru-RU") : "—";
				row.innerHTML = `<td>${index + 1}</td><td>${date}</td><td colspan="9" style="color:var(--muted);">Ремонт</td>`;
				mileageTableBody.appendChild(row);
				return;
			}

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

	// ============================================
	// РАСПРЕДЕЛЁННЫЕ ПОСТАВЩИКИ (real-time)
	// ============================================

	let _distributedSectionOpen = false;
	let _distributedFilterDriverId = '';
	let _distributedFilterStatus = '';
	let _distributedFilterDate = '';
	let _distributedHistoryRows = [];
	let _distributedHistoryDate = '';
	let _distributedHistoryLoading = false;
	let _distributedHistoryError = '';
	let _inworkSubTab = 'suppliers';

	let _deliveriesRows = [];
	let _deliveriesDate = '';
	let _deliveriesLoading = false;
	let _deliveriesError = '';
	let _deliveriesFilterDriverId = '';
	let _deliveriesFilterStatus = '';
	let _deliveriesFilterDate = '';

	function getTodayLocalDateString() {
		const now = new Date();
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, '0');
		const d = String(now.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	async function loadDistributedHistoryForDate(routeDate) {
		const targetDate = routeDate || getTodayLocalDateString();
		if (!window.VehiclesDB || !window.VehiclesDB.getRoutesByDate) {
			_distributedHistoryRows = [];
			_distributedHistoryDate = '';
			_distributedHistoryError = 'История маршрутов недоступна';
			_distributedHistoryLoading = false;
			return;
		}
		_distributedHistoryLoading = true;
		_distributedHistoryDate = '';
		_distributedHistoryError = '';
		if (_distributedSectionOpen) renderDistributedSuppliers();
		try {
			const routes = await window.VehiclesDB.getRoutesByDate(targetDate);
			const rows = [];
			(routes || []).forEach(function (route) {
				const points = Array.isArray(route.points) ? route.points : [];
				points.forEach(function (pt) {
					if (!pt || !pt.isSupplier) return;
					rows.push({
						address: pt.address || '',
						supplierName: pt.address || '',
						driverName: route.driver && route.driver.name ? route.driver.name : null,
						driverId: route.driver_id || null,
						timeSlot: pt.timeSlot || '',
						phone: pt.phone || '',
						geocoded: true,
						inDb: true,
						telegramStatus: pt.telegramStatus || null,
						telegramSent: !!pt.telegramSent,
						items1c: pt.items1c || null,
						itemsSent: !!pt.itemsSent,
						itemsSentText: pt.itemsSentText || null,
						_source: 'history',
						_routeCreatedAt: route.created_at || null,
					});
				});
			});
			_distributedHistoryRows = rows;
			_distributedHistoryDate = targetDate;
		} catch (err) {
			console.error('Ошибка загрузки распределённых поставщиков по дате:', err);
			_distributedHistoryRows = [];
			_distributedHistoryDate = '';
			_distributedHistoryError = err && err.message ? err.message : 'Ошибка загрузки данных';
		} finally {
			_distributedHistoryLoading = false;
		}
	}

	function getDistributedRowsData() {
		const selectedDate = _distributedFilterDate || getTodayLocalDateString();
		const today = getTodayLocalDateString();
		const hasHistoryForSelectedDate = _distributedHistoryDate === selectedDate;
		const isTodaySelected = selectedDate === today;

		let allSuppliers = [];
		let allDrivers = [];
		if (hasHistoryForSelectedDate) {
			allSuppliers = _distributedHistoryRows.slice();
			const driverMap = {};
			allSuppliers.forEach(function (r) {
				if (!r.driverId || !r.driverName) return;
				if (!driverMap[String(r.driverId)]) {
					driverMap[String(r.driverId)] = { id: r.driverId, name: r.driverName };
				}
			});
			allDrivers = Object.keys(driverMap).map(function (k) { return driverMap[k]; });
		} else if (selectedDate === today && window.DistributionUI && window.DistributionUI.getDistributedSuppliers) {
			allSuppliers = window.DistributionUI.getDistributedSuppliers();
			allDrivers = window.DistributionUI.getDistributionDrivers();
		} else {
			allSuppliers = [];
			allDrivers = [];
		}

		// For today, append live rows from DistributionUI.
		// They represent the current assignment and should win over history snapshots.
		if (isTodaySelected && window.DistributionUI && window.DistributionUI.getDistributedSuppliers) {
			const liveRows = window.DistributionUI.getDistributedSuppliers() || [];
			liveRows.forEach(function (r) {
				allSuppliers.push({ ...r, _source: 'live', _routeCreatedAt: null });
			});
		}

		// Keep one factual row per supplier.
		// This prevents showing old driver assignments after reassignment.
		const statusWeight = {
			'picked_up': 3,
			'confirmed': 2,
			'sent': 1,
			'rejected': 0
		};
		const bySupplier = {};
		const toTs = function (v) {
			if (!v) return 0;
			const ts = Date.parse(v);
			return Number.isFinite(ts) ? ts : 0;
		};
		allSuppliers.forEach(function (r) {
			const key = String(r.supplierName || r.address || '').trim().toLowerCase();
			const nameKey = key;
			if (!nameKey) return;

			if (!bySupplier[key]) {
				bySupplier[key] = { ...r };
				return;
			}

			const prev = bySupplier[key];
			const prevLive = prev._source === 'live';
			const nextLive = r._source === 'live';

			// Current in-memory row always wins over saved route snapshots.
			if (nextLive && !prevLive) {
				bySupplier[key] = { ...prev, ...r };
				return;
			}
			if (!nextLive && prevLive) {
				return;
			}

			// Prefer newer route snapshot when both rows are from history.
			const prevTs = toTs(prev._routeCreatedAt);
			const nextTs = toTs(r._routeCreatedAt);
			if (nextTs > prevTs) {
				bySupplier[key] = { ...prev, ...r };
				return;
			}

			const prevWeight = statusWeight[prev.telegramStatus] != null ? statusWeight[prev.telegramStatus] : -1;
			const nextWeight = statusWeight[r.telegramStatus] != null ? statusWeight[r.telegramStatus] : -1;

			// Prefer row with stronger status (picked_up > confirmed > sent > rejected > empty).
			if (nextWeight > prevWeight) {
				bySupplier[key] = { ...prev, ...r };
				return;
			}

			// Same status: enrich missing fields from newer snapshot.
			if (!prev.items1c && r.items1c) prev.items1c = r.items1c;
			if (!prev.itemsSentText && r.itemsSentText) prev.itemsSentText = r.itemsSentText;
			if (!prev.timeSlot && r.timeSlot) prev.timeSlot = r.timeSlot;
			if (!prev.phone && r.phone) prev.phone = r.phone;
			if (!prev.driverName && r.driverName) prev.driverName = r.driverName;
			prev.itemsSent = !!(prev.itemsSent || r.itemsSent);
			prev.telegramSent = !!(prev.telegramSent || r.telegramSent);
		});

		allSuppliers = Object.keys(bySupplier).map(function (k) { return bySupplier[k]; });
		let rows = allSuppliers.slice();

		// Filter by driver
		const filterId = _distributedFilterDriverId;
		if (filterId) {
			rows = rows.filter(function (r) { return String(r.driverId) === String(filterId); });
		}

		// Filter by status
		if (_distributedFilterStatus === 'completed') {
			rows = rows.filter(function (r) { return r.telegramStatus === 'picked_up'; });
		} else if (_distributedFilterStatus === 'pending') {
			rows = rows.filter(function (r) { return r.telegramStatus !== 'picked_up'; });
		}

		// Sort: picked_up last, then by driver name, then by supplier name
		rows.sort(function (a, b) {
			var pa = a.telegramStatus === 'picked_up' ? 1 : 0;
			var pb = b.telegramStatus === 'picked_up' ? 1 : 0;
			if (pa !== pb) return pa - pb;
			const da = (a.driverName || 'яяя').toLowerCase();
			const db = (b.driverName || 'яяя').toLowerCase();
			if (da < db) return -1;
			if (da > db) return 1;
			return (a.supplierName || '').localeCompare(b.supplierName || '', 'ru');
		});

		return { allSuppliers: allSuppliers, allDrivers: allDrivers, rows: rows };
	}

	function getDistributedStatusLabel(row) {
		if (row.telegramStatus === 'picked_up') return 'Забрал';
		if (row.telegramStatus === 'confirmed') return 'Принял';
		if (row.telegramStatus === 'rejected') return 'Отклонил';
		if (row.telegramSent) return 'Ждём';
		if (row.driverId) return '—';
		return 'Не назначен';
	}

	function getDistributedItemLists(row) {
		var lists = [];
		if (window.DistributionUI && window.DistributionUI.getSupplierItems) {
			var found = window.DistributionUI.getSupplierItems(row.supplierName || row.address);
			if (found && found.length) {
				lists = found.filter(function (x) { return !!x; });
			}
		}
		if (lists.length === 0 && row.items1c) {
			lists = [row.items1c];
		}
		return lists;
	}

	function formatItemListsForDisplay(lists) {
		if (!lists || lists.length === 0) return '';
		if (lists.length === 1) return lists[0];
		return lists.map(function (list, idx) {
			return (idx + 1) + ') ' + list;
		}).join('\n\n');
	}

	function formatItemListsForExport(lists) {
		if (!lists || lists.length === 0) return '';
		if (lists.length === 1) return lists[0];
		return lists.map(function (list, idx) {
			return (idx + 1) + ') ' + list;
		}).join('\n\n');
	}

	function getDistributedItemsMeta(row) {
		var lists = getDistributedItemLists(row);
		var itemsText = formatItemListsForDisplay(lists);
		var hasItems = lists.length > 0;
		var sentText = row.itemsSentText || null;
		var isSentCurrent = !!(hasItems && row.itemsSent && sentText && sentText === row.items1c);

		if (!hasItems) {
			return { itemsText: '', statusHtml: '<span style="color:var(--muted);">⏳ Ожидает товар из 1С</span>', canExpand: false };
		}
		if (isSentCurrent) {
			return { itemsText: itemsText, statusHtml: '<span style="color:#22c55e;">✅ Отправлен водителю</span>', canExpand: true };
		}
		return { itemsText: itemsText, statusHtml: '<span style="color:#f59e0b;">❌ Не отправлен водителю</span>', canExpand: true };
	}

	function getDriverSurnameForExport(driverName) {
		if (!driverName) return '';
		var surname = String(driverName).trim().split(/\s+/)[0] || '';
		if (!surname) return '';
		return surname
			.split('-')
			.map(function (part) {
				if (!part) return part;
				var lower = part.toLocaleLowerCase('ru-RU');
				return lower.charAt(0).toLocaleUpperCase('ru-RU') + lower.slice(1);
			})
			.join('-');
	}

	function csvEscape(value) {
		var str = value == null ? '' : String(value);
		if (str.indexOf('"') !== -1) str = str.replace(/"/g, '""');
		return '"' + str + '"';
	}

	function downloadDistributedSuppliersCsv() {
		const data = getDistributedRowsData();
		if (data.rows.length === 0) {
			alert("Нет данных для экспорта по текущему фильтру");
			return;
		}

		const lines = [];
		lines.push([
			"№",
			"Поставщик",
			"Товар",
			"Водитель",
			"Статус",
			"Время"
		].map(csvEscape).join(";"));

		data.rows.forEach(function (row, idx) {
			var exportLists = getDistributedItemLists(row);
			lines.push([
				idx + 1,
				row.supplierName || row.address || '',
				formatItemListsForExport(exportLists),
				getDriverSurnameForExport(row.driverName),
				getDistributedStatusLabel(row),
				row.timeSlot || ''
			].map(csvEscape).join(";"));
		});

		const csvContent = '\uFEFF' + lines.join('\r\n');
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const link = document.createElement("a");
		const url = URL.createObjectURL(blob);
		const date = _distributedFilterDate || getTodayLocalDateString();
		link.setAttribute("href", url);
		link.setAttribute("download", "distributed-suppliers-" + date + ".csv");
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	function switchInworkSubtab(subtab) {
		_inworkSubTab = subtab || 'suppliers';
		var suppliersPanel = document.getElementById("inworkSuppliersPanel");
		var deliveriesPanel = document.getElementById("inworkDeliveriesPanel");
		document.querySelectorAll(".inwork-subtab").forEach(function (btn) {
			btn.classList.toggle("active", btn.dataset.subtab === _inworkSubTab);
		});
		if (suppliersPanel) suppliersPanel.style.display = _inworkSubTab === 'suppliers' ? 'block' : 'none';
		if (deliveriesPanel) deliveriesPanel.style.display = _inworkSubTab === 'deliveries' ? 'block' : 'none';
		if (_inworkSubTab === 'deliveries') {
			if (!_deliveriesFilterDate) _deliveriesFilterDate = getTodayLocalDateString();
			var df = document.getElementById("deliveriesDateFilter");
			if (df) df.value = _deliveriesFilterDate;
			loadDistributedDeliveriesForDate(_deliveriesFilterDate).then(function () { renderDistributedDeliveries(); });
		}
	}

	function openDistributedSuppliers() {
		if (typeof switchSection === 'function') switchSection('inwork');
	}

	async function restoreInworkPointsToMap(kind) {
		if (!window.DistributionUI || typeof window.DistributionUI.restoreFromHistoryToMap !== 'function') {
			alert('Восстановление недоступно: откройте вкладку "Распределение" и попробуйте снова');
			return;
		}
		if (typeof switchSection === 'function') {
			switchSection('distribution');
		}
		var isSuppliers = kind === 'suppliers';
		var targetDate = isSuppliers
			? (_distributedFilterDate || getTodayLocalDateString())
			: (_deliveriesFilterDate || getTodayLocalDateString());
		var targetDriverId = isSuppliers ? _distributedFilterDriverId : _deliveriesFilterDriverId;
		try {
			var res = await window.DistributionUI.restoreFromHistoryToMap(targetDate, {
				includeSuppliers: isSuppliers,
				includeDeliveries: !isSuppliers,
				include1C: false,
				driverId: targetDriverId || null,
			});
		} catch (err) {
			console.error('Ошибка восстановления точек на карту:', err);
			alert('Не удалось восстановить точки: ' + (err && err.message ? err.message : 'неизвестная ошибка'));
		}
	}

	function parseSupplierDriverPairs(text) {
		var rows = [];
		(text || '').split(/\r?\n/).forEach(function (line) {
			var row = String(line || '').trim();
			if (!row) return;
			var parts = row.split('\t').map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });
			if (parts.length >= 2) {
				rows.push({ supplierName: parts[0], driverName: parts[1] });
				return;
			}
			var m = row.match(/^(.+?)\s{2,}(.+)$/);
			if (m) {
				rows.push({ supplierName: m[1].trim(), driverName: m[2].trim() });
			}
		});
		return rows;
	}

	async function restoreSupplierPairsFromText() {
		var input = document.getElementById('inworkPairsInput');
		var raw = input ? input.value : '';
		var pairs = parseSupplierDriverPairs(raw);
		if (!pairs.length) {
			alert('Не удалось распознать список. Вставьте строки в формате: Поставщик[TAB]Водитель');
			return;
		}
		if (!window.DistributionUI || typeof window.DistributionUI.restoreSuppliersFromPairs !== 'function') {
			alert('Восстановление из списка недоступно: откройте вкладку "Распределение" и попробуйте снова');
			return;
		}
		if (typeof switchSection === 'function') {
			switchSection('distribution');
		}
		try {
			var targetDate = _distributedFilterDate || getTodayLocalDateString();
			await window.DistributionUI.restoreSuppliersFromPairs(pairs, targetDate);
		} catch (err) {
			console.error('Ошибка восстановления по списку:', err);
			alert('Не удалось восстановить по списку: ' + (err && err.message ? err.message : 'неизвестная ошибка'));
		}
	}

	function renderDistributedSuppliers() {
		const tbody = document.getElementById("distributedTableBody");
		const filterSelect = document.getElementById("distributedDriverFilter");
		if (!tbody) return;

		const selectedDate = _distributedFilterDate || getTodayLocalDateString();
		if (_distributedHistoryLoading) {
			tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);">Загрузка данных за ' + selectedDate + '...</td></tr>';
			return;
		}
		if (_distributedHistoryError && _distributedHistoryDate !== selectedDate) {
			tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;">Ошибка загрузки: ' + _distributedHistoryError + '</td></tr>';
			return;
		}

		const data = getDistributedRowsData();
		const allSuppliers = data.allSuppliers;
		const allDrivers = data.allDrivers;
		let rows = data.rows;

		// Update driver filter dropdown (preserve selection)
		if (filterSelect) {
			const prev = _distributedFilterDriverId;
			filterSelect.innerHTML = '<option value="">Все</option>';
			allDrivers.forEach(function (d) {
				const opt = document.createElement('option');
				opt.value = d.id;
				opt.textContent = d.name;
				if (String(d.id) === String(prev)) opt.selected = true;
				filterSelect.appendChild(opt);
			});
		}

		// Stats
		var totalCount = allSuppliers.length;
		var pickedCount = allSuppliers.filter(function (r) { return r.telegramStatus === 'picked_up'; }).length;

		if (rows.length === 0) {
			tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);">' +
				(allSuppliers.length === 0 ? 'Нет распределённых поставщиков' : 'Нет поставщиков по фильтру') +
				'</td></tr>';
			return;
		}

		tbody.innerHTML = '';

		// Summary row
		var summaryTr = document.createElement('tr');
		summaryTr.style.background = 'rgba(99,102,241,0.08)';
		summaryTr.innerHTML = '<td colspan="6" style="padding:8px 12px;font-size:13px;color:var(--muted);">' +
			'Всего: <strong style="color:var(--text);">' + totalCount + '</strong>' +
			' &nbsp;|&nbsp; Забрали: <strong style="color:#22c55e;">' + pickedCount + '</strong>' +
			' &nbsp;|&nbsp; Ожидают: <strong style="color:#f59e0b;">' + (totalCount - pickedCount) + '</strong>' +
			'</td>';
		tbody.appendChild(summaryTr);

		rows.forEach(function (row, i) {
			const tr = document.createElement('tr');
			var isPickedUp = row.telegramStatus === 'picked_up';
			if (isPickedUp) tr.style.opacity = '0.55';

			const tdNum = document.createElement('td');
			tdNum.textContent = i + 1;
			tdNum.style.color = 'var(--muted)';

			const tdName = document.createElement('td');
			tdName.textContent = row.supplierName || row.address;
			tdName.style.fontWeight = '500';
			if (!row.inDb) {
				tdName.style.color = '#ef4444';
				tdName.title = 'Не найден в базе';
			}
			if (isPickedUp) tdName.style.textDecoration = 'line-through';

			const tdDriver = document.createElement('td');
			if (row.driverName) {
				tdDriver.textContent = row.driverName;
			} else {
				tdDriver.textContent = '—';
				tdDriver.style.color = 'var(--muted)';
			}

			const tdStatus = document.createElement('td');
			if (isPickedUp) {
				tdStatus.innerHTML = '<span style="color:#22c55e;font-weight:600;">📦 Забрал</span>';
			} else if (row.telegramStatus === 'confirmed') {
				tdStatus.innerHTML = '<span style="color:#3b82f6;">✅ Принял</span>';
			} else if (row.telegramStatus === 'rejected') {
				tdStatus.innerHTML = '<span style="color:#ef4444;">❌ Отклонил</span>';
			} else if (row.telegramSent) {
				tdStatus.innerHTML = '<span style="color:#f59e0b;">⏳ Ждём</span>';
			} else if (row.driverId) {
				tdStatus.innerHTML = '<span style="color:var(--muted);">—</span>';
			} else {
				tdStatus.innerHTML = '<span style="color:var(--muted);">Не назначен</span>';
			}

			const tdTime = document.createElement('td');
			tdTime.textContent = row.timeSlot;
			if (!row.timeSlot) tdTime.style.color = 'var(--muted)';

			const tdItems = document.createElement('td');
			var itemMeta = getDistributedItemsMeta(row);
			tdItems.style.fontSize = '11px';
			tdItems.innerHTML = itemMeta.statusHtml;
			if (itemMeta.canExpand) {
				var details = document.createElement('details');
				details.style.marginTop = '4px';
				details.style.cursor = 'pointer';
				var summary = document.createElement('summary');
				summary.textContent = 'Показать товары';
				summary.style.color = '#93c5fd';
				var body = document.createElement('div');
				body.textContent = itemMeta.itemsText;
				body.style.whiteSpace = 'pre-line';
				body.style.color = '#a78bfa';
				body.style.marginTop = '4px';
				details.appendChild(summary);
				details.appendChild(body);
				tdItems.appendChild(details);
			}

			tr.appendChild(tdNum);
			tr.appendChild(tdName);
			tr.appendChild(tdItems);
			tr.appendChild(tdDriver);
			tr.appendChild(tdStatus);
			tr.appendChild(tdTime);
			tbody.appendChild(tr);
		});
	}

	// Real-time: distribution module calls this on every change
	window._onDistributionChanged = function () {
		if (_distributedSectionOpen && (_distributedFilterDate || getTodayLocalDateString()) === getTodayLocalDateString()) {
			renderDistributedSuppliers();
		}
		if (_inworkSubTab === 'deliveries' && (_deliveriesFilterDate || getTodayLocalDateString()) === getTodayLocalDateString()) {
			loadDistributedDeliveriesForDate(_deliveriesFilterDate).then(function () { renderDistributedDeliveries(); });
		}
	};

	// ============================================
	// ЗАКАЗЫ / ДВИЖКИ (адреса и партнёры с распределения, не из 1С)
	// ============================================

	async function loadDistributedDeliveriesForDate(routeDate) {
		var targetDate = routeDate || getTodayLocalDateString();
		if (!window.VehiclesDB || !window.VehiclesDB.getRoutesByDate) {
			_deliveriesRows = [];
			_deliveriesDate = '';
			_deliveriesError = 'История маршрутов недоступна';
			_deliveriesLoading = false;
			return;
		}
		_deliveriesLoading = true;
		_deliveriesDate = '';
		_deliveriesError = '';
		if (_inworkSubTab === 'deliveries') renderDistributedDeliveries();
		try {
			var routes = await window.VehiclesDB.getRoutesByDate(targetDate);
			var rows = [];
			(routes || []).forEach(function (route) {
				var points = Array.isArray(route.points) ? route.points : [];
				points.forEach(function (pt) {
					if (!pt || pt.isSupplier) return;
					if (pt.order_1c_id || pt.customer_order_id) return;
					var typeLabel = pt.isPartner ? 'Партнёр' : 'Адрес';
					var statusLabel = pt.status === 'in_delivery' ? 'В пути' : (pt.status === 'completed' || pt.status === 'delivered' ? 'Доставлен' : (pt.status === 'picked_up' ? 'Забран' : (pt.status === 'cancelled' ? 'Отменён' : 'В маршруте')));
					rows.push({
						address: pt.address || '',
						typeLabel: typeLabel,
						driverName: route.driver && route.driver.name ? route.driver.name : null,
						driverId: route.driver_id || null,
						timeSlot: pt.timeSlot || '',
						phone: pt.phone || '',
						status: pt.status || 'assigned',
						routeId: route.id,
					});
				});
			});
			_deliveriesRows = rows;
			_deliveriesDate = targetDate;
		} catch (err) {
			console.error('Ошибка загрузки заказов/движков:', err);
			_deliveriesRows = [];
			_deliveriesDate = '';
			_deliveriesError = (err && err.message) ? err.message : 'Ошибка загрузки данных';
		} finally {
			_deliveriesLoading = false;
		}
	}

	function renderDistributedDeliveries() {
		var tbody = document.getElementById("deliveriesTableBody");
		var driverSelect = document.getElementById("deliveriesDriverFilter");
		if (!tbody) return;

		var selectedDate = _deliveriesFilterDate || getTodayLocalDateString();
		if (_deliveriesLoading) {
			tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);">Загрузка данных за ' + selectedDate + '...</td></tr>';
			return;
		}
		if (_deliveriesError && _deliveriesDate !== selectedDate) {
			tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;">Ошибка: ' + _deliveriesError + '</td></tr>';
			return;
		}

		var rows = _deliveriesRows.slice();
		var driverIds = {};
		rows.forEach(function (r) {
			if (r.driverId && r.driverName) driverIds[String(r.driverId)] = { id: r.driverId, name: r.driverName };
		});
		var allDrivers = Object.keys(driverIds).map(function (k) { return driverIds[k]; });

		if (driverSelect) {
			var prev = _deliveriesFilterDriverId;
			driverSelect.innerHTML = '<option value="">Все водители</option>';
			allDrivers.forEach(function (d) {
				var opt = document.createElement('option');
				opt.value = d.id;
				opt.textContent = d.name;
				if (String(d.id) === String(prev)) opt.selected = true;
				driverSelect.appendChild(opt);
			});
		}

		if (_deliveriesFilterDriverId) {
			rows = rows.filter(function (r) { return String(r.driverId) === String(_deliveriesFilterDriverId); });
		}
		if (_deliveriesFilterStatus) {
			rows = rows.filter(function (r) {
				if (_deliveriesFilterStatus === 'assigned') return !r.status || r.status === 'assigned';
				if (_deliveriesFilterStatus === 'in_delivery') return r.status === 'in_delivery';
				if (_deliveriesFilterStatus === 'completed' || _deliveriesFilterStatus === 'delivered') return r.status === 'completed' || r.status === 'delivered';
				if (_deliveriesFilterStatus === 'picked_up') return r.status === 'picked_up';
				if (_deliveriesFilterStatus === 'cancelled') return r.status === 'cancelled';
				return true;
			});
		}

		rows.sort(function (a, b) {
			var da = (a.driverName || 'яяя').toLowerCase();
			var db = (b.driverName || 'яяя').toLowerCase();
			if (da < db) return -1;
			if (da > db) return 1;
			return (a.address || '').localeCompare(b.address || '', 'ru');
		});

		if (rows.length === 0) {
			tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);">' +
				(_deliveriesRows.length === 0 ? 'Нет заказов/движков (адреса и партнёры с страницы распределения)' : 'Нет по фильтру') + '</td></tr>';
			return;
		}

		tbody.innerHTML = '';
		rows.forEach(function (row, i) {
			var tr = document.createElement('tr');
			var tdNum = document.createElement('td');
			tdNum.textContent = i + 1;
			tdNum.style.color = 'var(--muted)';
			var tdAddr = document.createElement('td');
			tdAddr.textContent = row.address;
			tdAddr.style.fontWeight = '500';
			var tdType = document.createElement('td');
			tdType.textContent = row.typeLabel;
			tdType.style.color = 'var(--muted)';
			var tdDriver = document.createElement('td');
			tdDriver.textContent = row.driverName || '—';
			var tdStatus = document.createElement('td');
			var s = row.status;
			if (s === 'completed' || s === 'delivered') tdStatus.innerHTML = '<span style="color:#22c55e;">Доставлен</span>';
			else if (s === 'picked_up') tdStatus.innerHTML = '<span style="color:#22c55e;">Забран</span>';
			else if (s === 'cancelled') tdStatus.innerHTML = '<span style="color:#ef4444;">Отменён</span>';
			else if (s === 'in_delivery') tdStatus.innerHTML = '<span style="color:#f59e0b;">В пути</span>';
			else tdStatus.innerHTML = '<span style="color:var(--muted);">В маршруте</span>';
			var tdTime = document.createElement('td');
			tdTime.textContent = row.timeSlot || '—';
			tdTime.style.color = 'var(--muted)';
			tr.appendChild(tdNum);
			tr.appendChild(tdAddr);
			tr.appendChild(tdType);
			tr.appendChild(tdDriver);
			tr.appendChild(tdStatus);
			tr.appendChild(tdTime);
			tbody.appendChild(tr);
		});
	}

	// Expose functions needed by inline HTML handlers
	window.closeDriverRoute = closeDriverRoute;

	document.addEventListener("DOMContentLoaded", init);
})();

