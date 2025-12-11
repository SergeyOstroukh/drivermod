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
			return (data || []).map(vehicle => {
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
		deleteHistoryEntry
	};
})();

