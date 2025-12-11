(() => {
	"use strict";

	let drivers = [];
	let vehicles = [];
	let editingDriverId = null;
	let editingVehicleId = null;

	const driversListEl = document.getElementById("driversList");
	const vehiclesListEl = document.getElementById("vehiclesList");
	const addDriverBtn = document.getElementById("addDriverBtn");
	const addVehicleBtn = document.getElementById("addVehicleBtn");

	// Навигация между разделами
	function initNavigation() {
		const navTabs = document.querySelectorAll(".nav-tab");
		navTabs.forEach(tab => {
			tab.addEventListener("click", () => {
				const section = tab.dataset.section;
				switchSection(section);
			});
		});
	}

	function switchSection(section) {
		// Обновляем активную вкладку
		document.querySelectorAll(".nav-tab").forEach(tab => {
			tab.classList.toggle("active", tab.dataset.section === section);
		});

		// Скрываем все разделы
		document.querySelectorAll(".content-section").forEach(sec => {
			sec.style.display = "none";
		});

		// Показываем нужный раздел
		const targetSection = document.getElementById(`${section}Section`);
		if (targetSection) {
			targetSection.style.display = "block";
		}

		// Обновляем заголовок
		const titles = {
			suppliers: "Поставщики",
			drivers: "Водители",
			vehicles: "Автомобили"
		};
		const pageTitle = document.getElementById("pageTitle");
		if (pageTitle) {
			pageTitle.textContent = titles[section] || "Поставщики";
		}

		// Скрываем/показываем элементы поиска и действий
		const searchInput = document.getElementById("searchInput");
		const headerActions = document.querySelector(".header-actions");
		
		if (section === "suppliers") {
			if (searchInput) searchInput.style.display = "block";
			if (headerActions) headerActions.style.display = "flex";
		} else {
			if (searchInput) searchInput.style.display = "none";
			if (headerActions) {
				// Показываем только кнопку добавления для текущего раздела
				headerActions.querySelectorAll(".btn").forEach(btn => {
					if (btn.id === "addSupplierBtn" || btn.id === "officeBtn" || 
					    btn.id === "warehouseBtn" || btn.id === "detectLocationBtn") {
						btn.style.display = "none";
					}
				});
			}
		}

		// Загружаем данные при переключении
		if (section === "drivers") {
			loadDrivers();
		} else if (section === "vehicles") {
			loadVehicles();
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

			const editBtn = document.createElement("button");
			editBtn.className = "btn btn-outline btn-icon-only";
			editBtn.title = "Редактировать";
			editBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
				<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
			</svg>`;
			editBtn.addEventListener("click", () => openDriverModal(driver));

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

		if (vehicles.length === 0) {
			const empty = document.createElement("li");
			empty.className = "card";
			empty.textContent = "Автомобили не добавлены";
			vehiclesListEl.appendChild(empty);
			return;
		}

		vehicles.forEach((vehicle) => {
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

			const actions = document.createElement("div");
			actions.className = "actions";

			const mileageBtn = document.createElement("button");
			mileageBtn.className = "btn btn-outline btn-icon-only";
			mileageBtn.title = "Ввести пробег";
			mileageBtn.innerHTML = `<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
			</svg>`;
			mileageBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				console.log("Кнопка ввести пробег нажата, автомобиль:", vehicle);
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

			actions.appendChild(mileageBtn);
			actions.appendChild(historyBtn);
			actions.appendChild(editBtn);
			li.appendChild(header);
			li.appendChild(actions);
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
			historyEntries = await window.VehiclesDB.getVehicleHistory(vehicleId);
			console.log("Загруженная история:", historyEntries);
			renderHistory();
		} catch (err) {
			console.error("Ошибка загрузки истории:", err);
			historyEntries = [];
			renderHistory();
		}
	}

	function renderHistory() {
		const historyTableBody = document.getElementById("historyTableBody");
		if (!historyTableBody) return;

		historyTableBody.innerHTML = "";

		if (historyEntries.length === 0) {
			const row = document.createElement("tr");
			row.innerHTML = '<td colspan="5" style="text-align: center; color: var(--muted);">История пуста</td>';
			historyTableBody.appendChild(row);
			return;
		}

		historyEntries.forEach((entry) => {
			const row = document.createElement("tr");

			// Отладочный вывод
			console.log("Обработка записи истории:", entry);
			console.log("entry.driver:", entry.driver);
			console.log("entry.drivers:", entry.drivers);
			
			// Проверяем разные варианты структуры данных
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
		historySection.style.display = "block";
		loadHistory(vehicle.id);
	}

	function closeHistoryTable() {
		const historySection = document.getElementById("historySection");
		const vehiclesSection = document.getElementById("vehiclesSection");
		
		if (historySection) {
			historySection.style.display = "none";
		}
		if (vehiclesSection) {
			vehiclesSection.style.display = "block";
		}
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

	function openMileageTable(vehicle) {
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

		// Устанавливаем текущий месяц в фильтре
		const monthFilter = document.getElementById("mileageMonthFilter");
		if (monthFilter) {
			const today = new Date();
			const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
			monthFilter.value = month;
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
		mileageSection.style.display = "block";
		
		// Загружаем записи и проверяем, нужно ли показывать поле начального уровня топлива
		await loadMileageLog(vehicle.id);
		await checkAndShowFuelLevelField();
	}

	function closeMileageTable() {
		const mileageSection = document.getElementById("mileageSection");
		const vehiclesSection = document.getElementById("vehiclesSection");
		
		if (mileageSection) {
			mileageSection.style.display = "none";
		}
		if (vehiclesSection) {
			vehiclesSection.style.display = "block";
		}
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
			row.innerHTML = '<td colspan="9" style="text-align: center; color: var(--muted);">Записи отсутствуют</td>';
			mileageTableBody.appendChild(row);
			return;
		}

		// Получаем расход топлива из карточки автомобиля
		const fuelConsumption = currentVehicle ? (currentVehicle.fuel_consumption || 0) : 0;
		// Получаем текущий пробег из карточки автомобиля (для расчета первой записи)
		const vehicleMileage = currentVehicle ? (currentVehicle.mileage || 0) : 0;

		// Сортируем записи по дате (от старых к новым) для правильного расчета
		const sortedEntries = [...mileageLogEntries].sort((a, b) => {
			const dateA = new Date(a.log_date);
			const dateB = new Date(b.log_date);
			return dateA - dateB;
		});

		sortedEntries.forEach((entry, index) => {
			const row = document.createElement("tr");

			const driverName = entry.driver && entry.driver.name ? entry.driver.name : "Неизвестный водитель";
			const date = entry.log_date ? new Date(entry.log_date).toLocaleDateString('ru-RU') : '?';
			const mileage = entry.mileage || 0;
			
			// Рассчитываем пробег за смену
			let shiftMileage = 0;
			if (index === 0) {
				// Для первой (самой старой) записи в списке:
				if (sortedEntries.length === 1) {
					// Если это единственная запись, пробег за смену = разница с предыдущим пробегом из карточки
					// Используем сохраненный предыдущий пробег или вычисляем из текущего пробега в карточке
					const baseMileage = previousVehicleMileage !== null ? previousVehicleMileage : (vehicleMileage - mileage);
					shiftMileage = mileage - baseMileage;
					
					// Если расчет дал <= 0, значит это первая запись вообще - пробег за смену = текущий пробег
					if (shiftMileage <= 0) {
						shiftMileage = mileage;
					}
				} else {
					// Если есть другие записи, вычисляем базовый пробег
					// Базовый пробег = текущий пробег в карточке минус сумма всех пробегов за смену из остальных записей
					let totalShiftMileage = 0;
					for (let i = 1; i < sortedEntries.length; i++) {
						const prevMileage = sortedEntries[i - 1].mileage || 0;
						totalShiftMileage += (sortedEntries[i].mileage - prevMileage);
					}
					const baseMileage = vehicleMileage - totalShiftMileage;
					shiftMileage = mileage - baseMileage;
					
					// Если расчет дал <= 0, используем сохраненный предыдущий пробег
					if (shiftMileage <= 0 && previousVehicleMileage !== null) {
						shiftMileage = mileage - previousVehicleMileage;
					}
					
					// Если все еще <= 0, значит пробег уже был обновлен, используем текущий пробег
					if (shiftMileage <= 0) {
						shiftMileage = mileage;
					}
				}
			} else {
				// Для последующих записей: разница с предыдущей записью
				const prevMileage = sortedEntries[index - 1].mileage || 0;
				shiftMileage = mileage - prevMileage;
			}

			// Рассчитываем расход топлива
			let fuelUsed = '—';
			if (shiftMileage > 0 && fuelConsumption > 0) {
				fuelUsed = (shiftMileage * fuelConsumption / 100).toFixed(2);
			}

			// Рассчитываем уровень топлива автоматически
			let fuelLevel = 0;
			if (index === 0) {
				// Для первой записи: используем введенное значение
				fuelLevel = entry.fuel_level ? parseFloat(entry.fuel_level) : 0;
			} else {
				// Для последующих записей: рассчитываем на основе предыдущей записи
				// Получаем уровень топлива из предыдущей записи
				let prevFuelLevel = 0;
				if (sortedEntries[index - 1].fuel_level) {
					// Если в предыдущей записи есть введенное значение (первая запись)
					prevFuelLevel = parseFloat(sortedEntries[index - 1].fuel_level);
				} else {
					// Если нет, используем рассчитанное значение из предыдущей итерации
					prevFuelLevel = sortedEntries[index - 1].calculated_fuel_level || 0;
				}
				
				// Рассчитываем расход для предыдущей записи
				let prevShiftMileage = 0;
				if (index === 1) {
					// Для второй записи: разница с первой
					prevShiftMileage = sortedEntries[0].mileage - (previousVehicleMileage || sortedEntries[0].mileage);
					if (prevShiftMileage <= 0) {
						prevShiftMileage = sortedEntries[0].mileage;
					}
				} else {
					// Для последующих: разница с предыдущей записью
					prevShiftMileage = sortedEntries[index - 1].mileage - sortedEntries[index - 2].mileage;
				}
				
				const prevFuelUsed = prevShiftMileage > 0 && fuelConsumption > 0 
					? (prevShiftMileage * fuelConsumption / 100) 
					: 0;
				const prevFuelRefill = sortedEntries[index - 1].fuel_refill ? parseFloat(sortedEntries[index - 1].fuel_refill) : 0;
				
				// Рассчитываем уровень после предыдущей смены
				const levelAfterPrevShift = prevFuelLevel - prevFuelUsed + prevFuelRefill;
				
				// Текущий уровень = уровень после предыдущей смены - текущий расход + текущая заправка
				const currentFuelUsed = shiftMileage > 0 && fuelConsumption > 0 
					? (shiftMileage * fuelConsumption / 100) 
					: 0;
				const currentFuelRefill = entry.fuel_refill ? parseFloat(entry.fuel_refill) : 0;
				fuelLevel = levelAfterPrevShift - currentFuelUsed + currentFuelRefill;
			}
			
			// Сохраняем рассчитанный уровень в объекте записи для использования в следующей итерации
			entry.calculated_fuel_level = fuelLevel;

			// Получаем данные о топливе для отображения
			const fuelRefill = entry.fuel_refill ? parseFloat(entry.fuel_refill).toFixed(2) : '—';
			const fuelLevelDisplay = fuelLevel >= 0 ? fuelLevel.toFixed(2) : '—';

			const notes = entry.notes || '—';

			row.innerHTML = `
				<td class="date-cell">${date}</td>
				<td class="driver-cell">${driverName}</td>
				<td class="mileage-cell">${mileage.toLocaleString()}</td>
				<td class="shift-mileage-cell">${shiftMileage > 0 ? shiftMileage.toLocaleString() : '—'}</td>
				<td class="fuel-cell">${fuelUsed}</td>
				<td class="fuel-refill-cell">${fuelRefill}</td>
				<td class="fuel-level-cell">${fuelLevelDisplay}</td>
				<td class="notes-cell" title="${notes}">${notes}</td>
				<td class="actions-cell">
					<button class="btn btn-outline btn-icon-only mileage-delete" data-id="${entry.id}" title="Удалить">
						<svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
						</svg>
					</button>
				</td>
			`;

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

			const entry = {
				vehicle_id: currentMileageVehicleId,
				driver_id: parseInt(formData.get("driver_id")),
				mileage: parseInt(formData.get("mileage")),
				log_date: formData.get("log_date"),
				fuel_level: hasEntries ? null : (parseFloat(formData.get("fuel_level")) || null), // Только для первой записи
				fuel_refill: parseFloat(formData.get("fuel_refill")) || null,
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

			// Если это первая запись, fuel_level обязателен
			if (!hasEntries && (!entry.fuel_level || entry.fuel_level <= 0)) {
				alert("Для первой записи необходимо указать начальный уровень топлива");
				return false;
			}

			// Сохраняем текущий пробег перед добавлением записи
			const currentMileage = currentVehicle ? (currentVehicle.mileage || 0) : 0;
			if (previousVehicleMileage === null) {
				previousVehicleMileage = currentMileage;
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
		window.print();
	}

	document.addEventListener("DOMContentLoaded", init);
})();

