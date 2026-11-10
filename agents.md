# agents.md — как чинить тему Яндекс Музыки (инструкции для будущих сессий)

Это неофициальная тема для десктопного приложения «Яндекс Музыка» (Windows,
Electron). Тема живёт поверх официального клиента: свои цвета (`--ym-*`),
типографика и переработанная страница «Моя волна» (классический плеер вместо
«вайбового» экрана).

См. также `README.md` (общая документация) и `DISCLAIMER.md`.

---

## 1. Как это работает (кратко)

```
theme/*.css + custom.js  →  src/loader.js (вшивается в app.asar)  →  webContents.insertCSS()
```

1. `scripts/apply.ps1` берёт оригинальный `resources/app.asar` (сохранён как
   `app.asar.orig`), дописывает в конец `index.js` загрузчик `src/loader.js`,
   пересобирает asar и пересчитывает SHA-256 заголовка asar, вшитый в exe
   (включена фьюза `EnableEmbeddedAsarIntegrityValidation`).
2. Загрузчик на каждый `music-application://` документ читает все `*.css`
   из активной папки темы и вставляет их через `insertCSS`; `custom.js`
   (единственное JS-имя) выполняется на каждой странице.
3. Горячая перезагрузка: правка `.css` в активной папке перерисовывает окно
   без перезапуска (загрузчик слушает папку через `fs.watch`). `custom.js`
   НЕ горячий — его изменения видны только после `location.reload()` или
   перезапуска приложения.

Порядок поиска папки темы: `<проект>\theme_live` (если есть) → копия у
приложения `<установка>\theme`. Папка `theme/` в git — источник, при работе
приложения не читается.

---

## 2. Как запустить приложение для отладки (ВАЖНО)

**Главная грабля:** из-под песочницы DSH запуск приложения через
`Start-Process -FilePath $exe ...` приводит к тому, что процесс мгновенно
выходит с кодом 0 — это Electron считает себя «вторым экземпляром» и зовёт
`app.quit()` (не удаётся взять single-instance lock). Ни лога, ни окна.
`mspaint`/`notepad` при этом запускаются нормально — проблема именно в
single-instance lock Electron.

**Рабочий способ — запуск через `explorer.exe` (ShellExecute):**

```powershell
$exe = "C:\Users\AlexPC\AppData\Local\Programs\YandexMusic\Яндекс Музыка.exe"
explorer.exe $exe          # обычный запуск (работает)
```

**Для CDP (DevTools-протокол) нужен флаг `--remote-debugging-port=9222`.**
`explorer.exe` не передаёт аргументы exe, поэтому делаем ярлык и запускаем его:

```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:TEMP\ym-debug.lnk")
$lnk.TargetPath = $exe
$lnk.Arguments = "--remote-debugging-port=9222"
$lnk.WorkingDirectory = "C:\Users\AlexPC\AppData\Local\Programs\YandexMusic"
$lnk.Save()
explorer.exe "$env:TEMP\ym-debug.lnk"
```

Проверка порта: `Invoke-RestMethod http://127.0.0.1:9222/json/list`.

Остановить приложение (перед сменой способа запуска):

```powershell
taskkill /F /IM "Яндекс Музыка.exe" /T
```

---

## 3. Как смотреть DOM и проверять стили (CDP)

`tools/cdp.mjs` — минимальный CDP-клиент (Node 18+, без зависимостей):

```powershell
node tools/cdp.mjs list                         # список вкладок
node tools/cdp.mjs eval "<js>"                  # выполнить JS, вернуть JSON
node tools/cdp.mjs eval --file probe.js         # выполнить JS из файла
node tools/cdp.mjs html dom.html                # сохранить DOM
node tools/cdp.mjs shot screen.png              # скриншот
node tools/cdp.mjs click "<selector>"           # клик по элементу
node tools/cdp.mjs nav <url>                    # перейти
```

Модель без поддержки картинок **не может смотреть скриншоты** — поэтому вместо
глаз используем DOM-пробы: `getBoundingClientRect()`, `getComputedStyle()`,
`document.elementsFromPoint()`. Полезные готовые пробы лежат в `.sandbox/js/`
(папка в `.gitignore`): `probe.js`, `layout.js`, `pos.js`, `verify2.js`,
`click4.js` и др.

