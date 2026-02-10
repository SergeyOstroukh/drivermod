(() => {
	"use strict";

	let supabaseClient = null;

	/**
	 * Инициализирует Supabase клиент
	 */
	function initSupabase() {
		if (supabaseClient) {
			return supabaseClient;
		}

		if (typeof supabase === 'undefined') {
			throw new Error('Supabase JS библиотека не загружена');
		}

		const config = window.SUPABASE_CONFIG || {};
		const url = config.url || 'YOUR_SUPABASE_URL';
		const anonKey = config.anonKey || 'YOUR_SUPABASE_ANON_KEY';

		if (url === 'YOUR_SUPABASE_URL' || anonKey === 'YOUR_SUPABASE_ANON_KEY') {
			throw new Error('Не настроен Supabase. Укажите URL и API ключ в js/config.js');
		}

		supabaseClient = supabase.createClient(url, anonKey);
		return supabaseClient;
	}

	// ============================================
	// ВОДИТЕЛИ
	// ============================================

	async function getAllDrivers() {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('drivers')
				.select('*')
				.order('name', { ascending: true });

			if (error) throw error;
			return data || [];
		} catch (err) {
			console.error('Ошибка получения водителей:', err);
			throw err;
		}
	}

	async function addDriver(driver) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('drivers')
				.insert([driver])
				.select()
				.single();

			if (error) throw error;
			return data;
		} catch (err) {
			console.error('Ошибка добавления водителя:', err);
			throw err;
		}
	}

	async function updateDriver(id, driver) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('drivers')
				.update(driver)
				.eq('id', id)
				.select()
				.single();

			if (error) throw error;
			return data;
		} catch (err) {
			console.error('Ошибка обновления водителя:', err);
			throw err;
		}
	}

	async function deleteDriver(id) {
		try {
			const client = initSupabase();
			const { error } = await client
				.from('drivers')
				.delete()
				.eq('id', id);

			if (error) throw error;
		} catch (err) {
			console.error('Ошибка удаления водителя:', err);
			throw err;
		}
	}

	// ============================================
	// АВТОМОБИЛИ
	// ============================================

	async function getAllVehicles() {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicles')
				.select(`
					*,
					drivers (
						id,
						name,
						phone
					)
				`)
				.order('plate_number', { ascending: true });

			if (error) {
				console.error('Supabase error:', error);
				throw error;
			}
			
		// Преобразуем данные для удобства
		const result = (data || []).map(vehicle => {
			let driver = null;
			
			// Supabase может вернуть данные в разных форматах
			if (vehicle.drivers) {
				if (Array.isArray(vehicle.drivers)) {
					driver = vehicle.drivers.length > 0 ? vehicle.drivers[0] : null;
				} else if (typeof vehicle.drivers === 'object') {
					driver = vehicle.drivers;
				}
			}
			
			return {
				...vehicle,
				drivers: driver
			};
		});

		// Дедупликация по ID (Supabase может вернуть дубли при сложных JOIN)
		const seen = new Set();
		return result.filter(v => {
			if (seen.has(v.id)) return false;
			seen.add(v.id);
			return true;
		});
		} catch (err) {
			console.error('Ошибка получения автомобилей:', err);
			throw err;
		}
	}

	async function addVehicle(vehicle) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicles')
				.insert([vehicle])
				.select(`
					*,
					drivers (
						id,
						name,
						phone
					)
				`)
				.single();

			if (error) throw error;
			
			let driver = null;
			if (data.drivers) {
				if (Array.isArray(data.drivers)) {
					driver = data.drivers.length > 0 ? data.drivers[0] : null;
				} else if (typeof data.drivers === 'object') {
					driver = data.drivers;
				}
			}
			
			return {
				...data,
				drivers: driver
			};
		} catch (err) {
			console.error('Ошибка добавления автомобиля:', err);
			throw err;
		}
	}

	async function updateVehicle(id, vehicle) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicles')
				.update(vehicle)
				.eq('id', id)
				.select(`
					*,
					drivers (
						id,
						name,
						phone
					)
				`)
				.single();

			if (error) throw error;
			
			let driver = null;
			if (data.drivers) {
				if (Array.isArray(data.drivers)) {
					driver = data.drivers.length > 0 ? data.drivers[0] : null;
				} else if (typeof data.drivers === 'object') {
					driver = data.drivers;
				}
			}
			
			return {
				...data,
				drivers: driver
			};
		} catch (err) {
			console.error('Ошибка обновления автомобиля:', err);
			throw err;
		}
	}

	async function deleteVehicle(id) {
		try {
			const client = initSupabase();
			const { error } = await client
				.from('vehicles')
				.delete()
				.eq('id', id);

			if (error) throw error;
		} catch (err) {
			console.error('Ошибка удаления автомобиля:', err);
			throw err;
		}
	}

	// ============================================
	// ИСТОРИЯ ИСПОЛЬЗОВАНИЯ АВТОМОБИЛЕЙ
	// ============================================

	async function getVehicleHistory(vehicleId) {
		try {
			const client = initSupabase();
			
			// Загружаем историю
			const { data: historyData, error: historyError } = await client
				.from('vehicle_driver_history')
				.select('*')
				.eq('vehicle_id', vehicleId)
				.order('start_date', { ascending: false });

			if (historyError) {
				console.error('Supabase error при загрузке истории:', historyError);
				throw historyError;
			}
			
			if (!historyData || historyData.length === 0) {
				return [];
			}
			
			// Собираем уникальные ID водителей
			const driverIds = [...new Set(historyData.map(item => item.driver_id).filter(Boolean))];
			
			// Загружаем водителей отдельным запросом
			let driversMap = {};
			if (driverIds.length > 0) {
				const { data: driversData, error: driversError } = await client
					.from('drivers')
					.select('id, name, phone')
					.in('id', driverIds);
				
				if (driversError) {
					console.error('Supabase error при загрузке водителей:', driversError);
				} else if (driversData) {
					driversMap = driversData.reduce((acc, driver) => {
						acc[driver.id] = driver;
						return acc;
					}, {});
				}
			}
			
			// Объединяем данные
			return historyData.map(item => ({
				...item,
				driver: item.driver_id ? driversMap[item.driver_id] || null : null
			}));
		} catch (err) {
			console.error('Ошибка получения истории:', err);
			throw err;
		}
	}

	async function addHistoryEntry(entry) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicle_driver_history')
				.insert([entry])
				.select('*')
				.single();

			if (error) {
				console.error('Supabase error:', error);
				throw error;
			}
			
			// Загружаем данные водителя отдельно
			let driver = null;
			if (data.driver_id) {
				const { data: driverData, error: driverError } = await client
					.from('drivers')
					.select('id, name, phone')
					.eq('id', data.driver_id)
					.single();
				
				if (!driverError && driverData) {
					driver = driverData;
				}
			}
			
			return {
				...data,
				driver: driver
			};
		} catch (err) {
			console.error('Ошибка добавления записи истории:', err);
			throw err;
		}
	}

	async function updateHistoryEntry(id, entry) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicle_driver_history')
				.update(entry)
				.eq('id', id)
				.select('*')
				.single();

			if (error) {
				console.error('Supabase error:', error);
				throw error;
			}
			
			// Загружаем данные водителя отдельно
			let driver = null;
			if (data.driver_id) {
				const { data: driverData, error: driverError } = await client
					.from('drivers')
					.select('id, name, phone')
					.eq('id', data.driver_id)
					.single();
				
				if (!driverError && driverData) {
					driver = driverData;
				}
			}
			
			return {
				...data,
				driver: driver
			};
		} catch (err) {
			console.error('Ошибка обновления записи истории:', err);
			throw err;
		}
	}

	async function deleteHistoryEntry(id) {
		try {
			const client = initSupabase();
			const { error } = await client
				.from('vehicle_driver_history')
				.delete()
				.eq('id', id);

			if (error) throw error;
		} catch (err) {
			console.error('Ошибка удаления записи истории:', err);
			throw err;
		}
	}

	// Экспортируем API
	// ============================================
	// ЛОГ ПРОБЕГА
	// ============================================

	async function getMileageLog(vehicleId, startDate = null, endDate = null) {
		try {
			const client = initSupabase();
			let query = client
				.from('vehicle_mileage_log')
				.select(`
					*,
					drivers (
						id,
						name,
						phone
					)
				`)
				.eq('vehicle_id', vehicleId)
				.order('log_date', { ascending: false });

			if (startDate) {
				query = query.gte('log_date', startDate);
			}
			if (endDate) {
				query = query.lte('log_date', endDate);
			}

			const { data, error } = await query;

			if (error) {
				console.error('Supabase error:', error);
				throw error;
			}

			// Преобразуем данные водителя
			return (data || []).map(item => {
				let driver = null;
				if (item.drivers) {
					if (Array.isArray(item.drivers)) {
						driver = item.drivers.length > 0 ? item.drivers[0] : null;
					} else if (typeof item.drivers === 'object') {
						driver = item.drivers;
					}
				}
				return {
					...item,
					driver: driver
				};
			});
		} catch (err) {
			console.error('Ошибка получения лога пробега:', err);
			throw err;
		}
	}

	async function addMileageLog(entry) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicle_mileage_log')
				.insert([entry])
				.select(`
					*,
					drivers (
						id,
						name,
						phone
					)
				`)
				.single();

			if (error) {
				console.error('Supabase error:', error);
				throw error;
			}

			// Обновляем пробег в vehicles
			await updateVehicleMileage(entry.vehicle_id);

			let driver = null;
			if (data.drivers) {
				if (Array.isArray(data.drivers)) {
					driver = data.drivers.length > 0 ? data.drivers[0] : null;
				} else if (typeof data.drivers === 'object') {
					driver = data.drivers;
				}
			}

			return {
				...data,
				driver: driver
			};
		} catch (err) {
			console.error('Ошибка добавления записи пробега:', err);
			throw err;
		}
	}

	async function updateMileageLog(id, entry) {
		try {
			const client = initSupabase();
			console.log('updateMileageLog: обновление записи', id, 'данными:', entry);
			const { data, error } = await client
				.from('vehicle_mileage_log')
				.update(entry)
				.eq('id', id)
				.select(`
					*,
					drivers (
						id,
						name,
						phone
					)
				`)
				.single();

			if (error) {
				console.error('Supabase error:', error);
				throw error;
			}
			
			console.log('updateMileageLog: запись обновлена, получены данные:', data);

			// Обновляем пробег в vehicles
			if (entry.vehicle_id || data.vehicle_id) {
				await updateVehicleMileage(entry.vehicle_id || data.vehicle_id);
			}

			let driver = null;
			if (data.drivers) {
				if (Array.isArray(data.drivers)) {
					driver = data.drivers.length > 0 ? data.drivers[0] : null;
				} else if (typeof data.drivers === 'object') {
					driver = data.drivers;
				}
			}

			return {
				...data,
				driver: driver
			};
		} catch (err) {
			console.error('Ошибка обновления записи пробега:', err);
			throw err;
		}
	}

	async function deleteMileageLog(id) {
		try {
			const client = initSupabase();
			
			// Получаем vehicle_id перед удалением
			const { data: logData } = await client
				.from('vehicle_mileage_log')
				.select('vehicle_id')
				.eq('id', id)
				.single();

			const { error } = await client
				.from('vehicle_mileage_log')
				.delete()
				.eq('id', id);

			if (error) throw error;

			// Обновляем пробег в vehicles
			if (logData && logData.vehicle_id) {
				await updateVehicleMileage(logData.vehicle_id);
			}
		} catch (err) {
			console.error('Ошибка удаления записи пробега:', err);
			throw err;
		}
	}

	async function updateVehicleMileage(vehicleId) {
		try {
			const client = initSupabase();
			// Получаем максимальный пробег из логов
			const { data, error } = await client
				.from('vehicle_mileage_log')
				.select('mileage')
				.eq('vehicle_id', vehicleId)
				.order('mileage', { ascending: false })
				.limit(1)
				.single();

			if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
				throw error;
			}

			// Если есть записи, обновляем пробег на максимальный
			// Если записей нет, не обновляем пробег (оставляем прежний)
			if (data && data.mileage) {
				const maxMileage = data.mileage;

				// Обновляем пробег в vehicles
				const { error: updateError } = await client
					.from('vehicles')
					.update({ mileage: maxMileage })
					.eq('id', vehicleId);

				if (updateError) throw updateError;
			}
			// Если записей нет (data === null), пробег не обновляем - остается прежний
		} catch (err) {
			console.error('Ошибка обновления пробега автомобиля:', err);
			throw err;
		}
	}

	// ============================================
	// ЖУРНАЛ ТО
	// ============================================

	async function getMaintenanceLog(vehicleId) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicle_maintenance_log')
				.select('*')
				.eq('vehicle_id', vehicleId)
				.order('service_date', { ascending: false });

			if (error) throw error;
			return data || [];
		} catch (err) {
			console.error('Ошибка получения журнала ТО:', err);
			throw err;
		}
	}

	async function addMaintenanceEntry(entry) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicle_maintenance_log')
				.insert([entry])
				.select('*')
				.single();

			if (error) throw error;
			return data;
		} catch (err) {
			console.error('Ошибка добавления записи ТО:', err);
			throw err;
		}
	}

	async function updateMaintenanceEntry(id, entry) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('vehicle_maintenance_log')
				.update(entry)
				.eq('id', id)
				.select('*')
				.single();

			if (error) throw error;
			return data;
		} catch (err) {
			console.error('Ошибка обновления записи ТО:', err);
			throw err;
		}
	}

	async function deleteMaintenanceEntry(id) {
		try {
			const client = initSupabase();
			const { error } = await client
				.from('vehicle_maintenance_log')
				.delete()
				.eq('id', id);

			if (error) throw error;
		} catch (err) {
			console.error('Ошибка удаления записи ТО:', err);
			throw err;
		}
	}

	window.VehiclesDB = {
		// Водители
		getAllDrivers,
		addDriver,
		updateDriver,
		deleteDriver,
		// Автомобили
		getAllVehicles,
		addVehicle,
		updateVehicle,
		deleteVehicle,
		// История
		getVehicleHistory,
		addHistoryEntry,
		updateHistoryEntry,
		deleteHistoryEntry,
		// Лог пробега
		getMileageLog,
		addMileageLog,
		updateMileageLog,
		deleteMileageLog,
		// Журнал ТО
		getMaintenanceLog,
		addMaintenanceEntry,
		updateMaintenanceEntry,
		deleteMaintenanceEntry
	};
})();

