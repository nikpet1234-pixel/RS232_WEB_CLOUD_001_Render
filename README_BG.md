# RS232_WEB_CLOUD_008_DevicePullAck_SIM

Това е cloud-only версия за подпроекта **RS232_WEB_CLOUD / CLOUD_RELAY**.

База: `RS232_WEB_CLOUD_007_CommandQueue_ARMED`.

## Цел на версия 008

Да се тества бъдещият двупосочен цикъл **без ESP32 firmware**:

```text
Cloud UI / PowerShell
→ POST /api/request-command
→ command queue

симулиран ESP32 / PowerShell
→ GET /api/pull
→ изпълнява командата локално / симулира изпълнение
→ POST /api/ack със state

Cloud
→ премахва командата от pending queue
→ записва ACK history
→ ако ACK съдържа state, обновява /api/latest и страницата
```

**RS232_WEB_108 firmware не се пипа.**

## Важно за безопасността

По подразбиране командите остават изключени.

За активен command queue са нужни едновременно:

```text
ALLOW_REMOTE_COMMANDS=1
COMMAND_QUEUE_ENABLED=1
COMMAND_TOKEN=дълга-тайна-стойност
DEVICE_TOKEN=дълга-тайна-стойност
```

Ако някое липсва, `/api/request-command` няма да записва команди.

## Token разделение

```text
DEVICE_TOKEN   → използва се от уреда / симулирания уред:
                 POST /api/push
                 GET  /api/pull
                 POST /api/ack

COMMAND_TOKEN  → използва се за заявка на команда:
                 POST /api/request-command
```

Така публичната страница не трябва да знае `DEVICE_TOKEN`.

## Новото спрямо 007

### 1. ACK може да обнови latest state

В 007 `POST /api/ack` само записваше потвърждение.

В 008, ако ACK съдържа обект `state`, cloud услугата го нормализира като ново състояние и обновява:

```text
GET /api/latest
GET /
GET /api/history
```

Пример:

```json
{
  "id": "cmd-000001",
  "ok": true,
  "message": "set_next_no accepted",
  "state": {
    "next_no": "000200",
    "status": "COMMAND ACK OK"
  }
}
```

След това главната cloud страница трябва да покаже новия `next_no`.

### 2. Нов endpoint за ACK история

```text
GET /api/ack-history
```

Връща последните ACK записи.

### 3. PowerShell тестов сценарий

Добавен е файл:

```text
test_008_powershell_commands.txt
```

Той показва пълния тест:

```text
queue command → pull → ack → latest → command queue with ack history
```

## Deploy

Качи всички файлове от ZIP-а в GitHub repository-то на cloud проекта.

След това в Render:

```text
Manual Deploy
→ Deploy latest commit
```

Ако виждаш стара версия:

```text
Manual Deploy
→ Clear build cache & deploy
```

## Проверка след deploy

Отвори:

```text
https://rs232-web-cloud-001-render.onrender.com/health
```

Очаква се:

```json
{
  "service": "RS232_WEB_CLOUD_008_DevicePullAck_SIM",
  "device_pull_ack_sim": "v1",
  "ack_can_update_latest": true
}
```

## Тестов ред

1. В Render Environment включи временно:

```text
ALLOW_REMOTE_COMMANDS=1
COMMAND_QUEUE_ENABLED=1
COMMAND_TOKEN=твоя-команден-токен
```

2. Deploy latest commit.

3. Използвай `test_008_powershell_commands.txt`.

4. Провери:

```text
/api/command-queue?ack=1
/api/ack-history
/api/latest
```

5. След тест може пак да изключиш:

```text
ALLOW_REMOTE_COMMANDS=0
COMMAND_QUEUE_ENABLED=0
```

## Забранени команди в този етап

Все още не пускаме опасни действия:

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

Разрешените тестови команди остават само:

```text
set_next_no
set_article
set_trigger
set_cloud_note
```

## Бележка

Това все още не е firmware интеграция. Това е симулация на бъдещото поведение на ESP32 чрез PowerShell.
