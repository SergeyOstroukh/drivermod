-- Гарантировать доступ на чтение для anon (приложение с anon key)
-- Если заказы есть в Table Editor, но не показываются на вкладке — обычно мешает RLS без политики для anon.

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to customer_orders" ON public.customer_orders;
CREATE POLICY "Allow all access to customer_orders" ON public.customer_orders
    FOR ALL
    USING (true)
    WITH CHECK (true);
