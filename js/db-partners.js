(() => {
	"use strict";

	let supabaseClient = null;

	function initSupabase() {
		if (supabaseClient) return supabaseClient;
		if (typeof supabase === "undefined") {
			throw new Error("Supabase JS библиотека не загружена");
		}
		const config = window.SUPABASE_CONFIG || {};
		const url = config.url || "YOUR_SUPABASE_URL";
		const anonKey = config.anonKey || "YOUR_SUPABASE_ANON_KEY";
		if (url === "YOUR_SUPABASE_URL" || anonKey === "YOUR_SUPABASE_ANON_KEY") {
			throw new Error("Не настроен Supabase. Укажите URL и API ключ в js/config.js");
		}
		supabaseClient = supabase.createClient(url, anonKey);
		return supabaseClient;
	}

	async function getAllWithId() {
		const client = initSupabase();
		const { data, error } = await client.from("partners").select("*").order("name", { ascending: true });
		if (error) throw error;
		return data || [];
	}

	async function add(partner) {
		const client = initSupabase();
		const { data, error } = await client.from("partners").insert([partner]).select().single();
		if (error) throw error;
		return data;
	}

	async function update(id, partner) {
		const client = initSupabase();
		const { data, error } = await client.from("partners").update(partner).eq("id", id).select().single();
		if (error) throw error;
		return data;
	}

	async function remove(id) {
		const client = initSupabase();
		const { error } = await client.from("partners").delete().eq("id", id);
		if (error) throw error;
	}

	async function hasData() {
		try {
			const client = initSupabase();
			const { count, error } = await client.from("partners").select("*", { count: "exact", head: true });
			if (error) throw error;
			return (count || 0) > 0;
		} catch (e) {
			console.warn("Ошибка проверки partners:", e);
			return false;
		}
	}

	async function checkConnection() {
		try {
			const client = initSupabase();
			const { error } = await client.from("partners").select("id").limit(1);
			if (error) {
				if (error.code === "PGRST116" || String(error.message || "").includes("does not exist")) {
					return { connected: false, message: "Таблица partners не найдена. Примените миграцию." };
				}
				throw error;
			}
			return { connected: true };
		} catch (e) {
			return { connected: false, message: e.message || "Ошибка подключения к partners" };
		}
	}

	window.PartnersDB = {
		getAllWithId,
		add,
		update,
		delete: remove,
		hasData,
		checkConnection
	};
})();
