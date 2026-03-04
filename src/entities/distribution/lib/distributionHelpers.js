/**
 * Вспомогательные функции для страницы распределения (как в js/distribution.js)
 */

export const SUPPLIER_ALIASES_KEY = 'dc_supplier_aliases';
export const PARTNER_ALIASES_KEY = 'dc_partner_aliases';
export const DRIVER_COLORS_KEY = 'dc_driver_colors';

export const COLOR_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#a855f7', '#84cc16', '#e11d48', '#0ea5e9', '#d946ef',
  '#10b981', '#facc15', '#f43f5e', '#2dd4bf', '#c084fc',
  '#fb923c', '#4ade80', '#38bdf8', '#a3e635', '#fbbf24',
];

const ORG_FORM_RE =
  /^\s*(?:общество\s+с\s+ограниченной\s+ответственностью|частное\s+предприятие|частное\s+унитарное\s+предприятие|частное\s+торговое\s+унитарное\s+предприятие|частное\s+производственное\s+унитарное\s+предприятие|индивидуальный\s+предприниматель|закрытое\s+акционерное\s+общество|открытое\s+акционерное\s+общество|публичное\s+акционерное\s+общество|акционерное\s+общество|ООО|ОДО|ЧУП|УП|ИП|ЗАО|ОАО|ПАО|АО|ЧТУП|СООО|ИООО|ЧП|СП|ФГУП|МУП)\s*/i;

/** ООО "Название" → Название */
export function stripOrgForm(s) {
  let cleaned = String(s || '');
  let prev;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(ORG_FORM_RE, '');
  } while (cleaned !== prev);
  const quotedMatch = cleaned.match(/[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]\s*([^«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]{2,}?)\s*[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]/);
  if (quotedMatch && quotedMatch[1]) cleaned = quotedMatch[1];
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/^\s*[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]+\s*/g, '');
  } while (cleaned !== prev);
  cleaned = cleaned.replace(/[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]/g, '');
  return cleaned.trim();
}

/** "Название до 14" → { name: "Название", timeSlot: "до 14" } */
export function extractSupplierTimeSlot(line) {
  const normalizedLine = String(line || '').replace(
    /([«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂])(?=(?:до|после|с)\s+\d)/gi,
    '$1 '
  );
  const timeMatch = normalizedLine.match(
    /\s+(до\s+\d{1,2}(?:[:.]\d{2})?|после\s+\d{1,2}(?:[:.]\d{2})?|с\s+\d{1,2}(?:[:.]\d{2})?\s*(?:до|[-–])\s*\d{1,2}(?:[:.]\d{2})?)\s*$/i
  );
  if (timeMatch) {
    return {
      name: normalizedLine.substring(0, timeMatch.index).trim(),
      timeSlot: timeMatch[1].trim(),
    };
  }
  return { name: normalizedLine.trim(), timeSlot: null };
}

/** Компактная строка для сравнения (без пробелов, кавычек, ё→е) */
export function compactName(s) {
  let c = String(s ?? '').toLowerCase();
  let prev;
  do {
    prev = c;
    c = c.replace(ORG_FORM_RE, '');
  } while (c !== prev);
  const coreQuoted = c.match(/[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]\s*([^«»"""''\"\'„"‟❝❞⹂〝〞〟＂]{2,}?)\s*[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]/);
  if (coreQuoted && coreQuoted[1]) c = coreQuoted[1];
  do {
    prev = c;
    c = c.replace(/^\s*[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]+\s*/g, '');
  } while (c !== prev);
  c = c.replace(/[«»"""''\"\'„"‟❝❞⹂〝〞〟＂\s\-–—.,;:!?()[\]{}/\\+&]/g, '');
  c = c.replace(/ё/g, 'е');
  return c;
}

/** Найти поставщика в БД: алиас → exact → partial */
export function findSupplierInDb(name, dbSuppliers, supplierAliases, compactNameFn = compactName) {
  const n = compactNameFn(name);
  if (!n || n.length < 2) return null;
  const aliasId = supplierAliases[n];
  if (aliasId != null) {
    const aliasMatch = dbSuppliers.find((s) => String(s.id) === String(aliasId));
    if (aliasMatch) return aliasMatch;
  }
  const exact = dbSuppliers.find((s) => compactNameFn(s.name) === n);
  if (exact) return exact;
  const partial = dbSuppliers.find((s) => {
    const sn = compactNameFn(s.name);
    if (!sn) return false;
    const longer = Math.max(sn.length, n.length);
    const shorter = Math.min(sn.length, n.length);
    if (shorter / longer < 0.7) return false;
    return sn.includes(n) || n.includes(sn);
  });
  return partial ?? null;
}

/** Найти партнёра в БД: алиас → exact → partial */
export function findPartnerInDb(name, dbPartners, partnerAliases, compactNameFn = compactName) {
  const n = compactNameFn(name);
  if (!n || n.length < 2) return null;
  const aliasId = partnerAliases[n];
  if (aliasId != null) {
    const aliasMatch = dbPartners.find((p) => String(p.id) === String(aliasId));
    if (aliasMatch) return aliasMatch;
  }
  const exact = dbPartners.find((p) => compactNameFn(p.name) === n);
  if (exact) return exact;
  const partial = dbPartners.find((p) => {
    const pn = compactNameFn(p.name);
    if (!pn) return false;
    const longer = Math.max(pn.length, n.length);
    const shorter = Math.min(pn.length, n.length);
    if (shorter / longer < 0.7) return false;
    return pn.includes(n) || n.includes(pn);
  });
  return partial ?? null;
}

export function loadJson(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}
