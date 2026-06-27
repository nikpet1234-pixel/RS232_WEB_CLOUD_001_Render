# RS232_WEB_CLOUD_003_Render_RS232_UI

Това е **само cloud пакет** за Render. Не променя firmware-а на RS232_WEB_108.

## Цел

Версия 003 използва реалната последна WEB страница от RS232_WEB_108 като визуална база, но я превръща в безопасен cloud read-only монитор.

Запазени визуално:

- Main страницата
- бутоните Read full, Read + Add, Add to Log, Print, HOLD, Start Loop
- Article / Артикул
- Next №
- U / I / P / L блоковете
- Log table
- стилове, размери и разположение от RS232_WEB_108

Премахнати/неизползвани:

- FFT
- Settings
- Diagnostics
- SD Tools
- SD файлов браузър
- директни локални API функции към ESP32

## Безопасна логика

Това НЕ е tunnel към ESP32.

Cloud услугата приема само данни, които ESP32 или компютър изпраща към:

```text
POST /api/push
```

Този адрес остава защитен с:

```text
DEVICE_TOKEN
```

Страницата чете само:

```text
GET /api/latest
GET /api/history
```

Дистанционните команди са изключени:

```text
allow_remote_commands=0
```

Следните адреси връщат `403 Forbidden`:

```text
/api/read
/api/loop
/api/hold
/api/command
/api/settings
/api/set
/api/status
/api/measurement
/api/log
/api/addlog
/api/clearrows
/sdtools
/diag
/embedded
```

## Как работят бутоните в cloud страницата

```text
Read full      -> чете /api/latest
Read + Add     -> чете /api/latest и добавя ред в локалната таблица
Add to Log     -> добавя текущото измерване в локалната cloud таблица
Print          -> печат на страницата от браузъра
HOLD STOP/RUN  -> локална пауза на auto-refresh
Start Loop     -> локален auto-refresh през cloud, не команда към ESP32
Clear table    -> чисти само локалния браузърен изглед
Export results -> CSV от показаната таблица
NO+ / NO-      -> локална промяна на Next №
```

## Обновяване на съществуващия Render проект

Качи/замени в GitHub repository-то файловете от този пакет:

```text
server.js
package.json
public/index.html
sample_payload.json
README_BG.md
CHANGES.txt
.gitignore
```

После в Render:

```text
Render Dashboard
→ твоят Web Service
→ Manual Deploy
→ Deploy latest commit
```

Ако покаже старата страница:

```text
Manual Deploy
→ Clear build cache & deploy
```

## Environment Variables в Render

Минимално трябва да остане:

```text
DEVICE_TOKEN=твоят-дълъг-таен-token
HISTORY_LIMIT=100
```

`VIEW_TOKEN` е по желание.

Ако `VIEW_TOKEN` липсва, страницата се отваря свободно:

```text
https://rs232-web-cloud-001-render.onrender.com/
```

Ако `VIEW_TOKEN` е зададен, страницата ще иска:

```text
https://rs232-web-cloud-001-render.onrender.com/?view_token=твоят-view-token
```

## Тест от PowerShell

```powershell
$token = "ТВОЯ_DEVICE_TOKEN"
$url = "https://rs232-web-cloud-001-render.onrender.com/api/push"

$body = @{
  device  = "RS232_WEB"
  version = "108"
  no      = "000123"
  article = "TR-250VA"
  u       = "230.1"
  i       = "0.456"
  p       = "104.9"
  freq    = "49.98"
  time    = "2026-06-27 15:42:10"
  status  = "OK"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

После отвори:

```text
https://rs232-web-cloud-001-render.onrender.com/
```

## Важно

RS232_WEB_108 остава недокоснат. Този пакет е само cloud relay + cloud UI.