**Режим живой правки** (чтобы CSS подхватывался на лету):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/live-start.ps1   # theme -> theme_live
# правим файлы в theme_live — окно перерисовывается ~0.2 c
powershell -ExecutionPolicy Bypass -File scripts/live-stop.ps1    # theme_live -> theme + копия, live удаляется
```

Лог загрузчика: `%APPDATA%\YandexMusic\custom-theme.log` (видно, какая папка
активна и сколько символов CSS применено). Лог приложения:
`%APPDATA%\YandexMusic\logs\main.log`.

---

## 4. Структура «Моей волны» (актуально для 5.126.1)

После 5.126.1 «Моя волна» переехала на главный экран (`music-application://desktop/`).
Ключевое отличие от 5.124.1: раньше весь плеер лежал внутри `VibePage_meta`,
теперь колесо стало прямым ребёнком `VibePage_root`, а плеер разбит на
`entityMeta` (артист) + `playerBlock` (обложка/шкала/кнопки).

Дерево (упрощённо, с `data-test-id` и префиксами классов):

```
[class*=VibePage_root]                                   ← корень (grid: wheel | meta)
├─ section.swiper [WHEEL_DESKTOP] .VibePage_wheel_*      ← колесо жанров
│   └─ .WheelDesktop_wrapper_* > .swiper-slide [WHEEL_DESKTOP_SLIDE]
│       └─ .WheelDesktopItem_root_* > .WheelDesktopItem_element_*
│           └─ .HorizontalCardContainer_*.EntityCard_*.WheelItem_root_* [WHEEL_VIBE_ITEM|ALBUM|PROMO|RESHUFFLE]
│               ├─ .WheelItem_coverContainer_* > .PlayButtonWithCover_* [PLAY_BUTTON_WITH_COVER]
│               └─ .WheelItem_entityMeta_* > .WheelItem_titleContainer_* > [WHEEL_ITEM_TITLE]
└─ div [VIBE_META] .VibePage_meta_*
    ├─ .VibePage_bigCardPanelBackground_*                 ← скрываем
    ├─ .VibePage_context_*.VibeResetButton_root_* [context] ← подпись режима + крестик
    │   └─ button [RESET_VIBE_CONTEXT_BUTTON] .VibeResetButton_button_*
    │       ├─ span .VibeResetButton_context_*            ← «Моя волна» / «Мне нравится»
    │       └─ svg [RESET_VIBE_CONTEXT_BUTTON_ICON] .VibeResetButton_icon_*  ← крестик
    ├─ .VibePage_entityMeta_*
    │   ├─ .VibeWidgetAnimation_root_*.VibePage_vibeAnimation_* [VIBE_ANIMATION] ← «клякса»
    │   └─ .VibePage_entityMetaBody_* > .VibePage_textContainer_*
    │       └─ .VibeDynamicArtists_root_* [VIBE_DYNAMIC_ARTISTS]
    │           └─ a [SEPARATED_ARTIST_TITLE]  (или span [VIBE_DYNAMIC_TITLE_VIBE])
    └─ .VibePage_playerBlock_*
        ├─ section [VIBE_PLAYERBAR] .VibePlayerBar_root_*.VibePage_player_*
        │   ├─ .AlbumCover_root_*.VibePage_albumCover_* > .AlbumCover_coverContainer_* [VIBE_ALBUM_COVER] > a .AlbumCover_link_*
        │   ├─ .VibePlayerBar_progress_*                    ← flatten
        │   │   ├─ .ChangeVolume_root_* > [CHANGE_VOLUME_BUTTON] + [CHANGE_VOLUME_SLIDER]
        │   │   ├─ button [DISLIKE_BUTTON]
        │   │   ├─ .VibePlayerbarTimecodeContent_root_* [VIBE_PLAYERBAR_TIMECODE_SLIDER] ← flatten
        │   │   │   ├─ .VibePlayerbarTimecodeContent_center_* > [VIBE_PLAYERBAR_TRACK_NAME] + input.VibePlayerbarMeta_slider_*
        │   │   │   └─ span [VIBE_PLAYERBAR_TIMECODE] > [TIMECODE_TIME_START] / [TIMECODE_TIME_END]
        │   │   ├─ button [LIKE_BUTTON]
        │   │   └─ div > button [VIBE_CONTEXT_MENU_BUTTON]
        │   └─ .VibePlayerControls_root_* > [PREVIOUS_TRACK_BUTTON] [PLAY_BUTTON|PAUSE_BUTTON] [NEXT_TRACK_BUTTON]
        └─ .VibePage_words_* [WORDS_CARD]                    ← скрываем
```

Селекторы в теме пишутся через `[class*='…']` (хеш сборки в конце класса
меняется между версиями) и `data-test-id` (стабильнее).

