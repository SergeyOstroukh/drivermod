# Чеклист: миграция страницы «Распределение» с нативного JS на React

Сравнение блоков кода старой версии (`js/distribution.js`, `js/distribution-geocoder.js`, `js/distribution-algo.js`, `js/distribution-parser.js`) с новой (`src/pages/distribution/`, `src/widgets/map/`).

---

## Данные и состояние

| Блок (старая версия) | В новой версии | Примечание |
|----------------------|----------------|------------|
| `orders`, `assignments`, `variants`, `activeVariant` | ✅ `orders`, `assignments`, `variants`, `activeVariant` | Есть |
| `driverCount`, `selectedDriver`, `driverSlots` | ✅ | Есть |
| `dbDrivers`, `dbSuppliers`, `dbPartners` | ✅ | Есть |
| `supplierAliases`, `partnerAliases` (localStorage) | ❌ | Нет — привязка «введённое имя → id» для поставщика/партнёра |
| `supplierInputDraft`, `partnerInputDraft`, `addressInputDraft` | ⚠️ | Частично: только `supplierNamesText`, `partnerNamesText`, `rawText` |
| `editingDriverId` (режим редактирования маршрута водителя) | ❌ | Нет отдельного режима «редактирование: Водитель X» |
| `_hideAssigned`, `_hideConfirmed`, `_supplierTelegramFilter` | ❌ | Нет фильтров «Скрыть распред.», «Скрыть ✅», TG: все/отправлены/не отправлены |
| `driverCustomColors`, `COLOR_PALETTE`, `showColorPalette` | ❌ | Нет кастомных цветов водителей и палитры по клику на кружок |
| `_supplierListOpen`, `_partnerListOpen`, `_addressListOpen`, `_driversListOpen` | ⚠️ | Частично: details open только у водителей |
| `poiCoords` (кэш геокода POI) | ✅ `poiCoords` | Есть |

---

## Загрузка данных

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `loadDbDrivers`, `loadDbSuppliers`, `loadDbPartners` | ✅ | Один раз при монтировании (fetchDrivers, fetchSuppliers, fetchPartners) |
| `loadSupplierOrders` (supplier_orders: товар от 1С) | ❌ | Нет кэша заказов поставщиков по дате |
| `getSupplierItems(supplierName)` | ❌ | Нет |
| `loadCustomerOrdersFrom1C` | ✅ | Есть как «Обновить из 1С» (handleRefresh1C) |
| `refreshSupplierItems`, `startItemsPolling`, `stopItemsPolling` | ❌ | Нет опроса товара от 1С для поставщиков |
| `loadSupplierAliases`, `loadPartnerAliases` (при открытии вкладки) | ❌ | Нет |
| `loadBestAvailableState` (localStorage + cloud) | ❌ | Нет восстановления состояния при открытии |

---

## Сохранение состояния (localStorage + Supabase)

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `saveState`, `buildStateSnapshot`, `buildStateSignature` | ❌ | Нет сохранения в localStorage |
| `readLocalState`, `loadState`, `applyStateSnapshot` | ❌ | Нет |
| `loadCloudState`, `saveCloudState`, `scheduleCloudStateSave`, `flushCloudStateSave` | ❌ | Нет таблицы `distribution_state` и синхронизации |
| `pullCloudStateIfNewer`, `startCloudStatePolling`, `startCloudRealtimeSync` | ❌ | Нет |
| `clearCloudState`, `clearState` | ⚠️ | Есть только сброс локального state в модалке «Сбросить данные» |
| `visibilitychange`, `beforeunload` (flush cloud) | ❌ | Нет |

---

## Поиск и привязка поставщиков/партнёров

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `compactName` (нормализация для поиска) | ✅ | Упрощённый вариант есть |
| `stripOrgForm` (ООО «Название» → Название) | ❌ | Нет |
| `extractSupplierTimeSlot` («Название до 14» → name + timeSlot) | ❌ | Нет — время из строки поставщика не вытаскивается |
| `findSupplierInDb` (alias → exact → partial) | ❌ | Нет поиска по алиасам и «похожести» при загрузке поставщиков |
| `findPartnerInDb`, `findPartnerInDbRemote` | ❌ | Нет при загрузке партнёров |
| `searchSuppliers`, `searchPartners` (автокомплит) | ✅ | Есть в сайдбаре (supplierSuggestResults, partnerSuggestResults) |
| `rememberSupplierAlias`, `rememberPartnerAlias` | ❌ | Нет сохранения привязки имя→id |
| `openSupplierSearch` (модалка поиска поставщика по заказу «Не найден») | ❌ | Нет модалки «найти в базе» по клику на заказ |
| `openPartnerSearch` (модалка поиска партнёра «Не выбран») | ❌ | Нет |
| `linkSupplierToOrder`, `linkPartnerToOrder` | ❌ | Нет привязки заказа к выбранному поставщику/партнёру из базы |
| `createSupplierFromOrder`, `openCreatePartnerModal` | ❌ | Нет «+ В базу» / «+ Новый партнёр» из распределения |

