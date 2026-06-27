# RS232_WEB_CLOUD_002_Render_MainUI

Втора cloud-only версия за подпроекта **RS232_WEB_CLOUD / CLOUD_RELAY**.

Тази версия НЕ променя firmware-а на RS232_WEB_108 и НЕ прави tunnel към локалното ESP32 WEB меню.

## Основна цел

Cloud страницата да прилича повече на основната страница на уреда, но да остане безопасна:

- само read-only мониторинг;
- POST `/api/push` остава защитен с `DEVICE_TOKEN`;
- няма дистанционни команди към ESP32;
- няма SD Tools;
- няма Settings;
- няма FFT;
- няма Diagnostics;
- няма достъп до файлове от SD карта.

## Адреси

```text
GET  /              Main-style cloud страница
POST /api/push      приемане на измерване, изисква DEVICE_TOKEN
GET  /api/latest    последното измерване като JSON
GET  /api/history   последните N измервания, само RAM
GET  /health        проверка на услугата
```

Опасните/локални адреси връщат `403 Forbidden`:

```text
/api/read
/api/loop
/api/command
/api/settings
/sdtools
```

## Бутони на cloud страницата

Работят локално в cloud страницата:

```text
READ / REFRESH   обновява последното измерване от /api/latest
ADD              добавя текущото измерване в локалната таблица на браузъра
HOLD             спира/пуска автоматичното обновяване
NO+ / NO-        променя No само визуално/локално
EXPORT CSV       сваля CSV от текущата таблица
PRINT            печат на страницата
CLEAR LOCAL      чисти само локалния изглед
```

Заключени бутони:

```text
LOOP START
LOOP STOP
SETTINGS
```

При натискане показват съобщение, че дистанционните команди са изключени:

```text
allow_remote_commands=0
```

## Render Environment Variables

Минимално:

```text
DEVICE_TOKEN=твоя-дълга-тайна-стойност
HISTORY_LIMIT=50
```

По желание:

```text
VIEW_TOKEN=тайна-за-гледане
```

Ако `VIEW_TOKEN` липсва, страницата е публична read-only, но POST `/api/push` остава защитен с `DEVICE_TOKEN`.

## Как да обновиш вече съществуващия Render проект

Тъй като вече имаш работещ Render service:

```text
https://rs232-web-cloud-001-render.onrender.com/
```

можеш да обновиш същия GitHub repository с файловете от този пакет:

```text
server.js
package.json
sample_payload.json
README_BG.md
.gitignore
```

После в Render:

```text
Render Dashboard
→ твоят Web Service
→ Manual Deploy
→ Deploy latest commit
```

Ако страницата изглежда стара:

```text
Manual Deploy
→ Clear build cache & deploy
```

## Локален тест от компютър

```bash
npm start
```

После отвори:

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
curl http://localhost:3000/api/history
curl http://localhost:3000/health
```

## PowerShell тест към твоя Render адрес

Смени само `ТВОЯ_DEVICE_TOKEN`:

```powershell
$token = "ТВОЯ_DEVICE_TOKEN"
$url = "https://rs232-web-cloud-001-render.onrender.com/api/push"

$body = @{
  device  = "RS232_WEB"
  version = "108"
  no      = "000124"
  article = "TR-250VA"
  u       = "231.2"
  i       = "0.462"
  p       = "106.8"
  freq    = "49.99"
  time    = "2026-06-27 16:10:00"
  status  = "OK"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

След това отвори:

```text
https://rs232-web-cloud-001-render.onrender.com/
```

## Важно за историята

Историята все още е само RAM. При рестарт, redeploy или заспиване/събуждане на Render Free услугата може да се загуби.

Това е нарочно за този етап. По-късно може да се добави постоянна история.
