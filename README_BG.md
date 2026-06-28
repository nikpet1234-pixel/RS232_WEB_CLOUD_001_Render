# RS232_WEB_CLOUD_012_UVoltageLabelFix

Cloud UI поправка за надписите на напреженията при режим **3-phase voltage**.

## Какво е поправено

При промяна на режима от **Phase Uph** към **Line ULL** cloud страницата вече обновява:

- подсказката в U блока;
- етикета на Uavg;
- заглавието Uavg в log таблицата;
- select полето `3-phase voltage`, включително когато firmware/cloud state върне `LINE`, `line`, `ULL`, `PHASE`, `phase` или `Uph`.

## Качване в Render/GitHub

За deploy са нужни само:

```text
server.js
package.json
public/index.html
README_BG.md
CHANGES.txt
.gitignore
```

Промяната е само в `public/index.html`. Firmware не се пипа.
