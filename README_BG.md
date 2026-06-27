# RS232_WEB_CLOUD_004_StateModel

Това е **cloud-only** версия на RS232_WEB_CLOUD. Тя не променя firmware-а на RS232_WEB_108.

Текущата цел е cloud страницата да бъде подготвена за бъдеща синхронизация с уреда, но все още без дистанционно управление.

## Основна идея

В предишната версия страницата приличаше визуално на Main страницата от уреда. В тази версия фокусът е логиката:

- cloud-ът приема по-пълен state JSON;
- cloud страницата показва стойности, които са изпратени от уреда;
- ако дадена стойност липсва, се показва `---`;
- cloud страницата не се опитва да измисля Uavr/Iavr/Psum/L;
- trigger/hold/loop се показват като състояние, когато бъдат изпратени от уреда;
- дистанционните команди остават изключени.

## Адреси

```text
GET  /              Главна read-only страница
POST /api/push      Приемане на измерване/state от уред или тестов компютър
GET  /api/latest    Последно получено състояние
GET  /api/history   История в RAM
GET  /health        Диагностика на cloud услугата
```

Подготвени, но заключени за бъдеще:

```text
POST /api/request-command   връща remote_commands_disabled
GET  /api/pull              връща has_command:false
POST /api/ack               връща remote_commands_disabled
```

## Защитата

`POST /api/push` остава защитен с:

```text
DEVICE_TOKEN
```

Той трябва да остане в Render → Environment.

`VIEW_TOKEN` е опционален. Ако го няма, страницата се отваря свободно за гледане.

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

След това:

```text
Render Dashboard
→ твоят Web Service
→ Manual Deploy
→ Deploy latest commit
```

Ако виждаш старата страница:

```text
Manual Deploy
→ Clear build cache & deploy
```

## Тест от PowerShell

Задай токена и URL:

```powershell
$token = "ТВОЯ_DEVICE_TOKEN"
$url = "https://rs232-web-cloud-001-render.onrender.com/api/push"
```

### Basic payload

```powershell
$body = Get-Content .\sample_payload_basic.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

### Full state payload

```powershell
$body = Get-Content .\sample_payload_full_state.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

### Trigger hit payload

```powershell
$body = Get-Content .\sample_payload_trigger_hit.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

### Loop running payload

```powershell
$body = Get-Content .\sample_payload_loop_running.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri $url `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

След всеки тест отвори:

```text
https://rs232-web-cloud-001-render.onrender.com/
```

или провери JSON:

```powershell
Invoke-RestMethod -Uri "https://rs232-web-cloud-001-render.onrender.com/api/latest"
```

## Какво е важно

В тази версия бутоните могат да променят видими полета на страницата, но **не изпращат команда към уреда**.

Пример:

- промяна на Next No е само визуална;
- промяна на Target/Tol/Trigger by е само визуална;
- HOLD е само локална визуална индикация;
- Start Loop е само cloud auto-refresh.

Реална двупосочна синхронизация ще стане по-късно чрез command queue, но чак когато изрично бъде разрешено:

```ini
allow_remote_commands=1
```

Засега остава:

```ini
allow_remote_commands=0
```

## Следваща възможна стъпка

След като CLOUD_004 се тества добре, следваща cloud-only версия може да бъде:

```text
RS232_WEB_CLOUD_005_CommandQueue_DISABLED
```

Там ще подготвим командната опашка по-сериозно, но все още заключена.
