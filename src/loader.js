/*! YaMusicCustom loader v1
 *
 * Этот код дописывается в конец `index.js` внутри app.asar и живёт в главном
 * процессе Electron. Он ничего не патчит в самом приложении: он только
 * добавляет в окно пользовательский CSS из папки темы (и, по желанию, JS).
 *
 * Точки расширения:
 *   - folder  : __THEME_DIR__  (подставляется скриптом патча)
 *   - CSS     : все *.css в папке темы, в алфавитном порядке, склеиваются
 *   - JS      : необязательный custom.js, выполняется в каждом документе
 *   - горячая перезагрузка: правка CSS перерисовывает окно без перезапуска
 *   - Ctrl+Alt+T: включить/выключить тему
 */
(function () {
  'use strict';

  var MARKER = 'YaMusicCustom:loader';
  var fs, path, electron;
  try {
    fs = require('node:fs');
    path = require('node:path');
    electron = require('electron');
  } catch (error) {
    return;
  }

  // Порядок поиска папки с темой: сначала папка проекта (удобно править
  // на лету), затем копия внутри приложения — она остаётся, даже если
  // папку проекта удалить.
  var THEME_DIRS = __THEME_DIRS__;
  var LOG_FILE = path.join(electron.app.getPath('userData'), 'custom-theme.log');
  var MAX_LOG = 256 * 1024;

  var activeThemeDir = null;

  function resolveThemeDir() {
    for (var i = 0; i < THEME_DIRS.length; i += 1) {
      try {
        if (fs.statSync(THEME_DIRS[i]).isDirectory()) {
          if (activeThemeDir !== THEME_DIRS[i]) {
            activeThemeDir = THEME_DIRS[i];
            log('theme dir: ' + activeThemeDir);
          }
          return activeThemeDir;
        }
      } catch (error) {
        /* папки нет — пробуем следующую */
      }
    }
    activeThemeDir = null;
    return null;
  }

  function log(message) {
    try {
      if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG) {
        fs.writeFileSync(LOG_FILE, '');
      }
      fs.appendFileSync(
        LOG_FILE,
        '[' + new Date().toISOString() + '] ' + message + '\r\n',
        'utf8'
      );
    } catch (error) {
      /* логи не должны ронять приложение */
    }
  }

  // файлы темы могут быть сохранены с BOM (PowerShell так делает по умолчанию);
  // внутри одной таблицы стилей BOM в начале ломает разбор, поэтому срезаем
  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function readCss() {
    var dir = resolveThemeDir();
    if (!dir) {
      log('readCss: theme dir not found');
      return '';
    }
    try {
      var files = fs
        .readdirSync(dir)
        .filter(function (name) {
          return /\.css$/i.test(name);
        })
        .sort();
      var parts = [];
      for (var i = 0; i < files.length; i += 1) {
        var file = path.join(dir, files[i]);
        parts.push('/* ' + files[i] + ' */\n' + stripBom(fs.readFileSync(file, 'utf8')));
      }
      return parts.join('\n\n');
    } catch (error) {
      log('readCss failed: ' + error);
      return '';
    }
  }

  function readJs() {
    var dir = resolveThemeDir();
    if (!dir) return '';
    try {
      var file = path.join(dir, 'custom.js');
      if (!fs.existsSync(file)) return '';
      var source = stripBom(fs.readFileSync(file, 'utf8')).trim();
      return source ? source : '';
    } catch (error) {
      log('readJs failed: ' + error);
      return '';
    }
  }

  var state = {
    disabled: false,
    cssKey: null,
    lastCss: null,
  };

  function isThemedPage(wc) {
    try {
      var url = wc.getURL() || '';
      return url.indexOf('music-application://') === 0;
    } catch (error) {
      return false;
    }
  }

  function dropCss(wc) {
    if (!state.cssKey) return;
    var key = state.cssKey;
    state.cssKey = null;
    try {
      var result = wc.removeInsertedCSS(key);
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (error) {
      /* документ уже уехал — ключ недействителен */
    }
  }

  function apply(wc, force) {
    if (!wc || wc.isDestroyed()) return;
    if (!isThemedPage(wc)) {
      log('skip apply: url=' + (wc.getURL() || '').slice(0, 60));
      return;
    }

    var css = state.disabled ? '' : readCss();
    if (!css) {
      log('apply: css empty (disabled=' + state.disabled + ')');
      dropCss(wc);
      state.lastCss = null;
      return;
    }
    if (!force && css === state.lastCss) return;

    dropCss(wc);
    state.lastCss = css;
    try {
      var inserted = wc.insertCSS(css);
      log('apply: css=' + css.length + ' chars');
      if (inserted && typeof inserted.then === 'function') {
        inserted
          .then(function (key) {
            state.cssKey = key;
            log('apply: inserted key=' + key);
          })
          .catch(function (error) {
            log('insertCSS failed: ' + error);
          });
      }
    } catch (error) {
      log('insertCSS threw: ' + error);
    }
  }

  function runUserJs(wc) {
    var source = state.disabled ? '' : readJs();
    if (!source) return;
    try {
      wc
        .executeJavaScript(
          '(function(){try{' + source + '\n}catch(e){console.error("[YaMusicCustom]",e)}})();',
          true
        )
        .catch(function (error) {
          log('custom.js failed: ' + error);
        });
    } catch (error) {
      log('custom.js threw: ' + error);
    }
  }

  function applyAll(force) {
    var windows = electron.BrowserWindow.getAllWindows();
    for (var i = 0; i < windows.length; i += 1) {
      var win = windows[i];
      if (win.isDestroyed()) continue;
      apply(win.webContents, force);
    }
  }

  // --- горячая перезагрузка темы -------------------------------------------------
  var reloadTimer = null;
  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      reloadTimer = null;
      state.lastCss = null;
      watchTheme(); // папка могла появиться/исчезнуть — переподписываемся
      applyAll(true);
    }, 150);
  }

  var watchedDir = null;
  var watcher = null;

  function watchTheme() {
    var dir = resolveThemeDir();
    if (!dir || dir === watchedDir) return;
    if (watcher) {
      try {
        watcher.close();
      } catch (error) {
        /* уже закрыт */
      }
      watcher = null;
    }
    watchedDir = dir;
    try {
      watcher = fs.watch(dir, { persistent: false }, function () {
        scheduleReload();
      });
      log('watching: ' + dir);
    } catch (error) {
      log('watch failed: ' + error);
    }
  }

  watchTheme();

  // Папка theme_live может появиться или исчезнуть в любой момент (запустили
  // live-start.ps1 / live-stop.ps1). Раз в пару секунд проверяем, не сменилась
  // ли активная папка, и переключаемся без перезапуска приложения.
  setInterval(function () {
    var before = activeThemeDir;
    var current = resolveThemeDir();
    if (current !== before) {
      state.lastCss = null;
      watchTheme();
      applyAll(true);
    }
  }, 2000).unref();

  // --- запоминание размера и положения окна --------------------------------------
  var BOUNDS_FILE = path.join(electron.app.getPath('userData'), 'window-bounds.json');
  var mainWindow = null;

  function readBounds() {
    try {
      var data = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8'));
      if (
        data &&
        typeof data.x === 'number' &&
        typeof data.y === 'number' &&
        typeof data.width === 'number' &&
        typeof data.height === 'number'
      ) {
        return data;
      }
    } catch (error) {
      /* файла ещё нет */
    }
    return null;
  }

  function isVisibleOnScreen(bounds) {
    var displays = electron.screen.getAllDisplays();
    for (var i = 0; i < displays.length; i += 1) {
      var area = displays[i].workArea;
      var overlapX =
        Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
      var overlapY =
        Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
      if (overlapX >= 160 && overlapY >= 120) return true;
    }
    return false;
  }

  function writeBounds(win) {
    try {
      if (!win || win.isDestroyed() || win.isFullScreen()) return;
      var bounds = win.getNormalBounds();
      fs.writeFileSync(
        BOUNDS_FILE,
        JSON.stringify({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized: win.isMaximized(),
        }),
        'utf8'
      );
    } catch (error) {
      log('save bounds failed: ' + error);
    }
  }

  function trackWindow(win) {
    if (mainWindow) return;
    mainWindow = win;

    var saved = readBounds();
    if (saved && isVisibleOnScreen(saved)) {
      try {
        win.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
        if (saved.maximized) win.maximize();
        log(
          'restored window: ' + saved.width + 'x' + saved.height +
            ' at ' + saved.x + ',' + saved.y + (saved.maximized ? ' (maximized)' : '')
        );
      } catch (error) {
        log('restore bounds failed: ' + error);
      }
    }

    var saveTimer = null;
    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = null;
        writeBounds(win);
      }, 500);
    }
    ['resize', 'move', 'maximize', 'unmaximize'].forEach(function (name) {
      win.on(name, scheduleSave);
    });
    win.on('close', function () {
      writeBounds(win);
    });
  }

  // --- подписка на окна ----------------------------------------------------------
  electron.app.on('web-contents-created', function (event, wc) {
    try {
      wc.on('dom-ready', function () {
        if (!isThemedPage(wc)) return;
        apply(wc, true);
        runUserJs(wc);
      });
      wc.on('before-input-event', function (inputEvent, input) {
        if (
          input &&
          input.type === 'keyDown' &&
          input.control &&
          input.alt &&
          String(input.key).toLowerCase() === 't'
        ) {
          state.disabled = !state.disabled;
          state.lastCss = null;
          log('theme ' + (state.disabled ? 'disabled' : 'enabled') + ' via Ctrl+Alt+T');
          apply(wc, true);
          inputEvent.preventDefault();
        }
      });
    } catch (error) {
      log('web-contents hook failed: ' + error);
    }
  });

  // Окна: запоминаем размер/позицию. Стили вешает обработчик выше
  // (web-contents-created), дублировать dom-ready здесь не нужно.
  electron.app.on('browser-window-created', function (event, win) {
    try {
      trackWindow(win);
    } catch (error) {
      log('window hook failed: ' + error);
    }
  });

  log(MARKER + ' active, theme dir: ' + THEME_DIR);
})();
