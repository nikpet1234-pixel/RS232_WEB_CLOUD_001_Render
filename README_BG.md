# RS232_WEB_CLOUD_007_CommandQueue_ARMED

Това е cloud-only версия. **RS232_WEB_108 firmware не е пипан.**

Версия 007 добавя реална, но контролирано заключена/отключваема опашка за бъдещи команди.

## Главна идея

До 006 имахме само структура, която винаги отказва команди.

В 007 вече може да се тества пълният поток:

```text
Cloud UI / PowerShell
→ POST /api/request-command
→ командата влиза в RAM queue

ESP32 simulator / PowerShell
→ GET /api/pull
→ получава първата чакаща команда

ESP32 simulator / PowerShell
→ POST /api/ack
→ потвърждава изпълнение и командата излиза от pending
```

Но това се активира **само ако изрично го включиш в Render**.

## По подразбиране е безопасно изключено

Ако не добавиш специални Render Environment variables, `/health` ще покаже:

```json
{
  "service": "RS232_WEB_CLOUD_007_CommandQueue_ARMED",
  "allow_remote_commands": 0,
  "command_queue_enabled": 0,
  "command_token_configured": false,
  "commands_active": 0
}
```

В този режим командите пак се отказват.

## Как се активира само за тест

В Render → Environment добави:

```text
ALLOW_REMOTE_COMMANDS=1
COMMAND_QUEUE_ENABLED=1
COMMAND_TOKEN=друга-дълга-тайна-стойност
```

`DEVICE_TOKEN` остава както досега и пази ESP32/device операциите.

`COMMAND_TOKEN` е отделен token за записване на команди от cloud UI или PowerShell.

След промяна направи:

```text
Manual Deploy → Deploy latest commit
```

После `/health` трябва да покаже:

```json
"commands_active": 1
```

## Защо има отделен COMMAND_TOKEN

Страницата за наблюдение при теб се отваря публично без `VIEW_TOKEN`. Затова не е безопасно всеки посетител да може да записва команди.

Затова:

```text
POST /api/push              → DEVICE_TOKEN
GET /api/pull               → DEVICE_TOKEN
POST /api/ack               → DEVICE_TOKEN
POST /api/request-command    → COMMAND_TOKEN
```

## Разрешени първи команди

В 007 са разрешени само меки настройки:

```text
set_next_no
set_article
set_trigger
set_cloud_note
```

Забранени засега:

```text
loop_start
loop_stop
hold_toggle
settings
sdtools
print
file_read
file_write
firmware_update
```

Тоест няма управление на цикъл, HOLD, SD карта, настройки или файлове.

## Тест 1: queue изключена

PowerShell:

```powershell
$commandToken = "ТВОЯ_COMMAND_TOKEN"
$url = "https://rs232-web-cloud-001-render.onrender.com/api/request-command"
$body = Get-Content .\sample_command_request_set_next_no.json -Raw

Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $commandToken" } `
  -ContentType "application/json" `
  -Body $body
```

Ако не си включил Render ENV, очаквано ще върне:

```json
{
  "ok": false,
  "error": "remote_commands_disabled",
  "queued": false,
  "stored": false
}
```

## Тест 2: queue активирана

След като добавиш Render ENV и redeploy-неш, същата заявка трябва да върне:

```json
{
  "ok": true,
  "queued": true,
  "stored": true,
  "command": {
    "id": "cmd-000001",
    "cmd": "set_next_no",
    "status": "pending"
  }
}
```

Провери queue:

```powershell
Invoke-RestMethod -Uri "https://rs232-web-cloud-001-render.onrender.com/api/command-queue"
```

## Тест 3: симулация на ESP32 pull

```powershell
$deviceToken = "ТВОЯ_DEVICE_TOKEN"
Invoke-RestMethod `
  -Uri "https://rs232-web-cloud-001-render.onrender.com/api/pull" `
  -Headers @{ Authorization = "Bearer $deviceToken" }
```

Трябва да върне първата команда, ако има pending.

## Тест 4: ACK

В `sample_device_ack_ok.json` смени `command_id` с реалното ID, например `cmd-000001`.

```powershell
$deviceToken = "ТВОЯ_DEVICE_TOKEN"
$url = "https://rs232-web-cloud-001-render.onrender.com/api/ack"
$body = Get-Content .\sample_device_ack_ok.json -Raw

Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $deviceToken" } `
  -ContentType "application/json" `
  -Body $body
```

След ACK командата трябва да изчезне от pending.

## Важно

Това още не управлява реален уред. Това е cloud тест на бъдещия механизъм.

RS232_WEB_108 остава непроменен.
