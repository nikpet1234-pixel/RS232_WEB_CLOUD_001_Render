# RS232_WEB_CLOUD_009_ButtonCommandMap

Cloud service/UI пакет за RS232_WEB, базиран на CLOUD_008.

Тази версия поправя връзката между бутоните на cloud страницата и command queue командите.

## Основни поправки

- Print бутонът е премахнат от cloud страницата.
- HOLD изпраща `hold_start` / `hold_stop`.
- LOOP изпраща `loop_start` / `loop_stop`.
- Target / Tol / Selection / Trigger by / AutoStop изпращат `set_trigger`.
- I factor / 3-phase voltage / L1 / L2 / L3 / Inductance изпращат `set_measurement_options`.
- Article изпраща `set_article`.
- Next No / NO+ / NO- изпращат `set_next_no`.

## За да се приемат командите

В Render Environment трябва да има:

```ini
ALLOW_REMOTE_COMMANDS=1
COMMAND_QUEUE_ENABLED=1
COMMAND_TOKEN=твоя-команден-токен
DEVICE_TOKEN=твоя-device-token
```

След промяна на Environment Variables направи:

```text
Manual Deploy -> Deploy latest commit
```

## Важно

Cloud страницата само записва чакаща команда. Уредът реално я изпълнява чак когато firmware-ът направи:

```text
GET /api/pull
POST /api/ack
```

Съвместим firmware: RS232_WEB_114 или по-нов.
