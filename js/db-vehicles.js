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
					drivers!vehicles_driver_id_fkey (
						id,
						name,
						phone
					)
				`)
				.order('plate_number', { ascending: true });

			if (error) throw error;
			
			// Преобразуем данные для удобства (Supabase возвращает массив drivers)
			return (data || []).map(vehicle => ({
				...vehicle,
				drivers: (vehicle.drivers && vehicle.drivers.length > 0) ? vehicle.drivers[0] : null
			}));
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
					drivers!vehicles_driver_id_fkey (
						id,
						name,
						phone
					)
				`)
				.single();

			if (error) throw error;
			return {
				...data,
				drivers: (data.drivers && data.drivers.length > 0) ? data.drivers[0] : null
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
					drivers!vehicles_driver_id_fkey (
						id,
						name,
						phone
					)
				`)
				.single();

			if (error) throw error;
			return {
				...data,
				drivers: (data.drivers && data.drivers.length > 0) ? data.drivers[0] : null
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
		deleteVehicle
	};
})();

