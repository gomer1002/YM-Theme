/* ============================================================================
   YaMusicCustom — адаптация списка жанров «Моей волны»
   ----------------------------------------------------------------------------
   Штатно это Swiper-«колесо» с крупными строками (~120 px). Мы делаем строки
   компактными и перехватываем выбор пункта.

   Важно: приложение слушает клики на уровне документа, поэтому перехват
   висит на window в фазе перехвата — иначе его обработчик успевает выбрать
   соседний жанр и «отматывает» наш выбор обратно.
   ========================================================================== */
(function () {
  'use strict';

  var WHEEL = 'section.swiper';
  var ROW_HEIGHT = 46; // px, желаемая высота строки списка

  // приложение реагирует на полную последовательность pointer/mouse событий,
  // обычный element.click() его не поднимает
  function simulateClick(element) {
    var rect = element.getBoundingClientRect();
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    element.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ buttons: 1 }, base)));
    element.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1 }, base)));
    element.dispatchEvent(new PointerEvent('pointerup', Object.assign({ buttons: 0 }, base)));
    element.dispatchEvent(new MouseEvent('mouseup', Object.assign({ buttons: 0 }, base)));
    element.dispatchEvent(new MouseEvent('click', Object.assign({ buttons: 0 }, base)));
  }

  function tune(el) {
    var swiper = el.swiper;
    if (!swiper) return;
    var height = el.clientHeight;
    if (!height) return;
    var perView = Math.max(3, Math.round(height / ROW_HEIGHT));
    if (swiper.params.slidesPerView !== perView) {
      try {
        swiper.params.slidesPerView = perView;
        swiper.update();
      } catch (error) {
        console.warn('[YaMusicCustom] wheel sizing failed', error);
      }
    }
  }

  function startPlaybackIfPaused(attempt) {
    var bar = document.querySelector('[data-test-id=VIBE_PLAYERBAR]');
    if (!bar) return;
    if (bar.querySelector('[data-test-id=PAUSE_BUTTON]')) return; // уже играет

    var play = bar.querySelector('[data-test-id=PLAY_BUTTON]');
    var disabled = play && (play.disabled || play.getAttribute('aria-disabled') === 'true');
    if (play && !disabled) {
      simulateClick(play);
      return;
    }

    if (attempt < 12) {
      setTimeout(function () {
        startPlaybackIfPaused(attempt + 1);
      }, 250);
    }
  }

  function wheelOf(target) {
    var slide = target.closest ? target.closest('.swiper-slide') : null;
    if (!slide) return null;
    var wheel = slide.closest('section.swiper');
    if (!wheel || !wheel.swiper) return null;
    return { slide: slide, wheel: wheel, swiper: wheel.swiper };
  }

  // гасим всю мышиную последовательность внутри списка, чтобы приложение
  // не выбрало пункт по своей (устаревшей) геометрии
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach(function (type) {
    window.addEventListener(
      type,
      function (event) {
        if (!wheelOf(event.target)) return;
        event.stopImmediatePropagation();
      },
      true,
    );
  });

  window.addEventListener(
    'click',
    function (event) {
      var found = wheelOf(event.target);
      if (!found) return;

      // кнопку play на обложке жанра не перехватываем
      if (event.target.closest('[data-test-id=PLAY_BUTTON], [data-test-id=PAUSE_BUTTON]')) return;

      var swiper = found.swiper;
      var index = swiper.slides ? swiper.slides.indexOf(found.slide) : -1;
      if (index < 0) return;

      event.stopImmediatePropagation();
      event.preventDefault();

      try {
        swiper.slideTo(index, 250);
      } catch (error) {
        console.warn('[YaMusicCustom] slideTo failed', error);
      }

      setTimeout(function () {
        startPlaybackIfPaused(0);
      }, 350);
    },
    true,
  );

  // --- клик по названию трека → альбом (как по обложке) ------------------------
  window.addEventListener(
    'click',
    function (event) {
      var title = event.target.closest('[data-test-id=VIBE_PLAYERBAR_TRACK_NAME]');
      if (!title) return;
      var coverLink = document.querySelector(
        '[class*="VibePage_albumCover"] a[href*="album"], [data-test-id="VIBE_ALBUM_COVER"] a[href*="album"]'
      );
      if (!coverLink) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      coverLink.click();
    },
    true,
  );

  // --- бегущая строка для длинных названий -----------------------------------
  // Название: внутренний блок шире видимой области — двигаем его transform'ом
  // (родитель обрезает по краям).
  // Исполнитель: блок сам обрезает текст по своей ширине — двигаем text-indent,
  // иначе поехал бы весь блок вместе с рамкой.
  var MARQUEE_X = 'ymc-marquee-x';
  var MARQUEE_INDENT = 'ymc-marquee-indent';

  function textNodes(box) {
    return [].slice.call(box.children).filter(function (child) {
      return getComputedStyle(child).display !== 'none';
    });
  }

  function stopMarquee(element) {
    if (!element) return;
    element.classList.remove(MARQUEE_X, MARQUEE_INDENT);
    element.style.removeProperty('--ymc-shift');
    element.style.removeProperty('--ymc-duration');
  }

  function startMarquee(element, overflow, className) {
    var duration = Math.min(16, Math.max(6, overflow / 45)).toFixed(1) + 's';
    element.style.setProperty('--ymc-shift', '-' + Math.round(overflow) + 'px');
    element.style.setProperty('--ymc-duration', duration);
    element.classList.add(className);
  }

  function marqueeTitle(box) {
    if (!box) return;
    stopMarquee(box);
    var visibleWidth = box.clientWidth;
    textNodes(box).forEach(function (child) {
      stopMarquee(child);
      var contentWidth = child.scrollWidth;
      if (contentWidth - visibleWidth < 8) return;
      startMarquee(child, contentWidth - visibleWidth, MARQUEE_X);
    });
  }

  function marqueeArtist(box) {
    if (!box) return;
    stopMarquee(box);
    var overflow = box.scrollWidth - box.clientWidth;
    if (overflow >= 8) startMarquee(box, overflow, MARQUEE_INDENT);
  }

  function refreshMarquees() {
    marqueeTitle(document.querySelector('[data-test-id=VIBE_PLAYERBAR_TRACK_NAME]'));
    [].slice
      .call(document.querySelectorAll('[class*=VibeDynamicArtists_root] > *'))
      .forEach(marqueeArtist);
  }

  // --- каркас -----------------------------------------------------------------
  function setup() {
    var el = document.querySelector(WHEEL);
    if (!el || !el.swiper) return false;
    tune(el);
    refreshMarquees();
    return true;
  }

  var attempts = 0;
  function bootstrap() {
    if (setup()) return;
    if (attempts < 60) {
      attempts += 1;
      setTimeout(bootstrap, 150);
    }
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(setup, 250);
  });

  bootstrap();

  // перерисовали страницу или сменился трек — пересчитываем и бегущую строку
  var observerTimer = null;
  var observer = new MutationObserver(function () {
    if (observerTimer) return;
    observerTimer = setTimeout(function () {
      observerTimer = null;
      var el = document.querySelector(WHEEL);
      if (el && el.swiper) tune(el);
      refreshMarquees();
    }, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
