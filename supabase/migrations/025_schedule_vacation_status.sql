-- Добавить статус "отпуск" (vacation) в driver_schedule
ALTER TABLE public.driver_schedule DROP CONSTRAINT IF EXISTS driver_schedule_status_check;
ALTER TABLE public.driver_schedule ADD CONSTRAINT driver_schedule_status_check 
  CHECK (status IN ('work', 'off', 'sick', 'extra', 'vacation'));
