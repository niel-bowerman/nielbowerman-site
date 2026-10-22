(function () {
  // Mobile menu
  var burger = document.querySelector('.burger');
  var menu = document.getElementById('menu');
  if (burger && menu) {
    burger.addEventListener('click', function () {
      menu.classList.add('open');
      burger.setAttribute('aria-expanded', 'true');
    });
    menu.querySelector('.close').addEventListener('click', function () {
      menu.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  }

  // Hero background clips: muted, looping, no controls. The still poster shows until playback starts.
  // data-loop-from: the clip's last stretch crossfades into its opening, so after the first play-through
  // each repeat jumps back to this time (seconds), not to the very start — a seamless loop that still
  // begins cleanly. (Without JavaScript the plain `loop` attribute just repeats the whole clip.)
  var play = function (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); };
  var clip = function (v) {
    var speed = parseFloat(v.getAttribute('data-speed') || '1');
    var loopFrom = parseFloat(v.getAttribute('data-loop-from'));
    v.muted = true;
    v.playbackRate = speed;
    v.addEventListener('playing', function () { v.playbackRate = speed; v.classList.add('on'); });
    if (!isNaN(loopFrom)) {
      v.loop = false;
      var again = function () { v.currentTime = loopFrom; play(v); };
      v.addEventListener('ended', again);
      if (v.requestVideoFrameCallback) {               // jump a frame early, so there's no pause at the end
        var watch = function (now, meta) {
          if (v.duration && meta.mediaTime >= v.duration - 0.045) again();
          v.requestVideoFrameCallback(watch);
        };
        v.requestVideoFrameCallback(watch);
      }
    }
  };

  // data-hd: start with the small clip in src so the banner moves almost at once, then fetch the
  // full-quality one behind it; once it can play through, start it on the same frame on top and
  // let it fade in (the .on transition), then drop the small one. Skipped on phones and on
  // connections that ask to save data or are slow.
  var conn = navigator.connection || {};
  var hdOk = window.innerWidth >= 768 && !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '');
  var upgrade = function (v) {
    var hd = v.cloneNode(false);
    hd.removeAttribute('autoplay');
    hd.classList.remove('on');
    hd.src = v.getAttribute('data-hd');
    hd.preload = 'auto';
    clip(hd);
    hd.addEventListener('canplaythrough', function go() {
      hd.removeEventListener('canplaythrough', go);
      hd.currentTime = v.currentTime + 0.1;          // a beat ahead, to allow for the seek
      play(hd);
      hd.addEventListener('transitionend', function () { v.remove(); }, { once: true });
    });
    v.after(hd);
    hd.load();
  };

  document.querySelectorAll('.hero-clip').forEach(function (v) {
    clip(v);
    if (v.hasAttribute('data-hd') && hdOk) {
      v.addEventListener('playing', function first() { v.removeEventListener('playing', first); upgrade(v); });
    }
    play(v);
  });

  // Contact form: opens the visitor's email app with the message filled in.
  var form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var g = function (n) { return (form.elements[n].value || '').trim(); };
      var phone = g('number') ? '\n\nPhone: ' + g('country') + ' ' + g('number') : '';
      var body = g('message') + '\n\n— ' + g('first') + ' ' + g('last') + ' (' + g('email') + ')' + phone;
      location.href = 'mailto:niel.bowerman@80000hours.org?subject=' + encodeURIComponent(g('subject')) +
        '&body=' + encodeURIComponent(body);
      var note = document.getElementById('form-note');
      if (note) note.classList.add('show');
    });
  }
})();
