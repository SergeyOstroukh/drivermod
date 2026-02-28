-- Автомобиль на ремонте: снимается водитель, в логе пробега — запись "ремонт"
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS on_repair BOOLEAN DEFAULT false;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS repair_since DATE;
COMMENT ON COLUMN public.vehicles.on_repair IS 'true = автомобиль на ремонте, водитель снят';
COMMENT ON COLUMN public.vehicles.repair_since IS 'дата постановки на ремонт';
