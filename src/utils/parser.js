/**
 * Parse pasted text into orders
 * Primary format: tab-separated: Address \t Phone \t Time
 * Also supports: "Address, time" or just "Address"
 */

let orderCounter = 0;

/**
 * Detect if a string looks like a phone number
 * Belarusian format: 29 346-78-92, 44 745-25-23, 33 694-87-76, 25 924-74-17
 */
function isPhoneNumber(str) {
  if (!str) return false;
  const cleaned = str.trim();
  // Match patterns like: 29 346-78-92 or +375 29 346-78-92 or multiple phones
  return /^[\d\s\-\+\(\),]{7,}$/.test(cleaned) && /\d{2}\s?\d{3}[\-\s]\d{2}[\-\s]\d{2}/.test(cleaned);
}

/**
 * Clean time slot string
 */
function cleanTimeSlot(str) {
  if (!str) return null;
  let time = str.trim();
  // Remove leading "с " prefix
  time = time.replace(/^[сc]\s*/i, '').trim();
  // Remove trailing comma and extra text after time
  time = time.replace(/,.*$/, '').trim();
  // Check if it looks like a time range
  if (/^\d{1,2}[:\.]?\d{0,2}\s*[-–]\s*\d{1,2}[:\.]?\d{0,2}$/.test(time)) {
    return time;
  }
  return null;
}

/**
 * Clean address for display (keep original but trim whitespace)
 */
function cleanAddressForDisplay(address) {
  return address
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/, '')
    .trim();
}

/**
 * Clean address for geocoding: strip apartment, entrance, floor details
 * Keep only street-level info
 */
export function cleanAddressForGeocoding(address) {
  let clean = address;

  // Remove apartment info: кв.56, кв 121
  clean = clean.replace(/,?\s*кв\.?\s*\d*/gi, '');
  // Remove entrance: под.1, подъезд 1
  clean = clean.replace(/,?\s*под\.?\s*\d*/gi, '');
  // Remove floor: этаж 9, эт 5, этаж
  clean = clean.replace(/,?\s*эт(?:аж)?\.?\s*\d*/gi, '');
  // Remove корп. (corpus) without number
  clean = clean.replace(/,?\s*корп\.?\s*(?:\d*)/gi, '');
  // Remove "чд" (частный дом)
  clean = clean.replace(/,?\s*чд\b/gi, '');
  // Clean up multiple commas, trailing commas, extra spaces
  clean = clean.replace(/,\s*,/g, ',');
  clean = clean.replace(/,\s*$/, '');
  clean = clean.replace(/\s+/g, ' ');
  clean = clean.trim();

  return clean;
}

export function parseOrders(text) {
  if (!text || !text.trim()) return [];

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const orders = [];

  for (const line of lines) {
    // Skip obvious headers/comments
    if (/^(#|\/\/|адрес|address)/i.test(line)) continue;

    let address = '';
    let phone = '';
    let timeSlot = null;

    // Check if line contains tabs (tab-separated format)
    if (line.includes('\t')) {
      const parts = line.split('\t').map(p => p.trim()).filter(p => p.length > 0);

      if (parts.length >= 3) {
        // Format: address \t phone \t time
        address = parts[0];
        phone = isPhoneNumber(parts[1]) ? parts[1] : '';
        // Time is the last part (or second-to-last if phone wasn't detected)
        const timePart = parts[parts.length - 1];
        timeSlot = cleanTimeSlot(timePart);
        // If phone wasn't in parts[1], the address might include extra parts
        if (!phone && parts.length > 2) {
          // Try to find phone in parts
          for (let i = 1; i < parts.length - 1; i++) {
            if (isPhoneNumber(parts[i])) {
              phone = parts[i];
              break;
            }
          }
        }
      } else if (parts.length === 2) {
        address = parts[0];
        // Second part could be phone or time
        if (isPhoneNumber(parts[1])) {
          phone = parts[1];
        } else {
          timeSlot = cleanTimeSlot(parts[1]);
        }
      } else {
        address = parts[0];
      }
    } else {
      // No tabs — try comma/semicolon separated, or just address
      // Try to extract time from end of line
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
          address = line.substring(0, match.index).trim();
          address = address.replace(/[,;]+$/, '').trim();
          break;
        }
      }
    }

    // Remove leading numbering like "1.", "1)", "1 -"
    address = address.replace(/^\d+[\.):\-\s]+\s*/, '').trim();

    // Clean address for display
    address = cleanAddressForDisplay(address);

    if (address.length > 0) {
      orderCounter++;
      orders.push({
        id: `order-${Date.now()}-${orderCounter}`,
        address,
        phone,
        timeSlot,
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