---

## Загрузка списков (адреса, поставщики, партнёры)

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `loadAddresses` (парсинг + геокодинг, с сохранением поставщиков при «Заменить») | ✅ | Есть handleLoadAddresses, handleAppendAddresses |
| `loadSuppliers` (по именам: findSupplierInDb, координаты из БД или geocode, items1c) | ⚠️ | Есть handleAddSuppliersByNames, но без stripOrgForm, extractSupplierTimeSlot, findSupplierInDb, items1c |
| `loadPartners` (по именам: findPartnerInDb, геокод адреса партнёра) | ⚠️ | Есть handleAddPartnersByNames, логика упрощена |
| Парсер адресов (DistributionParser.parseOrders) | ✅ | Используется parseOrders из entities/order |

---

## Алгоритм распределения и варианты

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `generateVariants` (DistributionAlgo) | ✅ | Есть |
| `distribute(selectedDriverIds)` (назначение по слотам, сохранение preAssigned) | ✅ | Есть handleDistribute |
| `selectVariant(idx)` | ✅ | Есть handleSelectVariant |
| Сброс только адресов/только поставщиков при «Заменить» | ⚠️ | В старой при замене адресов сохраняются поставщики; в React логика есть в handleLoadAddresses |

---

## Водители и назначение

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `getOrderDriverId(idx)` (assignedDriverId || driverSlots[assignments[idx]]) | ⚠️ | В React только через driverSlots[assignments[idx]]; прямого assignedDriverId в заказе нет |
| `getOrderSlotIdx`, `getDriverName`, `getDriverNameById`, `getDriverFullName` | ⚠️ | Частично через driverRoutes и слоты |
| `__dc_assign` (по индексу слота) | ✅ | Есть как onAssignDriver(slotIdx) |
| `__dc_assignDirect` (по driver_id + кнопка «Снять») | ❌ | В балуне только по slot index; кнопки «Снять» и выбора по dbDrivers по id нет |
| Режим редактирования водителя (editingDriverId, кнопка «Готово») | ❌ | Нет |
| `bulkAssignSelectedToDriver` | ✅ | Есть handleBulkAssign |
| `toggleSelectedOrder`, `pruneSelectedOrders` | ✅ | selectedOrderIds, снятие выбора |
| Выбор на карте (mapSelectMode, клик по маркеру) | ✅ | mapSelectMode есть; привязка клика по маркеру к выбору нужно проверить в YandexMapView |
| `scheduleSyncDriver`, `syncDriverToDb` | ⚠️ | В React есть синхронизация маршрутов в БД через syncDriverRoute в useEffect |

---

## Карта

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `initMap`, контейнер `#distributionMap` | ✅ | Есть в YandexMapView |
| `updatePlacemarks` (очистка, overlapOffsets, разные иконки П/ПР/адрес/POI) | ⚠️ | Есть обновление маркеров, но один тип иконки (circleIcon); нет разного вида для поставщика/партнёра/POI и смещения при наложении |
| `buildBalloon` (адрес, удалить, водители по **dbDrivers** + «Снять», КБТ + помощник) | ⚠️ | buildBalloonContent есть, но кнопки по driverCount (слоты), нет «Снять», нет КБТ и выбора помощника |
| `__dc_delete` | ✅ | Есть onDeleteOrder |
| `__dc_toggleKbt`, `__dc_setHelper` (КБТ +1, выбор помощника) | ❌ | Нет в балуне и в состоянии заказа |
| `highlightMapOrder`, `clearMapOrderHighlight` (hover по элементу в сайдбаре) | ❌ | Нет подсветки точки на карте при наведении на строку в списке |
| Клик по карте в режиме «поставить точку» (placingOrderId) | ✅ | placingMode, onMapClick |
| `_fitBoundsNext`, подгонка bounds после добавления точек | ✅ | setBounds при обновлении маркеров |
| POI: `isPoiActive`, `togglePoi`, геокод адреса POI | ✅ | handleTogglePoi, POI_DEFS |

---

