# Инструкция для программиста 1С: интеграция с DriveControl через Supabase

Во всех запросах используй один и тот же ключ: `Authorization: Bearer <SUPABASE_ANON_KEY>` (Settings → API → Publishable key).

---

## Часть A. Отправка заказов в DriveControl

### A.1. Эндпоинт

- **URL**: `https://mrdicoctfaxdrmoluqpi.supabase.co/functions/v1/receive-1c-order`
- **Метод**: `POST`
- **Заголовки**: `Authorization: Bearer <SUPABASE_ANON_KEY>`, `Content-Type: application/json`

### A.2. Один заказ (тело запроса)

```json
{
  "order_1c_id": "ДОГ-2026-000123",
  "order_date": "2026-03-04",
  "customer_name": "ООО Ромашка",
  "delivery_address": "г. Минск, ул. Пушкина, 10",
  "phone": "+375291234567",
  "items": [
    { "sku": "0001", "name": "Товар 1", "qty": 2, "price": 10.5 },
    { "sku": "0002", "name": "Товар 2", "qty": 1, "price": 5.0 }
  ],
  "amount": 26.0
}
```

**Обязательные поля:** `order_1c_id`, `delivery_address`. Остальные — по возможности. Если нет `order_date`, подставится текущая дата.

### A.3. Приём пачкой (несколько заказов за один запрос)

Тело — объект с массивом `orders`:

```json
{
  "orders": [
    {
      "order_1c_id": "ДОГ-2026-000121",
      "delivery_address": "г. Минск, ул. Ленина, 1",
      "customer_name": "ИП Иванов",
      "phone": "+375291111111",
      "amount": 100.50
    },
    {
      "order_1c_id": "ДОГ-2026-000122",
      "delivery_address": "г. Минск, пр-т Независимости, 50",
      "order_date": "2026-03-04",
      "items": [],
      "amount": 250.00
    }
  ]
}
```

В массиве обрабатываются только элементы, у которых есть `order_1c_id` и `delivery_address`. Остальные поля в каждом элементе — те же, что и для одного заказа (опционально).

**Ответ при пачке:** `200 OK`, тело: `{ "ok": true, "accepted": 2 }` (число принятых заказов).

### A.4. Ответы при отправке заказов

- **Успех:** `200 OK`, `{ "ok": true }` или `{ "ok": true, "accepted": N }`.
- **Ошибки:** `400` — некорректный JSON или нет обязательных полей (`invalid_json`, `missing_fields`); `500` — ошибка БД (`db_error`).

По одному и тому же `order_1c_id` заказ обновляется, а не дублируется (идемпотентность).

---

## Часть B. Получение статусов заказов в 1С

Логист и водители меняют статусы в DriveControl. 1С может периодически опрашивать эндпоинт и забирать актуальные статусы.

### B.1. Эндпоинт

- **URL**: `https://mrdicoctfaxdrmoluqpi.supabase.co/functions/v1/get-order-statuses`
- **Метод**: `GET`
- **Заголовки**: `Authorization: Bearer <SUPABASE_ANON_KEY>`

### B.2. Параметры запроса (все опциональны)

| Параметр     | Описание |
|-------------|----------|
| `date`      | Дата заказов в формате `YYYY-MM-DD`. Пример: `?date=2026-03-04` |
| `order_ids` | Список номеров сделок через запятую. Пример: `?order_ids=ДОГ-2026-000121,ДОГ-2026-000122` |
| `since`     | Вернуть только заказы, у которых статус обновлён не раньше этой даты/времени (ISO 8601). Пример: `?since=2026-03-04T10:00:00Z` |

Параметры можно комбинировать, например:  
`?date=2026-03-04&since=2026-03-04T08:00:00Z`

### B.3. Формат ответа

Тело ответа — JSON:

```json
{
  "orders": [
    {
      "order_1c_id": "ДОГ-2026-000121",
      "status": "sold",
      "status_updated_at": "2026-03-04T14:30:00.000Z",
      "driver_id": 2,
      "order_date": "2026-03-04"
    },
    {
      "order_1c_id": "ДОГ-2026-000122",
      "status": "refused",
      "status_updated_at": "2026-03-04T15:00:00.000Z",
      "driver_id": null,
      "order_date": "2026-03-04"
    }
  ]
}
```

**Возможные значения `status`:** `new`, `assigned`, `sold`, `not_sold`, `refused`, `returned`.

Рекомендуемый сценарий для 1С: периодический опрос с параметром `since` (время последнего успешного опроса), обработка только изменившихся заказов и обновление своих документов/списаний.

---

## Проверка в Postman

1. **Отправка одного заказа**  
   - URL: `https://mrdicoctfaxdrmoluqpi.supabase.co/functions/v1/receive-1c-order`, метод **POST**.  
   - Headers: `Authorization: Bearer <SUPABASE_ANON_KEY>`, `Content-Type: application/json`.  
   - Body → raw → JSON: `{ "order_1c_id": "TEST-0001", "delivery_address": "г. Минск, ул. Пушкина, 10" }`.  
   - Ожидается: `200`, `{ "ok": true }`.

2. **Отправка пачки**  
   - Тот же URL и заголовки.  
   - Body: `{ "orders": [ { "order_1c_id": "TEST-0002", "delivery_address": "адрес 1" }, { "order_1c_id": "TEST-0003", "delivery_address": "адрес 2" } ] }`.  
   - Ожидается: `200`, `{ "ok": true, "accepted": 2 }`.

3. **Получение статусов**  
   - URL: `https://mrdicoctfaxdrmoluqpi.supabase.co/functions/v1/get-order-statuses?date=2026-03-04`, метод **GET**.  
   - Header: `Authorization: Bearer <SUPABASE_ANON_KEY>`.  
   - Ожидается: `200`, тело с массивом `orders`.
