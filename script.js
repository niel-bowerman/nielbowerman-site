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
  document.querySelectorAll('.hero-clip').forEach(function (v) {
    var speed = parseFloat(v.getAttribute('data-speed') || '1');
    v.muted = true;
    v.playbackRate = speed;
    v.addEventListener('playing', function () { v.playbackRate = speed; v.classList.add('on'); });
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
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