## Сайдбар: рендер списков

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| Секции: Вставить поставщиков / партнёров / адреса | ✅ | Есть |
| Поиск поставщика/партнёра по базе (инпут + выпадающий список) | ✅ | Добавлено |
| Водители (список с цветом, кол-во точек, «Все точки», «Нераспределённые») | ✅ | Добавлено |
| Варианты распределения (карточки) | ✅ | Есть |
| Кнопки: На карту, + Добавить, Заменить всё, Распределить, Обновить из 1С, Сбросить, Вручную, Завершить маршрут | ✅ | Есть |
| POI (ПВЗ 1, ПВЗ 2, РБ Додома) | ✅ | Есть |
| Поиск по точкам на карте (инпут + результаты + клик → центр карты + балун) | ✅ | pointSearchQuery, pointSearchResults; центр/балун через __drivecontrol_centerOrder — проверить |
| Список поставщиков (фильтр по водителю, Скрыть распред., Скрыть ✅, TG фильтр) | ⚠️ | Список есть (supplierItems), фильтров по скрытию и TG нет |
| Список партнёров | ⚠️ | partnerItems есть |
| Список адресов | ✅ | addressItems |
| Рендер одного заказа: иконка/цвет, адрес, телефон, время, «В базе»/«Не найден»/«Партнёр выбран», назначение водителя, кнопки (✎, 📍, удалить, + В базу, 🔎 Найти) | ⚠️ | В React отображаются заказы в списках, но без полного набора кнопок и статусов как в старой версии (нет «Не найден — нажмите для поиска», «+ В базу», «🔎 Найти», Telegram-статусов) |
| Редактирование адреса (строка с инпутом + «Найти» + отмена) | ✅ | editingOrderId, handleRetryGeocode |
| Режим «поставить точку на карте» (подсказка + отмена) | ✅ | placingOrderId |

---

## Модалки

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| «Распределить маршрут» (выбор водителей чекбоксами + Распределить) | ✅ | showDistributeModal, distributeSelectedIds |
| «Сбросить данные» (по водителю / нераспределённые / все + выбор типа: адреса/поставщики/всё) | ✅ | showClearModal, clearStep, clearTarget, doClear |
| «Завершить маршрут» (выбор водителя → finishDriverRoute) | ✅ | handleFinishRoute, сохранение маршрутов в БД |
| «Завершить поставщиков» (finishSuppliersDialog, finishSupplierRoute) | ❌ | Нет отдельной модалки и логики «завершить только поставщиков» |
| Модалка поиска поставщика по заказу (openSupplierSearch) | ❌ | Нет |
| Модалка поиска партнёра (openPartnerSearch) | ❌ | Нет |
| Создать поставщика из заказа (createSupplierFromOrder), создать партнёра (openCreatePartnerModal) | ❌ | Нет |
| Палитра цветов водителя (showColorPalette) | ❌ | Нет |

---

## Прочее

| Блок | В новой версии | Примечание |
|------|----------------|------------|
| `retryGeocode` (изменение адреса + геокод; обратный геокод по клику на карте) | ⚠️ | handleRetryGeocode есть; обратный геокод при «поставить на карте» через onMapClick — координаты подставляются |
| `clearSupplierItemsForOrder` | ❌ | Нет |
| Telegram: отправка поставщиков водителю, статусы (sent, confirmed, rejected, picked_up), кнопки «Дослать», «Обновить ответы» | ❌ | В новой версии не портировано |
| `finishDistribution` (одним вызовом по всем водителям) | ⚠️ | В React сохраняются маршруты по каждому водителю через syncDriverRoute, отдельного «finishDistribution» нет |
| Day rollover (смена даты, сброс состояния) | ❌ | Нет |
| `onSectionActivated` (при открытии вкладки: загрузка БД, алиасы, цвета, loadBestAvailableState, loadCustomerOrdersFrom1C, refreshSupplierItems, initMap, renderSidebar, cloud polling) | ⚠️ | В React при монтировании только загрузка drivers/suppliers/partners; без 1С, без состояния, без облака |

---

## Итог

- **Перенесено:** базовые данные (orders, assignments, variants, водители/поставщики/партнёры из БД), загрузка адресов и геокодинг, загрузка поставщиков/партнёров по именам (упрощённо), распределение по алгоритму, варианты, модалки «Распределить»/«Сбросить»/«Завершить маршрут», карта с маркерами и балуном (без КБТ и «Снять»), POI, поиск по точкам, поиск поставщика/партнёра в сайдбаре, список водителей с цветами.
- **Не перенесено или сильно упрощено:** сохранение/восстановление состояния (localStorage + Supabase `distribution_state`), алиасы поставщиков/партнёров, кастомные цвета водителей и палитра, режим редактирования маршрута водителя, назначение по driver_id и кнопка «Снять» в балуне, КБТ и выбор помощника, подсветка точки при наведении на строку в сайдбаре, разные иконки и смещение при наложении точек на карте, фильтры списков (скрыть распред./принятых, TG), товар от 1С (supplier_orders, getSupplierItems, опрос), модалки поиска/привязки поставщика и партнёра по заказу, «+ В базу»/«+ Новый партнёр», «Завершить поставщиков», Telegram-логика, смена даты (day rollover).

Для полного паритета со старой версией нужно по очереди переносить блоки из секций «Нет» и «Частично» этого чеклиста.
