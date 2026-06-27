# RS232_WEB_CLOUD_006_CommandQueue_DISABLED

Дата: 2026-06-27
Тип: **cloud-only** версия. `RS232_WEB_108` firmware не е променян.

## Цел

Тази версия добавя **структура за бъдеща двупосочна синхронизация**, но я оставя напълно заключена.

Това означава:

```text
Cloud UI може да опита да заяви команда
→ cloud server я отказва
→ командата НЕ се записва
→ ESP32 няма какво да изтегли
→ уредът не се управлява
```

Текущият режим остава:

```ini
allow_remote_commands=0
command_queue_enabled=0
```

## Запазено от CLOUD_005

- Визуална база от реалната Main страница на `RS232_WEB_108`.
- `HOLD` следва JSON полето `hold`.
- `Start/Stop Loop` следва JSON полето `loop_running`.
- `Trigger status` следва `trigger_state` / `trigger_hit`.
- `VERIFY` следва `verified`.
- `Cloud Auto Refresh` остава отделна локална функция на браузъра.
- `POST /api/push` остава защитен с `DEVICE_TOKEN`.

## Ново в CLOUD_006

Добавени са endpoints за бъдеща command queue архитектура:

```text
POST /api/request-command
GET  /api/pull
POST /api/ack
GET  /api/command-queue
GET  /api/command-map
```

Но всички команди са заключени.

### POST /api/request-command

При опит от cloud UI да промени например `Next No`, `Article`, `Trigger target`, `HOLD` или `LOOP`, server-ът връща:

```json
{
  "ok": false,
  "error": "remote_commands_disabled",
  "queued": false,
  "stored": false,
  "allow_remote_commands": 0,
  "command_queue_enabled": 0
}
```

Тоест командата **не се записва**.

### GET /api/pull

Това е бъдещият endpoint, който ESP32 някой ден ще пита за чакащи команди.

Сега винаги връща:

```json
{
  "ok": true,
  "has_command": false,
  "command": null,
  "allow_remote_commands": 0,
  "command_queue_enabled": 0
}
```

### POST /api/ack

Бъдещ endpoint за потвърждение от ESP32. Сега е заключен и връща `403`.

## Проверка след deploy

Отвори:

```text
https://rs232-web-cloud-001-render.onrender.com/health
```

Очаквано:

```json
{
  "service": "RS232_WEB_CLOUD_006_CommandQueue_DISABLED",
  "allow_remote_commands": 0,
  "command_queue_enabled": 0,
  "pending_commands": 0
}
```

Провери и:

```text
https://rs232-web-cloud-001-render.onrender.com/api/command-queue
https://rs232-web-cloud-001-render.onrender.com/api/command-map
```

## Тест на заключена команда

Пример от PowerShell:

```powershell
$body = Get-Content .\sample_command_request_set_next_no.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri "https://rs232-web-cloud-001-render.onrender.com/api/request-command" `
  -ContentType "application/json" `
  -Body $body
```

Очаква се `403` и `remote_commands_disabled`. Това е правилно.

## Важно

Тази версия **не активира управление**. Тя само подготвя безопасната архитектура за бъдеща версия, където ESP32 сам ще пита cloud-а за чакащи команди.

`RS232_WEB_108` остава недокоснат.