**Приём вёрстки:** обёртки `entityMeta / entityMetaBody / textContainer /
VibeDynamicArtists_root / playerBlock / VIBE_PLAYERBAR / VibePlayerBar_progress /
VibePlayerbarTimecodeContent_root / _center` делаются `display: contents`, после
чего все «плоские» элементы раскладываются сеткой `VibePage_meta` через
`grid-template-areas`:

```
context | cover | artist | title | seek | time | controls | volume dislike like menu
```

---

## 5. Как чинить после обновления приложения

1. Приложение обновляется само и заменяет `app.asar` + exe → тема отваливается.
   Сначала просто `apply.ps1` (пересоберёт патч; если версия поменялась —
   пересоздаст бэкапы).
2. Если раздел «Моя волна» сломался (классы/структура изменились):

   ```powershell
   # извлечь новый оригинальный asar (бэкап от apply — это и есть оригинал новой версии)
   python tools/asar.py extract "$env:LOCALAPPDATA\Programs\YandexMusic\resources\app.asar.orig" reference-new --only /package.json,/index.js,/app/_next/static/chunks,/app/_next/static/css
   ```

   Затем `grep` по `reference-new` на предмет новых имён классов
   (`VibePage_`, `VibePlayerbar`, `WheelDesktop` и т.п.), либо (лучше) поднять
   приложение с CDP и снять живой DOM через `cdp.mjs html` + `eval`.
3. Обновить `theme/20-wave.css` (и при необходимости `theme/custom.js`) под
   новую структуру, сверяясь с пробой позиций (`pos.js`/`verify2.js`).
4. `live-stop.ps1` зафиксирует правки в `theme/` и копии у приложения.

`reference/` в репозитории исторически от 5.124.1 и устарел — при желании
заменить на полную выгрузку нового asar.

---

## 6. Ключевые классы / data-test-id (шпаргалка)

**«Моя волна»:** `VibePage_root`, `VibePage_meta`, `VibePage_playerBlock`,
`VibePage_player`, `VibePage_entityMeta`, `VibePage_entityMetaBody`,
`VibePage_textContainer`, `VibePage_albumCover`, `VibePage_wheel`,
`VibePage_bigCardPanel`, `VibePage_bigCardPanelBackground`,
`VibePage_context`, `VibePage_words`, `VibePage_vibeAnimation`,
`VibeDynamicArtists_root`, `VibeWidgetAnimation_root`.

**Плеер:** `VibePlayerBar_root`, `VibePlayerBar_progress`, `VibePlayerBar_button`,
`VibePlayerbarTimecodeContent_root` / `_center` / `_trackName`,
`VibePlayerbarMeta_slider` (input шкалы), `VibePlayerbarTrackName_trackNameText`,
`VibePlayerControls_root` / `_playButton` / `_skipButton`.

**Сброс/контекст:** `VibeResetButton_root` / `_button` / `_context` / `_icon`.

**Обложка:** `AlbumCover_root` / `_coverContainer` / `_link`.

**Колесо:** `WheelDesktop_root` / `_wrapper` / `_slide`, `WheelDesktopItem_root` /
`_element` / `_shimmer`, `WheelItem_root` / `_coverContainer` / `_entityMeta` /
`_titleContainer` / `_title` / `_description`, `PlayButtonWithCover_*`,
`VibeSmallView_root`.

**Громкость:** `ChangeVolume_root` / `_wrapperSlider` / `_slider` / `_button`.

**Прочее:** `CommonLayout_root`, `MainPage_vibeWidgetContainer`, `BarBelow_*`,
`Content_main`, `DefaultLayout_rootNewVibe`.

**data-test-id:** `VIBE_META`, `VIBE_PLAYERBAR`, `VIBE_ALBUM_COVER`,
`VIBE_DYNAMIC_ARTISTS`, `VIBE_DYNAMIC_TITLE_VIBE`, `VIBE_PLAYERBAR_TRACK_NAME`,
`VIBE_PLAYERBAR_TIMECODE`, `VIBE_PLAYERBAR_TIMECODE_SLIDER`,
`TIMECODE_TIME_START`, `TIMECODE_TIME_END`, `VIBE_CONTEXT_MENU_BUTTON`,
`DISLIKE_BUTTON`, `LIKE_BUTTON`, `CHANGE_VOLUME_BUTTON`, `CHANGE_VOLUME_SLIDER`,
`PLAY_BUTTON`, `PAUSE_BUTTON`, `PREVIOUS_TRACK_BUTTON`, `NEXT_TRACK_BUTTON`,
`WHEEL_DESKTOP`, `WHEEL_DESKTOP_SLIDE`, `WHEEL_ITEM_TITLE`,
`WHEEL_ITEM_DESCRIPTION`, `WHEEL_VIBE_ITEM`, `WHEEL_ALBUM_ITEM`,
`WHEEL_PROMO_ITEM`, `WHEEL_RESHUFFLE_ITEM`, `PLAY_BUTTON_WITH_COVER`,
`RESET_VIBE_CONTEXT_BUTTON`, `RESET_VIBE_CONTEXT_BUTTON_ICON`,
`SEPARATED_ARTIST_TITLE`.

