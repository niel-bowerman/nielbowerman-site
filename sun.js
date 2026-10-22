// Homepage hero: a sun behind the clouds that follows the mouse while it's over the sky, and
// relights the landscape to match. Drawn with WebGL over the hero video, using two maps made from
// the still landscape: images/hero-normals.jpg (which way the terrain faces) and images/hero-masks.png
// (R = sky, G = lochs, B = distance). Without WebGL, or with reduced motion, the plain video stays.
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
  var DEFAULT_SUN = [0.30, 0.21];         // where the sun sits until the mouse moves over the sky (clear of the header)

  var vs = 'attribute vec2 p; varying vec2 vUv;' +
    'void main(){ vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }';

  var fs = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uVideo, uNormals, uMasks;',
    'uniform vec2 uScale, uOffset, uSun;',
    'uniform float uAspect, uTime;',
    'float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'void main(){',
    '  vec2 uv = vUv * uScale + uOffset;',
    '  vec3 col = texture2D(uVideo, uv).rgb;',
    '  vec3 n = normalize(texture2D(uNormals, uv).rgb * 2.0 - 1.0);',
    '  vec3 m = texture2D(uMasks, uv).rgb;',
    '  float sky = m.r, water = m.g, dist = m.b;',
    '  vec3 sunCol = vec3(1.0, 0.92, 0.78);',
    '  vec2 d = (uv - uSun) * vec2(uAspect, 1.0);          // offset from the sun, in frame heights',
    '  float r = length(d);',
    // how much the cloud right in front of the sun lets through (brighter cloud = thinner)
    '  float lumSun = luma(texture2D(uVideo, uSun).rgb);',
    '  float vis = mix(0.62, 1.0, smoothstep(0.55, 0.92, lumSun));',
    // --- the sky: a sun glowing through the clouds
    '  float lum = luma(col);',
    '  float trans = mix(0.38, 1.0, smoothstep(0.50, 0.93, lum));',
    '  float core = exp(-pow(r / 0.020, 2.0));',
    '  float halo = exp(-r / 0.075);',
    '  float wide = exp(-r / 0.34);',
    '  vec2 toward = -normalize(d + 1e-5) * 0.007 / vec2(uAspect, 1.0);',
    '  float lining = clamp((luma(texture2D(uVideo, uv + toward).rgb) - lum) * 16.0, 0.0, 1.0) * halo;',
    '  float glow = (core * 1.25 * trans + halo * 0.40 * pow(trans, 0.7) + wide * 0.10 + lining * 0.30) * vis;',
    '  vec3 L = normalize(vec3(-d * 0.9, 0.55));',
    '  float shade = 1.0 + 0.75 * dot(n.xy, L.xy) * vis;     // brighter facing the sun, darker away; no net change',
    '  float land = 1.0 - sky;',
    '  vec3 lit = col * mix(1.0, shade, land);',
    // warm light falling on the distant land nearest the sun, and a glint on the lochs below it
    '  lit += sunCol * exp(-r / 0.40) * (0.05 + 0.10 * dist) * land * vis;',
    '  float under = exp(-pow((uv.x - uSun.x) * uAspect / 0.10, 2.0));',
    '  float ripple = 0.75 + 0.25 * sin(uTime * 2.3 + uv.x * 140.0 + uv.y * 60.0);',
    '  lit += sunCol * water * under * ripple * 0.30 * vis;',
    // the glow sits behind/in the sky, with a whisper of lens bloom over everything
    '  lit = 1.0 - (1.0 - lit) * (1.0 - sunCol * glow * smoothstep(0.45, 1.0, sky));   // (soft rim on ridges, not a hard line)',
    '  lit += sunCol * wide * 0.035 * vis;',
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
  } catch (e) { return; }                 // fall back to the plain video
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
  var tVideo = texture(0, 'uVideo'), tNormals = texture(1, 'uNormals'), tMasks = texture(2, 'uMasks');
  var u = {};
  ['uScale', 'uOffset', 'uSun', 'uAspect', 'uTime'].forEach(function (k) { u[k] = gl.getUniformLocation(prog, k); });

  // the sky mask, kept small on the side, to know whether the mouse is over the sky
  var skyData = null, SKY_W = 160, SKY_H = 90;
  var loaded = 0;
  function load(src, tex, keepSky) {
    var img = new Image();
    img.onload = function () {
      gl.activeTexture(gl.TEXTURE0 + (tex === tNormals ? 1 : 2));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      if (keepSky) {
        var c = document.createElement('canvas'); c.width = SKY_W; c.height = SKY_H;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0, SKY_W, SKY_H);
        skyData = x.getImageData(0, 0, SKY_W, SKY_H).data;
      }
      loaded++;
    };
    img.src = src;
  }
  load('images/hero-normals.jpg', tNormals, false);
  load('images/hero-masks.png', tMasks, true);

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

  var sun = DEFAULT_SUN.slice(), target = DEFAULT_SUN.slice();
  hero.addEventListener('pointermove', function (e) {
    if (!skyData) return;
    var r = hero.getBoundingClientRect();
    var vx = ((e.clientX - r.left) / r.width) * scale[0] + offset[0];
    var vy = ((e.clientY - r.top) / r.height) * scale[1] + offset[1];
    var sx = Math.max(0, Math.min(SKY_W - 1, Math.floor(vx * SKY_W)));
    var sy = Math.max(0, Math.min(SKY_H - 1, Math.floor(vy * SKY_H)));
    if (skyData[(sy * SKY_W + sx) * 4] > 140) target = [vx, vy];   // only while over the sky
  });

  if (debug) window.setSun = function (x, y) { sun = [x, y]; target = [x, y]; };

  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(hero);
  }

  video.parentNode.insertBefore(canvas, video.nextSibling);
  var start = performance.now(), shown = false;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || loaded < 2 || video.readyState < 2) return;
    sun[0] += (target[0] - sun[0]) * 0.06;                            // the sun eases after the mouse
    sun[1] += (target[1] - sun[1]) * 0.06;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tVideo);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    gl.uniform2fv(u.uScale, scale); gl.uniform2fv(u.uOffset, offset); gl.uniform2fv(u.uSun, sun);
    gl.uniform1f(u.uAspect, VIDEO_ASPECT); gl.uniform1f(u.uTime, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!shown && video.classList.contains('on')) { shown = true; canvas.classList.add('on'); }
  }
  requestAnimationFrame(frame);
})();
