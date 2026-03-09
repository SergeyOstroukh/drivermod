/**
 * Вкладка "Заказы из 1С": загрузка customer_orders на сегодня, фильтры, выбор, перенос на карту.
 */
(function () {
  "use strict";

  const STATUS_LABELS = {
    new: "Не распределён",
    on_map: "На карте",
    assigned: "Распределён",
    in_delivery: "В доставке",
    delivered: "Доставлен",
    cancelled: "Отменён",
  };
  var STATUS_SORT_ORDER = { new: 0, on_map: 1, in_delivery: 2, assigned: 3, delivered: 4, cancelled: 5 };
  var MAP_ALLOWED_STATUSES = { new: true, cancelled: true, on_map: true };

  let orders = [];
  let driverNameById = {};
  let selectedIds = new Set();
  let realtimeChannel = null;
  var _deliveryLockColumnMissing = false;

  function getSupabaseClient() {
    var config = window.SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) return null;
    if (!window._dcSupabase) {
      window._dcSupabase = supabase.createClient(config.url, config.anonKey);
    }
    return window._dcSupabase;
  }

  function todayStr() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function getSelectedDate() {
    var el = document.getElementById("orders1cDateFilter");
    if (el && el.value) return el.value;
    return todayStr();
  }

  function getStatusFilter() {
    var el = document.getElementById("orders1cStatusFilter");
    return el ? (el.value || "").trim() : "";
  }

  function getTimeFilter() {
    var el = document.getElementById("orders1cTimeFilter");
    return el ? (el.value || "").trim() : "";
  }

  function getSearchQuery() {
    var el = document.getElementById("orders1cSearchInput");
    return el ? (el.value || "").trim() : "";
  }

  function statusForSearchLabel(status) {
    if (status === "delivered") return "Продано (доставлено)";
    if (status === "cancelled") return "Отменено";
    return STATUS_LABELS[status] || status || "—";
  }

  function getDriverName(order) {
    if (!order) return "Не назначен";
    var id = order.assigned_driver_id;
    if (id == null) return "Не назначен";
    return driverNameById[String(id)] || ("ID " + id);
  }

  function formatItems(items) {
    if (items == null || items === "") return "—";
    if (typeof items === "string") {
      var txt = items.trim();
      if ((txt.startsWith("[") && txt.endsWith("]")) || (txt.startsWith("{") && txt.endsWith("}"))) {
        try {
          return formatItems(JSON.parse(txt));
        } catch (_) {}
      }
      return txt;
    }
    if (Array.isArray(items)) {
      return items
        .map(function (it) {
          if (typeof it === "string") return it;
          var name = it && (it.name || it.title || it.product || "");
          var qty = it && (it.qty || it.quantity || it.count || "");
          if (name && qty) return name + " x" + qty;
          return name || JSON.stringify(it);
        })
        .join("; ");
    }
    return JSON.stringify(items);
  }

  function formatAmount(amount) {
    if (amount == null || amount === "") return "";
    var n = Number(amount);
    if (!isFinite(n)) return String(amount) + " ₽";
    return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₽";
  }

  function csvEscape(value) {
    var s = value == null ? "" : String(value);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function filteredOrders() {
    var status = getStatusFilter();
    var timeSlot = getTimeFilter();
    var list = orders;
    if (status) list = list.filter(function (o) { return o.status === status; });
    if (timeSlot) list = list.filter(function (o) { return (o.delivery_time_slot || "") === timeSlot; });
    return list;
  }

  function renderTimeFilterOptions() {
    var sel = document.getElementById("orders1cTimeFilter");
    if (!sel) return;
    var slots = [];
    orders.forEach(function (o) {
      var t = (o.delivery_time_slot || "").trim();
      if (t && slots.indexOf(t) === -1) slots.push(t);
    });
    slots.sort();
    var current = sel.value;
    sel.innerHTML =
      '<option value="">Время доставки — все</option>' +
      slots.map(function (s) {
        return '<option value="' + escapeHtml(s) + '"' + (current === s ? " selected" : "") + ">" + escapeHtml(s) + "</option>";
      }).join("");
  }

  function escapeHtml(s) {
    if (s == null) return "";
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function get1CSyncMeta(order) {
    var state = (order && order.sync_1c_state) || "";
    if (state === "ok") {
      return { text: "✓ Синхронизировано с 1С", cls: "orders1c-sync-ok", retry: false };
    }
    if (state === "pending") {
      return { text: "⏳ Ждет отправки в 1С", cls: "orders1c-sync-pending", retry: false };
    }
    if (state === "error") {
      return { text: "⚠ Ошибка 1С", cls: "orders1c-sync-error", retry: true };
    }
    if (order && order.order_1c_id) {
      return { text: "⏳ Ждет отправки в 1С", cls: "orders1c-sync-pending", retry: false };
    }
    return { text: "—", cls: "orders1c-sync-muted", retry: false };
  }

  function renderTable() {
    var tbody = document.getElementById("orders1cTableBody");
    if (!tbody) return;

    var list = filteredOrders();
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);">Нет заказов на выбранную дату</td></tr>';
      updateSelectionUI();
      return;
    }

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);">Нет заказов по выбранным фильтрам</td></tr>';
      updateSelectionUI();
      return;
    }

    tbody.innerHTML = list
      .map(function (o) {
        var canMoveToMap = !!MAP_ALLOWED_STATUSES[o.status || "new"] && !o.delivery_locked;
        if (!canMoveToMap) selectedIds.delete(o.id);
        var checked = selectedIds.has(o.id) ? ' checked="checked"' : "";
        var statusLabel = STATUS_LABELS[o.status] || o.status;
        var syncMeta = get1CSyncMeta(o);
        var syncError = (o.sync_1c_last_error || "").trim();
        var itemsDisplay = [formatItems(o.items), formatAmount(o.amount)].filter(Boolean).join(" · ") || "—";
        var rowClass = o.status === "on_map" ? " orders1c-row-on-map" : "";
        return (
          "<tr data-order-id=\"" +
          o.id +
          "\" class=\"orders1c-row" +
          rowClass +
          "\">" +
          '<td><input type="checkbox" class="orders1c-row-cb" data-id="' +
          o.id +
          '"' +
          checked +
          (canMoveToMap ? "" : ' disabled="disabled" title="Этот заказ уже закрыт для повторной доставки"') +
          " /></td>" +
          "<td>" +
          escapeHtml(String(o.order_1c_id || "")) +
          "</td>" +
          "<td>" +
          escapeHtml(o.delivery_address || "") +
          "</td>" +
          "<td>" +
          escapeHtml((o.customer_name || "") + (o.phone ? " " + o.phone : "")) +
          "</td>" +
          "<td>" +
          escapeHtml(o.delivery_time_slot || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(itemsDisplay) +
          "</td>" +
          '<td><span class="orders1c-status orders1c-status-' +
          (o.status || "new") +
          '">' +
          escapeHtml(statusLabel) +
          "</span></td>" +
          '<td><div class="orders1c-sync-cell"><span class="orders1c-sync ' +
          syncMeta.cls +
          '">' +
          escapeHtml(syncMeta.text) +
          "</span>" +
          (syncError ? '<div class="orders1c-sync-error-text">' + escapeHtml(syncError) + "</div>" : "") +
          (syncMeta.retry
            ? '<button type="button" class="btn btn-outline btn-sm orders1c-retry-btn" data-id="' + o.id + '">Повторить</button>'
            : "") +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");

    tbody.querySelectorAll(".orders1c-row-cb").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var id = Number(cb.dataset.id);
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateSelectionUI();
        updateSelectAllState();
      });
    });

    tbody.querySelectorAll(".orders1c-retry-btn").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = Number(btn.dataset.id);
        btn.disabled = true;
        try {
          await retryOrder1CSync(id);
        } finally {
          btn.disabled = false;
        }
      });
    });

    updateSelectionUI();
    updateSelectAllState();
  }

  function renderSearchResults(list, query) {
    var box = document.getElementById("orders1cSearchResult");
    if (!box) return;
    var q = (query || "").trim();
    if (!q) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }
    if (!list || list.length === 0) {
      box.style.display = "block";
      box.innerHTML = '<div class="orders1c-search-empty">По запросу <b>' + escapeHtml(q) + "</b> заказов не найдено</div>";
      return;
    }
    box.style.display = "block";
    box.innerHTML = list
      .map(function (o) {
        var amountLabel = o.amount != null ? (o.amount + " ₽") : "—";
        return (
          '<div class="orders1c-search-card">' +
          '<div class="orders1c-search-title">№ 1С: ' + escapeHtml(String(o.order_1c_id || "")) + "</div>" +
          '<div class="orders1c-search-meta">Статус: <b>' + escapeHtml(statusForSearchLabel(o.status)) + "</b></div>" +
          '<div class="orders1c-search-meta">Дата доставки: ' + escapeHtml(o.order_date || "—") + "</div>" +
          '<div class="orders1c-search-meta">Водитель: ' + escapeHtml(getDriverName(o)) + "</div>" +
          '<div class="orders1c-search-meta">Клиент: ' + escapeHtml((o.customer_name || "—") + (o.phone ? " (" + o.phone + ")" : "")) + "</div>" +
          '<div class="orders1c-search-meta">Адрес: ' + escapeHtml(o.delivery_address || "—") + "</div>" +
          '<div class="orders1c-search-meta">Товар: ' + escapeHtml(formatItems(o.items)) + "</div>" +
          '<div class="orders1c-search-meta">Сумма: ' + escapeHtml(amountLabel) + "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  async function loadDriverNameMap(client, list) {
    var ids = [];
    (list || []).forEach(function (o) {
      if (o && o.assigned_driver_id != null && ids.indexOf(Number(o.assigned_driver_id)) === -1) {
        ids.push(Number(o.assigned_driver_id));
      }
    });
    if (ids.length === 0) return;
    var resp = await client.from("drivers").select("id, name").in("id", ids);
    if (resp && !resp.error) {
      (resp.data || []).forEach(function (d) {
        driverNameById[String(d.id)] = d.name || ("ID " + d.id);
      });
    }
  }

  function updateSelectionUI() {
    var countEl = document.getElementById("orders1cSelectedCount");
    var btnEl = document.getElementById("orders1cMoveToMapBtn");
    if (countEl) countEl.textContent = "Выбрано: " + selectedIds.size;
    if (btnEl) btnEl.disabled = selectedIds.size === 0;
  }

  function updateSelectAllState() {
    var selectAll = document.getElementById("orders1cSelectAll");
    if (!selectAll) return;
    var list = filteredOrders().filter(function (o) { return !!MAP_ALLOWED_STATUSES[o.status || "new"] && !o.delivery_locked; });
    var checkedCount = list.filter(function (o) { return selectedIds.has(o.id); }).length;
    selectAll.checked = list.length > 0 && checkedCount === list.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < list.length;
  }

  async function loadOrders() {
    var client = getSupabaseClient();
    var tbody = document.getElementById("orders1cTableBody");
    if (!client) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--danger);">Не настроен Supabase</td></tr>';
      return;
    }

    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);">Загрузка...</td></tr>';

    var selectedDate = getSelectedDate();
    try {
      var selectFields = _deliveryLockColumnMissing
        ? "id, order_1c_id, order_date, customer_name, delivery_address, phone, delivery_time_slot, items, amount, status, assigned_driver_id, sync_1c_state, sync_1c_last_error, sync_1c_retry_count, sync_1c_updated_at, sync_1c_status_sent"
        : "id, order_1c_id, order_date, customer_name, delivery_address, phone, delivery_time_slot, items, amount, status, assigned_driver_id, delivery_locked, sync_1c_state, sync_1c_last_error, sync_1c_retry_count, sync_1c_updated_at, sync_1c_status_sent";
      var resp = await client
        .from("customer_orders")
        .select(selectFields)
        .eq("order_date", selectedDate)
        .order("id", { ascending: true });
      if (resp.error && !_deliveryLockColumnMissing && String(resp.error.message || "").indexOf("delivery_locked") !== -1) {
        _deliveryLockColumnMissing = true;
        resp = await client
          .from("customer_orders")
          .select("id, order_1c_id, order_date, customer_name, delivery_address, phone, delivery_time_slot, items, amount, status, assigned_driver_id, sync_1c_state, sync_1c_last_error, sync_1c_retry_count, sync_1c_updated_at, sync_1c_status_sent")
          .eq("order_date", selectedDate)
          .order("id", { ascending: true });
      }

      if (resp.error) throw resp.error;
      var raw = resp.data || [];
      if (_deliveryLockColumnMissing) {
        raw = raw.map(function (o) {
          o.delivery_locked = false;
          return o;
        });
      }
      await loadDriverNameMap(client, raw);
      orders = raw.slice().sort(function (a, b) {
        var pa = STATUS_SORT_ORDER[a.status] !== undefined ? STATUS_SORT_ORDER[a.status] : 6;
        var pb = STATUS_SORT_ORDER[b.status] !== undefined ? STATUS_SORT_ORDER[b.status] : 6;
        if (pa !== pb) return pa - pb;
        return (b.id || 0) - (a.id || 0);
      });
      var hintEl = document.getElementById("orders1cDateHint");
      if (hintEl) {
        hintEl.textContent = orders.length === 0
          ? "На эту дату заказов нет"
          : "На выбранную дату: " + orders.length + " заказ(ов)";
      }
      renderTimeFilterOptions();
      renderTable();
      renderSearchResults([], "");
      updateSelectAllState();
    } catch (e) {
      console.error("orders1c load error", e);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--danger);">Ошибка: ' + escapeHtml(e.message || String(e)) + "</td></tr>";
    }
  }

  function exportOrdersToExcelCsv() {
    if (!orders || orders.length === 0) {
      alert("Нет данных для выгрузки");
      return;
    }
    var rows = [];
    rows.push([
      "Дата доставки",
      "№ заказа 1С",
      "Статус доставки",
      "Водитель",
    ]);
    orders.forEach(function (o) {
      rows.push([
        o.order_date || "",
        o.order_1c_id || "",
        STATUS_LABELS[o.status] || o.status || "",
        getDriverName(o),
      ]);
    });
    var csv = "\uFEFF" + rows.map(function (row) {
      return row.map(csvEscape).join(";");
    }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var dateLabel = getSelectedDate() || todayStr();
    a.href = url;
    a.download = "orders_1c_" + dateLabel + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function searchByOrderNumber() {
    var query = getSearchQuery();
    if (!query) {
      renderSearchResults([], "");
      return;
    }
    var client = getSupabaseClient();
    if (!client) {
      alert("Не настроен Supabase");
      return;
    }
    try {
      var resp = await client
        .from("customer_orders")
        .select("id, order_1c_id, order_date, customer_name, delivery_address, phone, items, amount, status, assigned_driver_id")
        .ilike("order_1c_id", "%" + query + "%")
        .order("order_date", { ascending: false })
        .limit(20);
      if (resp.error) throw resp.error;
      var result = resp.data || [];
      await loadDriverNameMap(client, result);
      renderSearchResults(result, query);
    } catch (e) {
      console.error("orders1c search error", e);
      alert("Ошибка поиска: " + (e.message || String(e)));
    }
  }

  async function retryOrder1CSync(orderId) {
    var order = orders.find(function (o) { return Number(o.id) === Number(orderId); });
    if (!order || !order.order_1c_id) {
      alert("Для этого заказа нет номера 1С");
      return;
    }
    var client = getSupabaseClient();
    var config = window.SUPABASE_CONFIG || {};
    if (!client || !config.url) {
      alert("Не настроен Supabase");
      return;
    }
    var statusToSend = order.status || "assigned";
    var nextRetry = Number(order.sync_1c_retry_count || 0) + 1;
    var lockPatch = {};
    if (statusToSend === "delivered") lockPatch.delivery_locked = true;
    if (statusToSend === "cancelled") lockPatch.delivery_locked = false;
    await client.from("customer_orders").update({
      sync_1c_state: "pending",
      sync_1c_last_error: null,
      sync_1c_status_sent: statusToSend,
      sync_1c_updated_at: new Date().toISOString(),
      ...lockPatch,
    }).eq("id", order.id);

    var fnUrl = (config.url || "").replace(/\/$/, "") + "/functions/v1/push-order-status-to-1c";
    var hdrs = { "Content-Type": "application/json" };
    if (config.anonKey) hdrs.Authorization = "Bearer " + config.anonKey;
    try {
      var response = await fetch(fnUrl, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ order_1c_id: order.order_1c_id, status: statusToSend }),
      });
      var payload = {};
      try { payload = await response.json(); } catch (_) {}
      if (!response.ok || payload.ok === false || payload.sent === false) {
        var errText = (payload && (payload.error || payload.message)) || ("HTTP " + response.status);
        throw new Error(errText);
      }
      await client.from("customer_orders").update({
        sync_1c_state: "ok",
        sync_1c_last_error: null,
        sync_1c_status_sent: statusToSend,
        sync_1c_updated_at: new Date().toISOString(),
        ...lockPatch,
      }).eq("id", order.id);
    } catch (err) {
      await client.from("customer_orders").update({
        sync_1c_state: "error",
        sync_1c_last_error: (err && err.message) ? err.message : String(err),
        sync_1c_retry_count: nextRetry,
        sync_1c_status_sent: statusToSend,
        sync_1c_updated_at: new Date().toISOString(),
        ...lockPatch,
      }).eq("id", order.id);
      alert("Ошибка синхронизации с 1С: " + ((err && err.message) ? err.message : String(err)));
    } finally {
      loadOrders();
    }
  }

  async function moveToMap() {
    var list = orders.filter(function (o) { return selectedIds.has(o.id); });
    if (list.length === 0) return;
    var allowed = list.filter(function (o) { return !!MAP_ALLOWED_STATUSES[o.status || "new"] && !o.delivery_locked; });
    var blocked = list.filter(function (o) { return !MAP_ALLOWED_STATUSES[o.status || "new"] || o.delivery_locked; });
    if (blocked.length > 0) {
      var blockedNums = blocked.map(function (o) { return String(o.order_1c_id || o.id); }).join(", ");
      alert("Эти заказы нельзя повторно отправить в доставку: " + blockedNums);
    }
    if (allowed.length === 0) return;

    var client = getSupabaseClient();
    if (client) {
      var ids = allowed.map(function (o) { return o.id; });
      var upd = client
        .from("customer_orders")
        .update({ status: "on_map" })
        .in("id", ids)
        .in("status", ["new", "cancelled", "on_map"]);
      if (!_deliveryLockColumnMissing) upd = upd.eq("delivery_locked", false);
      var resp = await upd;
      if (resp.error && !_deliveryLockColumnMissing && String(resp.error.message || "").indexOf("delivery_locked") !== -1) {
        _deliveryLockColumnMissing = true;
        resp = await client
          .from("customer_orders")
          .update({ status: "on_map" })
          .in("id", ids)
          .in("status", ["new", "cancelled", "on_map"]);
      }
      if (resp.error) {
        if (resp.error.message && resp.error.message.indexOf("violates check constraint") !== -1) {
          alert("Не удалось поставить статус «На карте». Примените миграцию 032 (статус on_map) в Supabase → SQL Editor.");
        } else {
          alert("Ошибка обновления статуса: " + (resp.error.message || "неизвестно"));
        }
        return;
      }
      loadOrders();
    }

    window.__dcPending1COrders = allowed.map(function (o) {
      return {
        id: o.id,
        order_1c_id: o.order_1c_id || "",
        delivery_address: o.delivery_address || "",
        phone: o.phone || "",
        delivery_time_slot: o.delivery_time_slot || "",
      };
    });

    if (typeof window.switchSection === "function") {
      window.switchSection("distribution");
    }

    setTimeout(function () {
      if (window.DistributionUI && typeof window.DistributionUI.applyPending1COrders === "function") {
        window.DistributionUI.applyPending1COrders();
      }
    }, 150);
  }

  function bindEvents() {
    var refreshBtn = document.getElementById("orders1cRefreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", function () { loadOrders(); });

    var exportBtn = document.getElementById("orders1cExportBtn");
    if (exportBtn) exportBtn.addEventListener("click", function () { exportOrdersToExcelCsv(); });

    var searchBtn = document.getElementById("orders1cSearchBtn");
    if (searchBtn) searchBtn.addEventListener("click", function () { searchByOrderNumber(); });

    var searchInput = document.getElementById("orders1cSearchInput");
    if (searchInput) {
      searchInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          searchByOrderNumber();
        }
      });
    }

    var moveBtn = document.getElementById("orders1cMoveToMapBtn");
    if (moveBtn) moveBtn.addEventListener("click", function () { moveToMap(); });

    var statusFilter = document.getElementById("orders1cStatusFilter");
    if (statusFilter) statusFilter.addEventListener("change", function () { renderTable(); updateSelectAllState(); });

    var timeFilter = document.getElementById("orders1cTimeFilter");
    if (timeFilter) timeFilter.addEventListener("change", function () { renderTable(); updateSelectAllState(); });

    var selectAll = document.getElementById("orders1cSelectAll");
    if (selectAll) {
      selectAll.addEventListener("change", function () {
        var list = filteredOrders().filter(function (o) { return !!MAP_ALLOWED_STATUSES[o.status || "new"] && !o.delivery_locked; });
        if (selectAll.checked) {
          list.forEach(function (o) { selectedIds.add(o.id); });
        } else {
          list.forEach(function (o) { selectedIds.delete(o.id); });
        }
        renderTable();
        updateSelectAllState();
      });
    }
  }

  function ensureRealtimeSubscription() {
    if (realtimeChannel) return;
    var client = getSupabaseClient();
    if (!client) return;
    realtimeChannel = client
      .channel("dc-orders1c")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "customer_orders" },
        function () {
          loadOrders();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "customer_orders" },
        function () {
          loadOrders();
        }
      )
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          console.log("[Orders1C] Realtime подписка на customer_orders активна");
        }
      });
  }

  function refresh() {
    var dateEl = document.getElementById("orders1cDateFilter");
    if (dateEl && !dateEl.value) dateEl.value = todayStr();
    loadOrders();
    ensureRealtimeSubscription();
  }

  bindEvents();

  document.getElementById("orders1cDateFilter") && document.getElementById("orders1cDateFilter").addEventListener("change", function () {
    loadOrders();
  });

  window.Orders1C = {
    refresh: refresh,
    loadOrders: loadOrders,
  };
})();