---

## 7. Что сделано в этой сессии (для контекста)

1. Переписана сетка «Моей волны» под 5.126.1 (обложка/артист/название/шкала/
   таймкод/кнопки + ряд volume/dislike/like/menu; колесо — узкий список слева).
2. Восстановлен таймкод: штатный `[VIBE_PLAYERBAR_TIMECODE]` — это всплывашка
   у ползунка (`position: absolute; opacity: 0`), тема делает его постоянным
   (`position: static; opacity: 1; grid-area: time`).
3. Фон: `CommonLayout_root` — сплошная заливка (`background-image: none`) вместо
   штатного градиента, приглушённого `background-blend-mode: multiply`;
   анимация-«клякса» `VibeWidgetAnimation_root` возвращена как мягкое свечение
   (`position: fixed; opacity: .32; mix-blend-mode: screen`).
4. **Серая полоса, «дублирующая» полосу прогресса** — это дорожка (track) и буфер
   штатного ползунка `VibePlayerbarMeta_slider`: её рисует
   `::-webkit-slider-runnable-track` градиентом из
   `--ym-slider-color-primary-progress` (буфер) и `--ym-slider-color-primary-disabled`
   (дорожка). На «Моей волне» эти две переменные переопределены в `transparent`
   (внутри `[class*='VibePage_root']`), остался только оранжевый прогресс `::before`.
   Плюс скрыты `::before/::after` у `VibePlayerbarTimecodeContent_center/_root` и
   `VibePlayerBar_progress` (это фоновые полосы прогресса). Низовой плеер внизу
   окна (`ChangeTimecodeBackground_*`) НЕ трогаем — там полоса нужна.
5. Значок explicit (18+) рядом с обложкой: скрыт
   `[class*='VibePlayerbarTimecodeContent_explicitMarkContainer']` (у колеса свои
   `WheelItem_explicitMarkContainer` — их не трогаем).
6. Восстановлена подпись режима и крестик сброса: `VibePage_context` +
   `VibeResetButton_*` (кнопка сброса показывается приложением только когда есть
   что сбрасывать — «Мне нравится» и т.п., а не на дефолтной «Моей волне»).
7. Кликабельность: имя исполнителя — это `<a [SEPARATED_ARTIST_TITLE]>`
   (работает; добавлен hover). Название трека — НЕ ссылка в новом приложении,
   поэтому в `custom.js` добавлен обработчик: клик по
   `[VIBE_PLAYERBAR_TRACK_NAME]` кликает по ссылке альбома с обложки.
8. Бегущая строка: у блока исполнителя `[class*='VibeDynamicArtists_root'] > *`
   добавлен `overflow: hidden !important` и `max-width: var(--ymc-cover) !important`,
   чтобы длинная подпись обрезалась по границе, как название трека.

---

## 8. Известные грабли / чек-лист

- **Не запускается после `Stop-Process`:** см. раздел 2 — запускать через
  `explorer.exe`/ярлык, а не `Start-Process` из песочницы DSH.
- **`custom.js` не подхватывается после правки:** он не горячий — нужен
  `location.reload()` (или перезапуск).
- **Модель без картинок:** скриншоты сохраняются (`cdp.mjs shot`), но «смотреть»
  их нельзя — полагаться на `getBoundingClientRect()`/`getComputedStyle()`.
- **`elementFromPoint` возвращает `display: contents` элемент:** это нормальное
  поведение Chromium; реальный верхний бок — следующий в `elementsFromPoint()`,
  а не `elementFromPoint()`.
- **Таймкод/контекст иногда «пропадают»:** приложение рендерит их динамически —
  при переходах треков бывают моменты, когда элемента временно нет в DOM.
- **`--remote-debugging-port` при прямом `Start-Process`:** приложение может
  стартануть, но потом умереть от single-instance — используй ярлык+explorer.
- **После `apply.ps1` хеш не меняется:** это нормально, если контент `index.js`
  не изменился (хеш заголовка asar остаётся прежним — `patch_exe_integrity.py`
  это и проверяет).
