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
			throw new Error('Supabase JS библиотека не загружена. Убедитесь, что подключен скрипт supabase.js');
		}

		// Получаем конфигурацию
		const config = window.SUPABASE_CONFIG || {};
		const url = config.url || 'YOUR_SUPABASE_URL';
		const anonKey = config.anonKey || 'YOUR_SUPABASE_ANON_KEY';

		if (url === 'YOUR_SUPABASE_URL' || anonKey === 'YOUR_SUPABASE_ANON_KEY') {
			throw new Error('Не настроен Supabase. Укажите URL и API ключ в js/config.js');
		}

		supabaseClient = supabase.createClient(url, anonKey);
		return supabaseClient;
	}

	/**
	 * Получает все поставщики из базы данных
	 */
	async function getAllSuppliers() {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('suppliers')
				.select('*')
				.order('name', { ascending: true });

			if (error) throw error;

			// Удаляем служебные поля для совместимости
			return (data || []).map(({ id, created_at, updated_at, ...supplier }) => supplier);
		} catch (err) {
			console.error('Ошибка получения поставщиков:', err);
			throw err;
		}
	}

	/**
	 * Получает все поставщики из базы данных с ID (для редактирования)
	 */
	async function getAllSuppliersWithId() {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('suppliers')
				.select('*')
				.order('name', { ascending: true });

			if (error) throw error;

			return data || [];
		} catch (err) {
			console.error('Ошибка получения поставщиков:', err);
			throw err;
		}
	}

	/**
	 * Добавляет нового поставщика
	 */
	async function addSupplier(supplier) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('suppliers')
				.insert([supplier])
				.select()
				.single();

			if (error) throw error;

			// Удаляем служебные поля для совместимости
			const { id, created_at, updated_at, ...supplierWithoutMeta } = data;
			return supplierWithoutMeta;
		} catch (err) {
			console.error('Ошибка добавления поставщика:', err);
			throw err;
		}
	}

	/**
	 * Обновляет существующего поставщика
	 */
	async function updateSupplier(id, supplier) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('suppliers')
				.update(supplier)
				.eq('id', id)
				.select()
				.single();

			if (error) throw error;
			if (!data) {
				throw new Error('Поставщик не найден');
			}

			// Удаляем служебные поля для совместимости
			const { id: _, created_at, updated_at, ...supplierWithoutMeta } = data;
			return supplierWithoutMeta;
		} catch (err) {
			console.error('Ошибка обновления поставщика:', err);
			throw err;
		}
	}

	/**
	 * Удаляет поставщика по id
	 */
	async function deleteSupplier(id) {
		try {
			const client = initSupabase();
			const { error } = await client
				.from('suppliers')
				.delete()
				.eq('id', id);

			if (error) throw error;
		} catch (err) {
			console.error('Ошибка удаления поставщика:', err);
			throw err;
		}
	}

	/**
	 * Находит поставщика по имени, адресу и координатам (для поиска существующего)
	 */
	async function findSupplierByNameAndCoords(name, lat, lon) {
		try {
			const client = initSupabase();
			const { data, error } = await client
				.from('suppliers')
				.select('*')
				.eq('name', name)
				.eq('lat', lat)
				.eq('lon', lon)
				.maybeSingle();

			if (error) throw error;
			return data || null;
		} catch (err) {
			console.error('Ошибка поиска поставщика:', err);
			throw err;
		}
	}

	/**
	 * Импортирует массив поставщиков в базу данных
	 * Используется для миграции данных из suppliers.json
	 */
	async function importSuppliers(suppliersArray) {
		try {
			if (!suppliersArray || suppliersArray.length === 0) {
				return;
			}

			const client = initSupabase();
			
			// Удаляем все существующие записи
			const { error: deleteError } = await client
				.from('suppliers')
				.delete()
				.neq('id', 0); // Удаляем все записи

			if (deleteError) {
				console.warn('Ошибка очистки таблицы:', deleteError);
			}

			// Добавляем новые записи батчами по 100
			const batchSize = 100;
			for (let i = 0; i < suppliersArray.length; i += batchSize) {
				const batch = suppliersArray.slice(i, i + batchSize);
				const { error } = await client
					.from('suppliers')
					.insert(batch);

				if (error) {
					console.error(`Ошибка импорта батча ${i / batchSize + 1}:`, error);
					throw error;
				}
			}
		} catch (err) {
			console.error('Ошибка импорта поставщиков:', err);
			throw err;
		}
	}

	/**
	 * Проверяет, есть ли данные в базе
	 */
	async function hasData() {
		try {
			const client = initSupabase();
			const { count, error } = await client
				.from('suppliers')
				.select('*', { count: 'exact', head: true });

			if (error) throw error;
			return (count || 0) > 0;
		} catch (err) {
			console.error('Ошибка проверки данных:', err);
			return false;
		}
	}

	/**
	 * Проверяет подключение к Supabase
	 */
	async function checkConnection() {
		try {
			const client = initSupabase();
			const { error } = await client
				.from('suppliers')
				.select('id')
				.limit(1);

			if (error) {
				// Если таблица не существует, это нормально при первом запуске
				if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
					return { connected: false, message: 'Таблица suppliers не найдена. Создайте таблицу в Supabase Dashboard.' };
				}
				throw error;
			}
			return { connected: true };
		} catch (err) {
			if (err.message.includes('YOUR_SUPABASE')) {
				return { connected: false, message: 'Не настроен Supabase. Укажите URL и API ключ в js/config.js' };
			}
			return { connected: false, message: err.message || 'Ошибка подключения к Supabase' };
		}
	}

	// Экспортируем API
	window.SuppliersDB = {
		getAll: getAllSuppliers,
		getAllWithId: getAllSuppliersWithId,
		add: addSupplier,
		update: updateSupplier,
		delete: deleteSupplier,
		find: findSupplierByNameAndCoords,
		import: importSuppliers,
		hasData: hasData,
		checkConnection: checkConnection
	};
})();
