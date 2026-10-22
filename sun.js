// Homepage hero: a sun behind the clouds that follows the mouse while it's over the sky, and
// relights the landscape to match. Drawn with WebGL over the hero video, using two maps made from
// the still landscape: images/hero-masks.png (R = sky, G = lochs, B = distance, A = can hold snow). The land itself is never
// shaded: light shows only in the sky and as reflections on the lochs. Clicking the hero changes the
// weather. Without WebGL, or with reduced motion, the plain video stays.
(function () {
  var hero = document.querySelector('.hero');
  var video = hero && hero.querySelector('.hero-clip');
  if (!video || !window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'hero-sun';
  canvas.setAttribute('aria-hidden', 'true');
  var debug = /[?&]sundebug\b/.test(location.search);   // for tuning: keeps frames readable, exposes setSun
  var gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false,
                                        preserveDrawingBuffer: debug });
  if (!gl) return;

  var VIDEO_ASPECT = 16 / 9;
  var DEFAULT_SUN = [0.30, 0.21];         // resting spot: 30% across the visible frame, clear of the header

  var vs = 'attribute vec2 p; varying vec2 vUv;' +
    'void main(){ vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }';

  var fs = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uVideo, uMasks;',
    'uniform vec2 uScale, uOffset, uSun;',
    'uniform float uAspect, uTime;',
    'uniform vec2 uRes;                                      // canvas size in pixels',
    // weather mix, each 0..1 (all 0 = the real overcast day); uFlash = lightning brightness
    'uniform float uClear, uGolden, uRain, uStorm, uSnow, uMist, uFlash;',
    'uniform vec2 uBolt;                                     // lightning: x position (frame uv) and a random seed',
    'float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }',
    // a jagged lightning channel: horizontal wander that gets finer and finer down its length
    'float boltX(float y, float seed){',
    '  float dx = 0.0, amp = 0.09, f = 7.0;',
    '  for (int i = 0; i < 6; i++) { dx += (vnoise(vec2(y * f, seed + float(i) * 7.13)) - 0.5) * amp; amp *= 0.55; f *= 2.2; }',
    '  return dx;',
    '}',
    // rain: thin slanted streaks in a grid of cells, one layer per depth (s is in screen heights)
    'float rainLayer(vec2 s, float t, float dens, float spd, float len){',
    '  s.x += s.y * 0.13;',
    '  s *= vec2(dens, dens * 0.30);',
    '  s.y -= t * spd;',
    '  vec2 id = floor(s), f = fract(s);',
    '  float h = hash(id);',
    '  float x = 0.1 + 0.8 * hash(id + 3.1);',
    '  float w = 0.9 * dens / uRes.y;                        // ~1px wide',
    '  float y = fract(f.y + hash(id + 7.7));',
    '  float streak = smoothstep(w * 1.5, 0.0, abs(f.x - x)) * smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(len - 0.05, len, y));',
    '  return streak * step(0.45, h) * (0.55 + 0.45 * hash(id + 1.3));',
    '}',
    // snow: soft round flakes that drift and sway
    'float snowLayer(vec2 s, float t, float dens, float spd, float px){',
    '  s *= dens;',
    '  s.y -= t * spd;',
    '  s.x += sin(t * 0.8 + floor(s.y) * 1.7) * 0.25;',
    '  vec2 id = floor(s), f = fract(s);',
    '  float h = hash(id);',
    '  vec2 c = vec2(0.2 + 0.6 * hash(id + 1.7), 0.2 + 0.6 * hash(id + 4.3));',
    '  float r = px * dens / uRes.y * (0.6 + 0.6 * h);',
    '  return smoothstep(r, r * 0.25, length(f - c)) * step(0.4, h);',
    '}',
    'void main(){',
    '  vec2 uv = vUv * uScale + uOffset;',
    '  vec3 col = texture2D(uVideo, uv).rgb;',
    '  vec4 mm = texture2D(uMasks, uv);',
    '  vec3 m = mm.rgb;',
    '  float hold = mm.a;                                    // can this spot hold snow?',
    '  float sky = m.r, water = m.g, dist = m.b;',
    '  vec3 sunCol = vec3(1.0, 0.92, 0.78);',
    '  vec2 d = (uv - uSun) * vec2(uAspect, 1.0);          // offset from the sun, in frame heights',
    '  float r = length(d);',
    // how much the cloud right in front of the sun lets through (brighter cloud = thinner)
    '  float lumSun = luma(texture2D(uVideo, uSun).rgb);',
    '  float wet = max(uRain, uStorm);',
    // how strong the sun is in this weather: bright on clear/golden days, gone in rain and storms
    '  float sunAmt = clamp(1.0 + 0.7 * uClear + 0.5 * uGolden - 0.95 * wet - 0.6 * uSnow - 0.6 * uMist, 0.0, 1.7);',
    '  float vis = mix(mix(0.62, 1.0, smoothstep(0.55, 0.92, lumSun)), 1.0, max(uClear, uGolden)) * sunAmt;',
    // --- the sky: a sun glowing through the clouds
    '  float lum = luma(col);',
    '  float trans = mix(mix(0.38, 1.0, smoothstep(0.50, 0.93, lum)), 1.0, max(uClear, uGolden));',
    '  float core = exp(-pow(r / 0.020, 2.0));',
    '  float halo = exp(-r / 0.075);',
    '  float wide = exp(-r / 0.34);',
    '  vec2 toward = -normalize(d + 1e-5) * 0.007 / vec2(uAspect, 1.0);',
    '  float lining = clamp((luma(texture2D(uVideo, uv + toward).rgb) - lum) * 16.0, 0.0, 1.0) * halo;',
    '  float glow = (core * 1.25 * trans + halo * 0.40 * pow(trans, 0.7) + wide * 0.10 + lining * 0.30) * vis;',
    '  float land = 1.0 - sky;',
    // clear day: open up blue sky behind the thinner cloud, keep the bright clouds as clouds
    '  vec3 blue = mix(vec3(0.20, 0.40, 0.74), vec3(0.55, 0.70, 0.88), pow(clamp(uv.y / 0.32, 0.0, 1.0), 1.5));',
    '  float cloud = smoothstep(0.66, 0.90, lum);',
    '  vec3 cloudCol = mix(col * 0.85, min(col * 1.22, vec3(1.0)), smoothstep(0.75, 0.92, lum));   // white tops, grey bases',
    '  col = mix(col, mix(blue, cloudCol, cloud), uClear * sky);',
    '  col = mix(col, vec3(0.20, 0.33, 0.52) + 0.25 * (col - 0.6), uClear * water * 0.75);   // lochs reflect the blue',
    '  vec3 lit = col;                                       // (no shading on the land)',
    // the sun's reflection: a glint on the lochs below it
    '  float under = exp(-pow((uv.x - uSun.x) * uAspect / 0.10, 2.0));',
    '  float ripple = 0.75 + 0.25 * sin(uTime * 2.3 + uv.x * 140.0 + uv.y * 60.0);',
    '  lit += sunCol * water * under * ripple * 0.30 * vis;',
    // the glow sits behind/in the sky
    '  lit = 1.0 - (1.0 - lit) * (1.0 - sunCol * glow * smoothstep(0.45, 1.0, sky));   // (soft rim on ridges, not a hard line)',
    '  lit += sunCol * wide * 0.035 * vis * sky;               // a whisper of bloom, in the sky only',
    // --- weather
    '  float g = luma(lit);',
    // clear: a touch brighter and more saturated; golden: warm cast, warmest low in the sky
    '  lit = mix(vec3(g), lit, 1.0 + 0.10 * uClear);',
    '  lit = mix(lit, ((lit - 0.42) * (1.0 + 0.28 * land * (0.4 + dist)) + 0.40) * mix(vec3(1.0), vec3(0.94, 0.98, 0.93), land), uClear);   // crisper, less hazy, deeper greens',
    '  float hz = smoothstep(0.04, 0.31, uv.y);                 // 1 near the horizon, 0 overhead',
    '  lit *= mix(vec3(1.0), mix(vec3(0.80, 0.66, 0.52), vec3(1.10, 0.94, 0.78), sky), uGolden);   // land: dimmer, warm',
    '  lit = mix(lit, lit * vec3(0.72, 0.74, 0.92), uGolden * sky * (1.0 - hz));           // cooler sky overhead',
    '  lit += (vec3(0.40, 0.14, 0.00) * hz + vec3(0.50, 0.24, 0.04) * exp(-r / 0.18)) * uGolden * sky;   // orange horizon, warm halo',
    '  lit = mix(lit, vec3(0.96, 0.64, 0.34) * (0.80 + 0.5 * under), uGolden * water * 0.80);   // lochs reflect the sunset (brighter than the land)',
    // rain and storm: greyer, darker, the distance lost in haze, streaks at three depths
    '  g = luma(lit);',
    '  lit = mix(lit, vec3(g), wet * (0.10 + 0.45 * dist)) * (1.0 - (0.18 * uRain + 0.36 * uStorm) * land);   // wet ground: darker, colour kept up close',
    '  lit *= mix(vec3(1.0), vec3(mix(0.70, 0.95, smoothstep(0.05, 0.31, uv.y))), wet * sky);   // heavy sky, lighter at the horizon',
    '  lit = mix(lit, lit * lit * 1.45, wet * land * (1.0 - dist) * 0.45);           // wet rock and grass up close: darker, richer',
    '  float curtains = 0.75 + 0.5 * vnoise(vec2(uv.x * 9.0 + uTime * 0.04, 0.5));   // drifting rain curtains in the distance',
    '  lit = mix(lit, vec3(0.56, 0.60, 0.65) * (1.0 - 0.3 * uStorm), clamp(wet * (0.10 + 0.55 * dist * mix(1.0, curtains, land)), 0.0, 0.9));   // one rule for land and sky, so no seams',
    '  vec2 s = vec2(vUv.x * uRes.x / uRes.y, vUv.y);',
    '  float streaks = rainLayer(s, uTime, 55.0, 9.0, 0.75) + 0.7 * rainLayer(s + 3.7, uTime, 85.0, 6.5, 0.65) + 0.45 * rainLayer(s + 9.1, uTime, 130.0, 4.5, 0.55);',
    '  lit = mix(lit, vec3(0.86, 0.89, 0.93), clamp(streaks, 0.0, 1.0) * (0.24 * uRain + 0.34 * uStorm));',
    // lightning: the clouds flare, the land is lit from above
    '  lit *= mix(vec3(1.0), vec3(0.80, 0.80, 0.92), uStorm * sky);                // bruised, blue-grey storm sky',
    // lightning: a forked bolt in the sky (behind the hills), the clouds round it lit from within
    '  float bx = uBolt.x * uAspect, px = uv.x * uAspect, yb = uv.y;',
    '  float dMain = abs(px - (bx + boltX(yb, uBolt.y)));',
    '  float yFork = 0.10 + 0.08 * hash(vec2(uBolt.y, 1.0));',
    '  float dFork = abs(px - (bx + boltX(yFork, uBolt.y) + (yb - yFork) * (0.55 * sign(hash(vec2(uBolt.y, 2.0)) - 0.5)) + (boltX(yb, uBolt.y + 3.3) - boltX(yFork, uBolt.y + 3.3)) * 0.8));',
    '  float span = smoothstep(0.0, 0.02, yb) * (1.0 - smoothstep(0.27, 0.32, yb));',
    '  float fork = step(yFork, yb) * (1.0 - smoothstep(yFork + 0.07, yFork + 0.14, yb));',
    '  float px1 = 1.0 / uRes.y;',
    '  float boltCore = smoothstep(1.8 * px1, 0.0, dMain) * span + 0.85 * smoothstep(1.4 * px1, 0.0, dFork) * span * fork;',
    '  float glowB = exp(-dMain / 0.012) * span * 0.6 + exp(-length(vec2(px - bx, (yb - 0.06) * 1.5)) / 0.20) * 0.65;   // the cloud it came from lights up',
    '  lit += vec3(0.86, 0.84, 1.0) * (boltCore * 1.6 + glowB * clamp(1.4 * lum - 0.2, 0.2, 1.0)) * uFlash * sky;',
    '  lit *= 1.0 + uFlash * (0.10 + 0.12 * dist) * land;                              // a brief lift on the land',
    // snow: lies only where the ground can hold it (hold: smooth ground yes, craggy rock faces no), thicker
    // on the brighter, more open bits; the bare rock goes dark and cold, the lochs dark, the sky pale grey,
    // and falling snow veils the distance
    '  float grassy = smoothstep(0.02, 0.10, col.g - 0.5 * (col.r + col.b)) * land * (1.0 - water);   // grass and moss whiten first',
    '  float cover = max(hold, grassy * 0.9) * smoothstep(0.20, 0.50, lum + 0.14 * (vnoise(uv * vec2(170.0, 110.0)) - 0.5)) * mix(0.75, 1.0, dist);',
    '  vec3 snowCol = vec3(0.87, 0.90, 0.95) * (0.84 + 0.35 * (lum - 0.42));      // keeps a little texture',
    '  vec3 snowy = mix(lit * vec3(0.74, 0.77, 0.84), snowCol, cover * 0.95);',
    '  snowy = mix(snowy, vec3(0.27, 0.31, 0.36), water * 0.8);',
    '  snowy = mix(snowy, vec3(0.80, 0.82, 0.86), sky * 0.65);',
    '  snowy = mix(snowy, vec3(0.84, 0.86, 0.90), 0.06 + 0.32 * dist);',
    '  lit = mix(lit, snowy, uSnow);',
    '  float flakes = snowLayer(s, uTime, 14.0, 0.09, 4.5) + snowLayer(s + 5.3, uTime, 24.0, 0.06, 3.2) + snowLayer(s + 11.7, uTime, 40.0, 0.04, 2.2);',
    '  lit = mix(lit, vec3(0.97, 0.98, 1.0), clamp(flakes, 0.0, 1.0) * 0.85 * uSnow);',
    // mist: hill fog: thickens with distance and with height, so the tops vanish into the cloud
    '  float high = smoothstep(0.42, 0.14, uv.y);                 // low cloud: the higher up, the deeper in it',
    '  float wisps = vnoise(vec2(uv.x * 5.0 - uTime * 0.03, uv.y * 14.0)) - 0.5;',
    '  lit = mix(lit, vec3(0.83, 0.85, 0.87), uMist * clamp(0.08 + 0.45 * dist + 1.05 * high + 0.25 * wisps, 0.0, 0.97));',
    '  gl_FragColor = vec4(clamp(lit, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  var prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { if (debug) console.error(e); return; }   // fall back to the plain video
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  function texture(unit, name) {
    var t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    return t;
  }
  var tVideo = texture(0, 'uVideo'), tMasks = texture(1, 'uMasks');
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);   // masks are data, not a picture
  var u = {};
  ['uScale', 'uOffset', 'uSun', 'uAspect', 'uTime', 'uRes', 'uFlash', 'uBolt'].forEach(function (k) { u[k] = gl.getUniformLocation(prog, k); });

  // --- weather (an Easter egg, so no hint): click or tap the hero for a random change; it blends over a
  // couple of seconds. Always starts on the real overcast day.
  var WEATHERS = ['overcast', 'clear', 'golden', 'rain', 'storm', 'snow', 'mist'];
  var UNIFORM = { clear: 'uClear', golden: 'uGolden', rain: 'uRain', storm: 'uStorm', snow: 'uSnow', mist: 'uMist' };
  var mix = {}, weather = 'overcast';
  Object.keys(UNIFORM).forEach(function (w) { mix[w] = 0; u[UNIFORM[w]] = gl.getUniformLocation(prog, UNIFORM[w]); });
  function setWeather(w) { weather = w; nextFlash = performance.now() + 1500; }
  hero.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a, button')) return;
    var others = WEATHERS.filter(function (w) { return w !== weather; });
    setWeather(others[Math.floor(Math.random() * others.length)]);
  });
  // lightning: in a storm, a flash every few seconds, often with a second flicker
  var flash = 0, nextFlash = 0, flicker = 0, bolt = [0.3, 1.0];
  function lightning(now) {
    if (mix.storm > 0.6 && now > nextFlash) {
      flash = 0.8 + Math.random() * 0.4;
      bolt = [offset[0] + scale[0] * (0.08 + Math.random() * 0.84), Math.random() * 100];   // somewhere new in the visible sky
      flicker = Math.random() < 0.6 ? now + 90 + Math.random() * 120 : 0;
      nextFlash = now + 2500 + Math.random() * 6000;
    }
    if (flicker && now > flicker) { flash = Math.max(flash, 0.6 + Math.random() * 0.3); flicker = 0; }
    flash *= Math.exp(-(now - (lightning.t || now)) / 70); lightning.t = now;   // fades in ~0.2s
    return heldFlash !== null ? heldFlash : flash * mix.storm;
  }
  var heldFlash = null;                   // (testing only: see setWeather below)

  // the sky mask, kept small on the side, to know whether the mouse is over the sky
  var skyData = null, SKY_W = 160, SKY_H = 90;
  var loaded = 0;
  function load(src, tex, keepSky) {
    var img = new Image();
    img.onload = function () {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);   // A = can hold snow
      if (keepSky) {
        var c = document.createElement('canvas'); c.width = SKY_W; c.height = SKY_H;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0, SKY_W, SKY_H);
        skyData = x.getImageData(0, 0, SKY_W, SKY_H).data;
      }
      loaded++;
    };
    img.src = src;
  }
  load('images/hero-masks.png?v=202610221542', tMasks, true);

  // object-fit: cover, done by hand: which part of the video the canvas shows
  var scale = [1, 1], offset = [0, 0];
  function resize() {
    var w = hero.clientWidth, h = hero.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var px = Math.min(1, Math.sqrt(2600000 / (w * h * dpr * dpr)));   // cap the pixel count on huge screens
    canvas.width = Math.round(w * dpr * px); canvas.height = Math.round(h * dpr * px);
    gl.viewport(0, 0, canvas.width, canvas.height);
    var ca = w / h;
    if (ca > VIDEO_ASPECT) { scale = [1, VIDEO_ASPECT / ca]; offset = [0, (1 - VIDEO_ASPECT / ca) / 2]; }
    else { scale = [ca / VIDEO_ASPECT, 1]; offset = [(1 - ca / VIDEO_ASPECT) / 2, 0]; }
  }
  window.addEventListener('resize', resize);
  resize();

  // the resting spot, within whatever part of the frame is actually showing (phones crop the sides)
  var moved = false;
  function rest() { return [offset[0] + scale[0] * DEFAULT_SUN[0], DEFAULT_SUN[1]]; }
  var sun = rest(), target = rest();
  window.addEventListener('resize', function () { if (!moved) { sun = rest(); target = rest(); } });
  hero.addEventListener('pointermove', function (e) {
    if (!skyData) return;
    var r = hero.getBoundingClientRect();
    var vx = ((e.clientX - r.left) / r.width) * scale[0] + offset[0];
    var vy = ((e.clientY - r.top) / r.height) * scale[1] + offset[1];
    var sx = Math.max(0, Math.min(SKY_W - 1, Math.floor(vx * SKY_W)));
    var sy = Math.max(0, Math.min(SKY_H - 1, Math.floor(vy * SKY_H)));
    if (skyData[(sy * SKY_W + sx) * 4] > 140) { target = [vx, vy]; moved = true; }   // only while over the sky
  });

  if (debug) {
    window.setSun = function (x, y) { sun = [x, y]; target = [x, y]; };
    window.setWeather = function (w, instant) {
      setWeather(w);
      if (instant) Object.keys(mix).forEach(function (k) { mix[k] = k === w ? 1 : 0; });
    };
    window.holdFlash = function (v, x, seed) { heldFlash = v; if (x !== undefined) bolt = [x, seed || 1]; };
    window.getWeather = function () { return { weather: weather, mix: JSON.parse(JSON.stringify(mix)) }; };
  }

  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(hero);
  }

  video.parentNode.insertBefore(canvas, video.nextSibling);
  var start = performance.now(), last = start, shown = false;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.25, (now - last) / 1000); last = now;   // easing by time, not frames
    if (!visible || loaded < 1 || video.readyState < 2) return;
    var ks = 1 - Math.exp(-dt / 0.28), kw = 1 - Math.exp(-dt / 0.75);
    sun[0] += (target[0] - sun[0]) * ks;                              // the sun eases after the mouse
    sun[1] += (target[1] - sun[1]) * ks;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tVideo);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    gl.uniform2fv(u.uScale, scale); gl.uniform2fv(u.uOffset, offset); gl.uniform2fv(u.uSun, sun);
    gl.uniform1f(u.uAspect, VIDEO_ASPECT); gl.uniform1f(u.uTime, (now - start) / 1000);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    Object.keys(mix).forEach(function (w) {                           // blend towards the chosen weather
      mix[w] += ((w === weather ? 1 : 0) - mix[w]) * kw;        // ~2s to blend
      gl.uniform1f(u[UNIFORM[w]], mix[w]);
    });
    gl.uniform1f(u.uFlash, lightning(now));
    gl.uniform2fv(u.uBolt, bolt);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!shown && video.classList.contains('on')) { shown = true; canvas.classList.add('on'); }
  }
  requestAnimationFrame(frame);
})();
