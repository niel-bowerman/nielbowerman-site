// Travels globe: NomadList trips (snapshot in travels.json) on a d3 orthographic globe.
// When it scrolls into view it replays the journey trip by trip, in compressed time, with the
// camera following the traveller; then it rests as a slowly spinning map of every route.
(function () {
  var wrap = document.querySelector('.globe');
  if (!wrap || !window.d3 || !window.topojson) return;
  var fig = wrap.closest('.globe-fig');
  var canvas = wrap.querySelector('canvas');
  var tip = wrap.querySelector('.globe-tip');
  var now = fig.querySelector('.globe-now');
  var bar = fig.querySelector('.globe-bar');
  var fill = fig.querySelector('.globe-bar-fill');
  var replayBtn = fig.querySelector('.globe-replay');
  var ctx = canvas.getContext('2d');
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var C = { sea: '#eef2f3', land: '#d6d9da', grid: 'rgba(0,0,0,.04)', rim: '#e2e6e7',
            arc: 'rgba(49,132,147,.4)', trail: 'rgba(49,132,147,.85)', pulse: '#4fc3d6',
            dot: '#318493', halo: 'rgba(49,132,147,.18)' };

  var projection = d3.geoOrthographic().clipAngle(90).precision(.3);
  var path = d3.geoPath(projection, ctx);
  var graticule = d3.geoGraticule10();
  var sphere = { type: 'Sphere' };
  var land, trips, arcs = [], legs = [], cities = [], size = 0, rot = [118, -28], hover = null;
  // mode: 'idle' (waiting to be seen) → 'play' (replaying) → 'done' (full map, spinning)
  var mode = still ? 'done' : 'idle', T = 0, pt = 0, scrubbing = false, dragging = false;

  var month = function (s) { return new Date(s).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };

  Promise.all([
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json').then(function (r) { return r.json(); }),
    fetch('travels.json?v=202610221800').then(function (r) { return r.json(); })
  ]).then(function (res) {
    land = topojson.feature(res[0], res[0].objects.land);
    trips = res[1].trips;
    build();
    var s = res[1].stats, stats = fig.querySelector('.globe-stats');
    if (stats) stats.textContent = s.cities + ' cities · ' + s.countries + ' countries · ' + s.distance_traveled_km.toLocaleString('en-GB') + ' km';
    if (mode === 'done') finish(); else { pt = 0; follow(1); }
    wrap.classList.add('ready');
    resize(); requestAnimationFrame(loop);
    watch();
  }).catch(function () { fig.classList.add('failed'); });

  // Lay the trips out on a compressed timeline: every flight takes about a third of a second
  // (a little longer for long ones) and every stay a beat that grows only with the log of its length.
  function build() {
    var byPlace = {};
    trips.forEach(function (trip, i) {
      var days = Math.max(1, (new Date(trip.end) - new Date(trip.start)) / 864e5);
      var c = byPlace[trip.place] || (byPlace[trip.place] = { name: trip.place, country: trip.country, lng: trip.lng, lat: trip.lat, days: 0, arrive: Infinity });
      c.days += days;
      trip.city = c; trip.days = days;
      var prev = trips[i - 1];
      if (prev && (prev.lng !== trip.lng || prev.lat !== trip.lat)) {
        var a = [prev.lng, prev.lat], b = [trip.lng, trip.lat], len = d3.geoDistance(a, b);
        var arc = { lerp: d3.geoInterpolate(a, b), len: len, alt: .02 + .09 * len, phase: Math.random(),
                    t0: T, t1: T + 260 + 200 * len / Math.PI };
        arcs.push(arc); legs.push({ fly: arc, trip: trip, t0: arc.t0, t1: arc.t1 }); T = arc.t1;
      }
      trip.t0 = T;
      c.arrive = Math.min(c.arrive, T);
      T += Math.min(520, 70 + 55 * Math.log2(1 + days));
      legs.push({ stay: trip, trip: trip, t0: trip.t0, t1: T });
    });
    cities = Object.keys(byPlace).map(function (k) { return byPlace[k]; });

    // Year ticks on the timeline bar, at the point in the replay where each year starts.
    var seen = {};
    trips.forEach(function (trip) {
      var y = trip.start.slice(0, 4);
      if (seen[y]) return;
      seen[y] = 1;
      var tick = document.createElement('span');
      tick.className = 'globe-tick'; tick.textContent = y;
      tick.style.left = (100 * trip.t0 / T) + '%';
      bar.appendChild(tick);
    });
  }

  function legAt(t) {
    for (var i = 0; i < legs.length; i++) if (t < legs[i].t1) return legs[i];
    return legs[legs.length - 1];
  }

  // Where the traveller is at replay time t: [lng, lat], plus how far along the current flight (or -1).
  function position(t) {
    var leg = legAt(t);
    if (leg.fly) {
      var f = d3.easeCubicInOut(Math.max(0, Math.min(1, (t - leg.t0) / (leg.t1 - leg.t0))));
      var p = leg.fly.lerp(f);
      p.arc = leg.fly; p.f = f;
      return p;
    }
    return [leg.stay.lng, leg.stay.lat];
  }

  // Flights arc up off the surface, higher the longer they are. d3's orthographic projection only
  // draws the surface, so lifted points are projected by hand: rotate, scale the unit vector by the
  // altitude, and hide a point only when the globe is in front of it.
  var RAD = Math.PI / 180, rotate = d3.geoRotation(rot);
  function lift(a, f) { return 1 + a.alt * Math.sin(Math.PI * f); }
  function screen(ll, r) {
    var p = rotate(ll), l = p[0] * RAD, f = p[1] * RAD, s = projection.scale(), t = projection.translate();
    var x = Math.cos(f) * Math.sin(l), y = Math.sin(f), z = Math.cos(f) * Math.cos(l);
    return { x: t[0] + s * r * x, y: t[1] - s * r * y, show: z > 0 || r * r * (x * x + y * y) > 1 };
  }
  function trace(a, f0, f1) {
    var n = Math.max(3, Math.ceil(48 * (f1 - f0) * (.3 + a.len))), pen = false;
    for (var i = 0; i <= n; i++) {
      var f = f0 + (f1 - f0) * i / n, q = screen(a.lerp(f), lift(a, f));
      if (!q.show) { pen = false; continue; }
      if (pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      pen = true;
    }
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    size = wrap.clientWidth;
    canvas.width = canvas.height = size * dpr;
    canvas.style.width = canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    projection.scale(size / 2 / 1.18 - 2).translate([size / 2, size / 2]);   // room for the arcs to rise
    draw(0);
  }

  function radius(c, days) { return 2 + Math.sqrt(days) * .35; }

  function visible(c) { return d3.geoDistance([c.lng, c.lat], [-rot[0], -rot[1]]) < Math.PI / 2; }

  // Ease the camera towards the traveller (k = 1 jumps straight there).
  function follow(k) {
    var p = position(pt);
    var d = ((-p[0] - rot[0]) % 360 + 540) % 360 - 180;   // shortest way round
    rot[0] += d * k;
    rot[1] += (-Math.max(-50, Math.min(55, p[1])) * .85 - rot[1]) * k;
  }

  // A short bright segment slides along each arc from origin to destination, fading in and out.
  function pulses(t) {
    ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = C.pulse;
    arcs.forEach(function (a) {
      var head = (t / 3200 + a.phase) % 1, tail = Math.max(0, head - Math.min(.35, .12 / a.len));
      ctx.globalAlpha = Math.sin(Math.PI * head);
      ctx.beginPath(); trace(a, tail, head); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }

  function draw(t) {
    if (!land) return;
    var full = mode === 'done';
    projection.rotate(rot);
    rotate = d3.geoRotation(rot);
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); path(sphere); ctx.fillStyle = C.sea; ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = C.land; ctx.fill();

    // Routes: all of them at rest; during the replay, the ones flown so far plus the one in progress.
    var cur = null;
    ctx.beginPath();
    arcs.forEach(function (a) {
      if (full || a.t1 <= pt) trace(a, 0, 1);
      else if (a.t0 < pt) cur = a;
    });
    ctx.strokeStyle = C.arc; ctx.lineWidth = 1.2; ctx.stroke();
    if (cur) {
      ctx.beginPath(); trace(cur, 0, d3.easeCubicInOut((pt - cur.t0) / (cur.t1 - cur.t0)));
      ctx.strokeStyle = C.trail; ctx.lineWidth = 1.8; ctx.stroke();
    }
    if (full && !still) pulses(t);

    // Cities appear as the traveller reaches them and grow with each stay.
    var daysSoFar = {};
    trips.forEach(function (trip) { if (full || trip.t0 <= pt) daysSoFar[trip.place] = (daysSoFar[trip.place] || 0) + trip.days; });
    cities.forEach(function (c) {
      if (!daysSoFar[c.name] || !visible(c)) return;
      var p = projection([c.lng, c.lat]), r = radius(c, daysSoFar[c.name]);
      if (!full) r *= d3.easeBackOut(Math.min(1, (pt - c.arrive) / 300));
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 3, 0, 2 * Math.PI); ctx.fillStyle = C.halo; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], c === hover ? r + 1.5 : r, 0, 2 * Math.PI); ctx.fillStyle = C.dot; ctx.fill();
    });

    if (!full) traveller(t);
    ctx.beginPath(); path(sphere); ctx.strokeStyle = C.rim; ctx.lineWidth = 1; ctx.stroke();
  }

  function traveller(t) {
    var pos = position(pt), q = screen(pos, pos.arc ? lift(pos.arc, pos.f) : 1);
    if (!q.show) return;
    var ring = (t % 1200) / 1200;
    ctx.beginPath(); ctx.arc(q.x, q.y, 5 + ring * 12, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(49,132,147,' + (.5 * (1 - ring)) + ')'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.dot; ctx.stroke();
  }

  function label() {
    var text, leg = legAt(pt);
    if (mode === 'done') text = month(trips[0].start) + ' – ' + month(trips[trips.length - 1].start);
    else if (mode === 'idle') text = '';
    else text = (leg.fly ? '→ ' : '') + month(leg.trip.start) + ' · ' + leg.trip.place + ', ' + leg.trip.country;
    if (now.textContent !== text) now.textContent = text;
    fill.style.width = (100 * pt / T) + '%';
    bar.setAttribute('aria-valuenow', Math.round(100 * pt / T));
  }

  function finish() {
    mode = 'done'; pt = T;
    fig.classList.add('done');
    label();
  }

  function play(from) {
    mode = 'play'; pt = from;
    fig.classList.remove('done');
  }

  var last = 0;
  function loop(t) {
    var dt = last ? Math.min(50, t - last) : 0;
    last = t;
    if (mode === 'play') {
      if (!scrubbing) pt += dt;
      if (pt >= T) finish();
      else if (!dragging) follow(1 - Math.exp(-dt / 280));
    } else if (mode === 'done' && !still && !dragging && !hover) {
      rot[0] += dt * .006;
    }
    if (mode !== 'idle') label();
    draw(t);
    requestAnimationFrame(loop);
  }

  // Start the replay the first time the globe is mostly on screen.
  function watch() {
    if (mode !== 'idle') return;
    if (!('IntersectionObserver' in window)) return play(0);
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { io.disconnect(); play(0); }
    }, { threshold: .5 });
    io.observe(wrap);
  }

  replayBtn.addEventListener('click', function () { play(0); follow(1); });

  // Timeline bar: drag to scrub; the replay carries on from wherever you let go.
  function scrubTo(e) {
    var b = bar.getBoundingClientRect();
    pt = Math.max(0, Math.min(T - 1, (e.clientX - b.left) / b.width * T));
  }
  bar.addEventListener('pointerdown', function (e) {
    if (!T) return;
    scrubbing = true; bar.setPointerCapture(e.pointerId);
    if (mode !== 'play') play(0);
    scrubTo(e); follow(1);
  });
  bar.addEventListener('pointermove', function (e) { if (scrubbing) { scrubTo(e); follow(.35); } });
  bar.addEventListener('pointerup', function () { scrubbing = false; });
  bar.addEventListener('pointercancel', function () { scrubbing = false; });
  bar.addEventListener('keydown', function (e) {
    var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || !T) return;
    e.preventDefault();
    var i = Math.max(0, Math.min(trips.length - 1, trips.indexOf(legAt(mode === 'done' ? T - 1 : pt).trip) + step));
    play(trips[i].t0); follow(1);
  });

  d3.select(canvas).call(d3.drag()
    .on('start', function () { dragging = true; wrap.classList.add('grabbing'); hide(); })
    .on('drag', function (e) {
      var k = 75 / projection.scale();
      rot[0] += e.dx * k;
      rot[1] = Math.max(-80, Math.min(80, rot[1] - e.dy * k));
    })
    .on('end', function () { dragging = false; wrap.classList.remove('grabbing'); }));

  canvas.addEventListener('pointermove', function (e) {
    if (dragging || mode !== 'done') return;
    var b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, best = null, bd = 12;
    cities.forEach(function (c) {
      if (!visible(c)) return;
      var p = projection([c.lng, c.lat]), d = Math.hypot(p[0] - x, p[1] - y);
      if (d < Math.max(bd, radius(c, c.days) + 4)) { best = c; bd = d; }
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
