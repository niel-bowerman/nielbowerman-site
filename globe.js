// Travels globe: NomadList trips (snapshot in travels.json) on a spinning d3 orthographic globe.
(function () {
  var wrap = document.querySelector('.globe');
  if (!wrap || !window.d3 || !window.topojson) return;
  var canvas = wrap.querySelector('canvas');
  var tip = wrap.querySelector('.globe-tip');
  var ctx = canvas.getContext('2d');
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var C = { sea: '#eef2f3', land: '#d6d9da', grid: 'rgba(0,0,0,.04)', rim: '#e2e6e7',
            arc: 'rgba(49,132,147,.4)', pulse: '#4fc3d6', dot: '#318493', halo: 'rgba(49,132,147,.18)' };

  var projection = d3.geoOrthographic().clipAngle(90).precision(.3);
  var path = d3.geoPath(projection, ctx);
  var graticule = d3.geoGraticule10();
  var sphere = { type: 'Sphere' };
  var land, arcs = [], cities = [], size = 0, rot = [10, -25], hover = null;

  Promise.all([
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json').then(function (r) { return r.json(); }),
    fetch('travels.json?v=202610221800').then(function (r) { return r.json(); })
  ]).then(function (res) {
    land = topojson.feature(res[0], res[0].objects.land);
    var t = res[1].trips, byPlace = {};
    t.forEach(function (trip, i) {
      var days = Math.max(1, (new Date(trip.end) - new Date(trip.start)) / 864e5);
      var c = byPlace[trip.place] || (byPlace[trip.place] = { name: trip.place, country: trip.country, lng: trip.lng, lat: trip.lat, days: 0, visits: 0 });
      c.days += days; c.visits++;
      var prev = t[i - 1];
      if (prev && (prev.lng !== trip.lng || prev.lat !== trip.lat)) {
        var a = [prev.lng, prev.lat], b = [trip.lng, trip.lat];
        arcs.push({ type: 'LineString', coordinates: [a, b], lerp: d3.geoInterpolate(a, b), len: d3.geoDistance(a, b), phase: Math.random() });
      }
    });
    cities = Object.keys(byPlace).map(function (k) { return byPlace[k]; });
    var s = res[1].stats, stats = document.querySelector('.globe-stats');
    if (stats) stats.textContent = s.cities + ' cities · ' + s.countries + ' countries · ' + s.distance_traveled_km.toLocaleString('en-GB') + ' km';
    wrap.classList.add('ready');
    resize(); loop();
  }).catch(function () { wrap.classList.add('failed'); });

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    size = wrap.clientWidth;
    canvas.width = canvas.height = size * dpr;
    canvas.style.width = canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    projection.scale(size / 2 - 2).translate([size / 2, size / 2]);
    draw();
  }

  function radius(c) { return 2 + Math.sqrt(c.days) * .35; }

  function visible(c) { return d3.geoDistance([c.lng, c.lat], [-rot[0], -rot[1]]) < Math.PI / 2; }

  // A short bright segment slides along each arc from origin to destination, fading in and out.
  function pulses(t) {
    ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = C.pulse;
    arcs.forEach(function (a) {
      var head = (t / 3200 + a.phase) % 1, tail = Math.max(0, head - Math.min(.35, .12 / a.len)), pts = [];
      for (var i = 0; i <= 8; i++) pts.push(a.lerp(tail + (head - tail) * i / 8));
      ctx.globalAlpha = Math.sin(Math.PI * head);
      ctx.beginPath(); path({ type: 'LineString', coordinates: pts }); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }

  function draw(t) {
    if (!land) return;
    t = t || 0;
    projection.rotate(rot);
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); path(sphere); ctx.fillStyle = C.sea; ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = C.land; ctx.fill();
    ctx.beginPath(); arcs.forEach(function (a) { path(a); });
    ctx.strokeStyle = C.arc; ctx.lineWidth = 1.2; ctx.stroke();
    if (!still) pulses(t);
    cities.forEach(function (c) {
      if (!visible(c)) return;
      var p = projection([c.lng, c.lat]), r = radius(c);
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 3, 0, 2 * Math.PI); ctx.fillStyle = C.halo; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], c === hover ? r + 1.5 : r, 0, 2 * Math.PI); ctx.fillStyle = C.dot; ctx.fill();
    });
    ctx.beginPath(); path(sphere); ctx.strokeStyle = C.rim; ctx.lineWidth = 1; ctx.stroke();
  }

  var dragging = false, last = 0;
  function loop(now) {
    if (!still && !dragging && !hover && last) rot[0] += (now - last) * .006;
    last = now || 0;
    draw(last);
    requestAnimationFrame(loop);
  }

  d3.select(canvas).call(d3.drag()
    .on('start', function () { dragging = true; wrap.classList.add('grabbing'); hide(); })
    .on('drag', function (e) {
      var k = 75 / projection.scale();
      rot[0] += e.dx * k;
      rot[1] = Math.max(-80, Math.min(80, rot[1] - e.dy * k));
    })
    .on('end', function () { dragging = false; wrap.classList.remove('grabbing'); }));

  canvas.addEventListener('pointermove', function (e) {
    if (dragging) return;
    var b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, best = null, bd = 12;
    cities.forEach(function (c) {
      if (!visible(c)) return;
      var p = projection([c.lng, c.lat]), d = Math.hypot(p[0] - x, p[1] - y);
      if (d < Math.max(bd, radius(c) + 4)) { best = c; bd = d; }
    });
    hover = best;
    if (!best) return hide();
    var days = Math.round(best.days);
    tip.innerHTML = '<strong>' + best.name + '</strong>' + best.country + ' · ' +
      (days >= 60 ? Math.round(days / 30) + ' months' : days + (days === 1 ? ' day' : ' days'));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.classList.add('on');
  });
  canvas.addEventListener('pointerleave', function () { hover = null; hide(); });
  function hide() { tip.classList.remove('on'); }

  window.addEventListener('resize', resize);
})();
