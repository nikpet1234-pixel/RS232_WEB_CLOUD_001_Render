# RS232_WEB_CLOUD_011_UI_Cleanup

Cloud-only поправка върху CLOUD_010.

Минимални файлове за Render:

- server.js
- package.json
- public/index.html
- README_BG.md
- CHANGES.txt
- .gitignore

Поправки:

1. Празните стойности се показват като `-`, не като `---`.
2. Лог таблицата не добавя редове без реални измерени стойности.
3. L1/L2/L3 inductance вече не показват JSON обекти.
4. Колоната за устройство в лога използва `device_name` / `idn` / `instrument`, ако са налични.
5. Скрит е големият cloudNotice/state-map текст и MAIN таб бутонът.
6. Маркирането по trigger параметър е коригирано: U/I/P групата се оцветява, а избраният CALC/L1/L2/L3 елемент се маркира отделно.

Remote command логиката остава както в CLOUD_010.
