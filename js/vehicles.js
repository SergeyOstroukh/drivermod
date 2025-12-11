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

			const info = [];
			if (vehicle.drivers && vehicle.drivers.name) {
				info.push(`👤 ${vehicle.drivers.name}`);
			}
			if (vehicle.mileage) {
				info.push(`📊 ${vehicle.mileage.toLocaleString()} км`);
			}

			if (info.length > 0) {
				const subtitle = document.createElement("p");
				subtitle.className = "card-subtitle";
				subtitle.textContent = info.join(" • ");
				titleWrap.appendChild(subtitle);
			}

			// Проверка сроков действия
			const warnings = [];
			if (vehicle.inspection_expiry) {
				const expiry = new Date(vehicle.inspection_expiry);
				const today = new Date();
				const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
				if (daysLeft < 30) {
					warnings.push(`⚠️ Техосмотр: ${daysLeft} дн.`);
				}
			}
			if (vehicle.insurance_expiry) {
				const expiry = new Date(vehicle.insurance_expiry);
				const today = new Date();
				const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
				if (daysLeft < 30) {
					warnings.push(`⚠️ Страховка: ${daysLeft} дн.`);
				}
			}

			if (warnings.length > 0) {
				const warning = document.createElement("p");
				warning.className = "card-working-hours";
				warning.style.color = "var(--danger)";
				warning.textContent = warnings.join(" • ");
				titleWrap.appendChild(warning);
			}

			if (vehicle.notes) {
				const notes = document.createElement("p");
				notes.className = "card-additional-info";
				notes.textContent = vehicle.notes;
				titleWrap.appendChild(notes);
			}

			titleWrap.appendChild(title);
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
			editBtn.addEventListener("click", () => openVehicleModal(vehicle));

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
			document.getElementById("vehicleOilInfo").value = vehicle.oil_change_info || "";
			document.getElementById("vehicleOilInterval").value = vehicle.oil_change_interval || "";
			document.getElementById("vehicleInspection").value = vehicle.inspection_expiry || "";
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
				oil_change_info: formData.get("oil_change_info")?.trim() || null,
				oil_change_interval: parseInt(formData.get("oil_change_interval")) || null,
				inspection_expiry: formData.get("inspection_expiry") || null,
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
	}

	document.addEventListener("DOMContentLoaded", init);
})();

