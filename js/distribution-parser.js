/**
 * DriveControl — Address parser module
 * Parses pasted text into order objects.
 * Primary format: tab-separated: Address \t Phone \t Time
 */
(() => {
  "use strict";

  let orderCounter = 0;

  function isPhoneNumber(str) {
    if (!str) return false;
    const cleaned = str.trim();
    return /^[\d\s\-\+\(\),]{7,}$/.test(cleaned) && /\d{2}\s?\d{3}[\-\s]\d{2}[\-\s]\d{2}/.test(cleaned);
  }

  function cleanTimeSlot(str) {
    if (!str) return null;
    let time = str.trim();
    time = time.replace(/^[сc]\s*/i, '').trim();
    time = time.replace(/,.*$/, '').trim();
    if (/^\d{1,2}[:\.]?\d{0,2}\s*[-–]\s*\d{1,2}[:\.]?\d{0,2}$/.test(time)) {
      return time;
    }
    return null;
  }

  function cleanAddressForDisplay(address) {
    return address
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*$/, '')
      .trim();
  }

  function cleanAddressForGeocoding(address) {
    let clean = address;
    clean = clean.replace(/,?\s*кв\.?\s*\d*/gi, '');
    clean = clean.replace(/,?\s*под\.?\s*\d*/gi, '');
    clean = clean.replace(/,?\s*эт(?:аж)?\.?\s*\d*/gi, '');
    clean = clean.replace(/,?\s*корп\.?\s*(?:\d*)/gi, '');
    clean = clean.replace(/,?\s*чд\b/gi, '');
    clean = clean.replace(/(?:,\s*){2,}/g, ',');  // multiple commas → single
    clean = clean.replace(/,\s*$/, '');
    clean = clean.replace(/^\s*,/, '');
    clean = clean.replace(/\s+/g, ' ');
    return clean.trim();
  }

  function parseOrders(text) {
    if (!text || !text.trim()) return [];

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const orders = [];

    for (const line of lines) {
      if (/^(#|\/\/|адрес|address)/i.test(line)) continue;

      let address = '';
      let phone = '';
      let timeSlot = null;

      if (line.includes('\t')) {
        const parts = line.split('\t').map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length >= 3) {
          address = parts[0];
          phone = isPhoneNumber(parts[1]) ? parts[1] : '';
          const timePart = parts[parts.length - 1];
          timeSlot = cleanTimeSlot(timePart);
          if (!phone && parts.length > 2) {
            for (let i = 1; i < parts.length - 1; i++) {
              if (isPhoneNumber(parts[i])) { phone = parts[i]; break; }
            }
          }
        } else if (parts.length === 2) {
          address = parts[0];
          if (isPhoneNumber(parts[1])) { phone = parts[1]; }
          else { timeSlot = cleanTimeSlot(parts[1]); }
        } else {
          address = parts[0];
        }
      } else {
        const timePatterns = [
          /[,;]\s*[сc]?\s*(\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2})\s*$/i,
          /[,;]\s*[сc]?\s*(\d{1,2}\s*[-–]\s*\d{1,2})\s*$/i,
          /\((\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2})\)\s*$/,
          /\((\d{1,2}\s*[-–]\s*\d{1,2})\)\s*$/,
        ];
        address = line;
        for (const pattern of timePatterns) {
          const match = line.match(pattern);
          if (match) {
            timeSlot = match[1].trim();
            address = line.substring(0, match.index).trim().replace(/[,;]+$/, '').trim();
            break;
          }
        }
      }

      address = address.replace(/^\d+[\.):\-\s]+\s*/, '').trim();
      address = cleanAddressForDisplay(address);

      if (address.length > 0) {
        orderCounter++;
        orders.push({
          id: 'order-' + Date.now() + '-' + orderCounter,
          address: address,
          phone: phone,
          timeSlot: timeSlot,
          geocoded: false,
          lat: null,
          lng: null,
          formattedAddress: null,
          error: null,
          driverIndex: -1,
        });
      }
    }
    return orders;
  }

  // Export
  window.DistributionParser = {
    parseOrders: parseOrders,
    cleanAddressForGeocoding: cleanAddressForGeocoding,
  };
})();
