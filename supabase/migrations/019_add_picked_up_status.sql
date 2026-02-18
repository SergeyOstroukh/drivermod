-- Разрешаем статус picked_up в telegram_confirmations
ALTER TABLE telegram_confirmations
  DROP CONSTRAINT IF EXISTS telegram_confirmations_status_check;

ALTER TABLE telegram_confirmations
  ADD CONSTRAINT telegram_confirmations_status_check
  CHECK (status IN ('sent', 'confirmed', 'rejected', 'picked_up'));
