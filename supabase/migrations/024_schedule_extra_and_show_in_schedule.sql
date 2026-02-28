-- Скрыть водителя из графика (не показывать в таблице)
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS show_in_schedule BOOLEAN DEFAULT true;
COMMENT ON COLUMN public.drivers.show_in_schedule IS 'false = не показывать в графике смен';

-- Добавить статус "доп" (дополнительная смена) в driver_schedule
ALTER TABLE public.driver_schedule DROP CONSTRAINT IF EXISTS driver_schedule_status_check;
ALTER TABLE public.driver_schedule ADD CONSTRAINT driver_schedule_status_check 
  CHECK (status IN ('work', 'off', 'sick', 'extra'));
