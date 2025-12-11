-- Добавление полей для дат начала действия страховки и техосмотра
-- А также для информации о замене масла

ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS inspection_start DATE;

ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS insurance_start DATE;

ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS oil_change_mileage INTEGER;

