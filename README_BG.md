# RS232_WEB_CLOUD / CLOUD_RELAY_001_Render

Първи read-only cloud приемник за RS232_WEB. Тази част НЕ излага локалното ESP32 меню към интернет.

## Какво има

- `GET /` — проста HTML страница с последното измерване
- `POST /api/push` — приемане на измерване от ESP32/компютър, защитено с `DEVICE_TOKEN`
- `GET /api/latest` — последното измерване като JSON
- `GET /api/history` — последните N измервания, само в RAM
- `GET /health` — проверка дали услугата работи

## Важно

Данните са само в RAM. При рестарт, redeploy или заспиване/събуждане на free Render инстанция историята може да се загуби. Това е нарочно за първи тест.

## Локален тест

```bash
npm start
```

Отвори:

```text
http://localhost:3000/
```

Тестово изпращане:

```bash
curl -X POST http://localhost:3000/api/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer change-me-dev-token" \
  --data @sample_payload.json
```

Проверка:

```bash
curl http://localhost:3000/api/latest
```

## Render настройки

Service type: Web Service
Build Command: `npm install`
Start Command: `npm start`

Environment Variables:

```text
DEVICE_TOKEN=сложи-дълга-тайна-стойност
HISTORY_LIMIT=50
```

По желание, за да не е публична страницата за наблюдение:

```text
VIEW_TOKEN=друга-тайна-за-гледане
```

Тогава отваряш:

```text
https://your-service.onrender.com/?view_token=друга-тайна-за-гледане
```

## Тест след deploy

```bash
curl -X POST https://your-service.onrender.com/api/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ТВОЯ_DEVICE_TOKEN" \
  --data @sample_payload.json
```

После отвори:

```text
https://your-service.onrender.com/
```
