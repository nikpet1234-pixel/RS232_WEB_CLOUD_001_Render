# RS232_WEB_CLOUD_005_UI_StateMap

Това е **cloud-only** версия. Firmware-ът на **RS232_WEB_108 не е променян**.

## Основна цел

CLOUD_005 фиксира връзката между JSON параметрите и визуалните бутони/индикации в cloud страницата.

Вече идеята е ясна:

```text
JSON state от уреда → съответен бутон/поле в cloud страницата
```

Пример:

```text
hold=1             → HOLD бутонът става червен
hold=0             → HOLD бутонът се връща нормален
loop_running=1     → LOOP бутонът показва активен цикъл
loop_running=0     → LOOP бутонът показва спрян цикъл
trigger_state=HIT  → Trigger status става HIT/червен
trigger_state=OK   → Trigger status става OK/зелен
verified=1         → VERIFY: OK
```

## Важна промяна спрямо CLOUD_004

В CLOUD_004 бутонът **Start/Stop Loop** управляваше локалното auto-refresh обновяване на страницата. Това подвеждаше, защото изглеждаше като реален LOOP на уреда.

В CLOUD_005 са разделени:

```text
Start/Stop Loop       → показва DEVICE loop_running от JSON
Cloud Auto Refresh    → локално обновяване на страницата
HOLD                  → показва DEVICE hold от JSON
```

Тоест:

```text
Start/Stop Loop и HOLD вече не сменят сами цвета си при натискане.
Те сменят състоянието си само когато бъде получен нов JSON state.
```

При натискане на тези бутони се показва, че командите са изключени:

```text
allow_remote_commands=0
```

## UI State Map

| JSON поле | Управлява в страницата |
|---|---|
| `hold` | HOLD бутон: нормален/червен |
| `loop_running` | Start/Stop Loop бутон и Loop статус |
| `trigger_enabled` | trigger логика/индикация |
| `trigger_parameter` | Selection поле: U/I/P |
| `trigger_by` | Trigger by поле: CALC/L1/L2/L3 |
| `trigger_threshold` | Target поле |
| `trigger_tolerance_pct` | Tol (%) поле |
| `trigger_value` | Trigger value |
| `trigger_state` | Trigger status: OK/ARMED/HIT/OUT |
| `trigger_hit` | trigger hit индикация |
| `verified` | VERIFY badge |
| `no` / `next_no` | No / Next № |
| `article` | Article поле |
| `uavr` / `iavr` / `psum` | агрегатни стойности |

## Адреси

```text
GET  /              Главна read-only страница
POST /api/push      Приемане на измерване/state, защитено с DEVICE_TOKEN
GET  /api/latest    Последно получено състояние
GET  /api/history   История в RAM
GET  /api/state-map Карта JSON поле → UI елемент
GET  /health        Диагностика
```

Подготвени, но заключени:

```text
POST /api/request-command   remote_commands_disabled
GET  /api/pull              has_command:false
POST /api/ack               remote_commands_disabled
```

## Защитата

`POST /api/push` остава защитен с:

```text
DEVICE_TOKEN
```

`VIEW_TOKEN` е опционален. Ако е премахнат от Render Environment, страницата се гледа без token.

## Качване в Render

В GitHub repository-то замени файловете с тези от пакета:

```text
server.js
package.json
public/index.html
sample_payload_basic.json
sample_payload_full_state.json
sample_payload_trigger_hit.json
sample_payload_loop_running.json
README_BG.md
CHANGES.txt
.gitignore
```

После:

```text
Render Dashboard
→ твоят Web Service
→ Manual Deploy
→ Deploy latest commit
```

Ако виждаш стара версия:

```text
Manual Deploy
→ Clear build cache & deploy
```

## Проверка

След deploy отвори:

```text
https://rs232-web-cloud-001-render.onrender.com/health
```

Очаквано:

```json
"service": "RS232_WEB_CLOUD_005_UI_StateMap",
"allow_remote_commands": 0,
"ui_state_map": "v1"
```

Можеш да видиш и картата:

```text
https://rs232-web-cloud-001-render.onrender.com/api/state-map
```

## PowerShell тест

```powershell
$token = "ТВОЯ_DEVICE_TOKEN"
$url = "https://rs232-web-cloud-001-render.onrender.com/api/push"
```

Full state:

```powershell
$body = Get-Content .\sample_payload_full_state.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

Trigger hit:

```powershell
$body = Get-Content .\sample_payload_trigger_hit.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

Loop running:

```powershell
$body = Get-Content .\sample_payload_loop_running.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

## Очаквано поведение

- При `sample_payload_full_state.json`: HOLD нормален, LOOP OFF, TRIG OK.
- При `sample_payload_trigger_hit.json`: HOLD червен, TRIG HIT, LOOP OFF.
- При `sample_payload_loop_running.json`: LOOP активен, HOLD нормален, TRIG ARMED.
- Бутонът **Cloud Auto Refresh** управлява само браузъра и няма общо с уреда.
- Бутоните **HOLD** и **Start/Stop Loop** са read-only индикации, докато командите са изключени.

