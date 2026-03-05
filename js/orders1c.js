/**
 * Вкладка "Заказы из 1С": загрузка customer_orders на сегодня, фильтры, выбор, перенос на карту.
 */
(function () {
  "use strict";

  const STATUS_LABELS = {
    new: "Не распределён",
    assigned: "Распределён",
    in_delivery: "В доставке",
    delivered: "Доставлен",
    cancelled: "Отменён",
  };

  let orders = [];
  let selectedIds = new Set();

  function getSupabaseClient() {
    var config = window.SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) return null;
    if (!window._dcSupabase) {
      window._dcSupabase = supabase.createClient(config.url, config.anonKey);
    }
    return window._dcSupabase;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function getStatusFilter() {
    var el = document.getElementById("orders1cStatusFilter");
    return el ? (el.value || "").trim() : "";
  }

  function getTimeFilter() {
    var el = document.getElementById("orders1cTimeFilter");
    return el ? (el.value || "").trim() : "";
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

  function renderTable() {
    var tbody = document.getElementById("orders1cTableBody");
    if (!tbody) return;

    var list = filteredOrders();
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);">Нет заказов на сегодня</td></tr>';
      updateSelectionUI();
      return;
    }

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);">Нет заказов по выбранным фильтрам</td></tr>';
      updateSelectionUI();
      return;
    }

    tbody.innerHTML = list
      .map(function (o) {
        var checked = selectedIds.has(o.id) ? ' checked="checked"' : "";
        var statusLabel = STATUS_LABELS[o.status] || o.status;
        var itemsStr = o.items != null ? (typeof o.items === "string" ? o.items : JSON.stringify(o.items)) : "";
        var itemsDisplay = [itemsStr, o.amount != null ? o.amount + " ₽" : ""].filter(Boolean).join(" · ") || "—";
        return (
          "<tr data-order-id=\"" +
          o.id +
          "\">" +
          '<td><input type="checkbox" class="orders1c-row-cb" data-id="' +
          o.id +
          '"' +
          checked +
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

    updateSelectionUI();
    updateSelectAllState();
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
    var list = filteredOrders();
    var checkedCount = list.filter(function (o) { return selectedIds.has(o.id); }).length;
    selectAll.checked = list.length > 0 && checkedCount === list.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < list.length;
  }

  async function loadOrders() {
    var client = getSupabaseClient();
    var tbody = document.getElementById("orders1cTableBody");
    if (!client) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Не настроен Supabase</td></tr>';
      return;
    }

    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);">Загрузка...</td></tr>';

    var today = todayStr();
    try {
      var resp = await client
        .from("customer_orders")
        .select("id, order_1c_id, order_date, customer_name, delivery_address, phone, delivery_time_slot, items, amount, status")
        .eq("order_date", today)
        .order("id", { ascending: true });

      if (resp.error) throw resp.error;
      orders = resp.data || [];
      renderTimeFilterOptions();
      renderTable();
      updateSelectAllState();
    } catch (e) {
      console.error("orders1c load error", e);
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Ошибка: ' + escapeHtml(e.message || String(e)) + "</td></tr>";
    }
  }

  function moveToMap() {
    var list = orders.filter(function (o) { return selectedIds.has(o.id); });
    if (list.length === 0) return;

    window.__dcPending1COrders = list.map(function (o) {
      return {
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

    var moveBtn = document.getElementById("orders1cMoveToMapBtn");
    if (moveBtn) moveBtn.addEventListener("click", function () { moveToMap(); });

    var statusFilter = document.getElementById("orders1cStatusFilter");
    if (statusFilter) statusFilter.addEventListener("change", function () { renderTable(); updateSelectAllState(); });

    var timeFilter = document.getElementById("orders1cTimeFilter");
    if (timeFilter) timeFilter.addEventListener("change", function () { renderTable(); updateSelectAllState(); });

    var selectAll = document.getElementById("orders1cSelectAll");
    if (selectAll) {
      selectAll.addEventListener("change", function () {
        var list = filteredOrders();
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

  function refresh() {
    loadOrders();
  }

  bindEvents();

  window.Orders1C = {
    refresh: refresh,
    loadOrders: loadOrders,
  };
})();
