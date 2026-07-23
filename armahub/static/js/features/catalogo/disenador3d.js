// ArmaHub — Diseñador de figuras: EDITOR 3D (5M.8.5)
// Modo de dibujo 3D: misma lógica que el 2D (clicks → nodos → tramos) pero en el
// espacio, con modo ORTO (tipo CAD) para fijar direcciones ortogonales. La figura
// 3D se guarda (dim:"3D") y se muestra en catálogo/Bar Manager con aspecto 3D.
// Three.js se carga ON-DEMAND (solo al activar 3D) → no pesa el resto.
//
// ETAPA A (este commit): espacio 3D de trabajo — grilla + ejes XYZ + rotación con
// el mouse. Base para clickear nodos. Sin dibujo aún (viene en Etapa B).

(function(global) {
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
  var _threeCargando = false, _threeListo = false;
  var _vista = '2D';
  var _scene = null, _camera = null, _renderer = null;
  var _worldGroup = null;               // grupo que rota (grilla + ejes + figura)
  var _figuraGroup = null;              // la barra que se dibuja (Etapa B)
  var _rotX = -0.5, _rotY = 0.6;        // rotación de la vista (rad)
  var _dragging = false, _lastX = 0, _lastY = 0;
  var _rafId = null;

  // Nodos de la figura 3D (Vector3). Etapa B los llenará con clicks.
  var _nodos3d = [];

  global.disenadorSetVista = function(v) {
    _vista = (v === '3D') ? '3D' : '2D';
    var c2d = document.getElementById('disControles2D');
    var v3d = document.getElementById('disenador3D');
    var ctrl3d = document.getElementById('disControles3D');
    var b2 = document.getElementById('disBtn2D'), b3 = document.getElementById('disBtn3D');
    if (b2 && b3) {
      var act = _vista === '2D';
      b2.style.background = act ? '#00695c' : '#fff'; b2.style.color = act ? '#fff' : '#00695c';
      b3.style.background = act ? '#fff' : '#00695c'; b3.style.color = act ? '#00695c' : '#fff';
    }
    if (c2d) c2d.style.display = (_vista === '2D') ? '' : 'none';
    if (v3d) v3d.style.display = (_vista === '3D') ? '' : 'none';
    if (ctrl3d) ctrl3d.style.display = (_vista === '3D') ? '' : 'none';
    // Panel de parámetros 3D visible solo en 3D; el 2D usa disenadorPanel.
    var p3d = document.getElementById('dis3dPanelWrap');
    if (p3d) p3d.style.display = (_vista === '3D') ? '' : 'none';
    if (_vista === '3D') _activar3D(); else _detener3D();
    // Refrescar el preview según la vista.
    if (_vista === '3D') _actualizarPreview3d();
    else if (typeof disenadorActualizarPreview2d === 'function') disenadorActualizarPreview2d();
  };

  function _activar3D() {
    if (_threeListo) { _iniciarEspacio(); return; }
    if (_threeCargando) return;
    _threeCargando = true;
    var cont = document.getElementById('disenador3D');
    if (cont) cont.innerHTML = '<div style="padding:20px; color:#888; font-size:12px;">Cargando espacio 3D…</div>';
    var sc = document.createElement('script');
    sc.src = THREE_URL;
    sc.onload = function() { _threeListo = true; _threeCargando = false; _iniciarEspacio(); };
    sc.onerror = function() {
      _threeCargando = false;
      if (cont) cont.innerHTML = '<div style="padding:20px; color:#c62828; font-size:12px;">No se pudo cargar el espacio 3D (Three.js). Revisa la conexión.</div>';
    };
    document.head.appendChild(sc);
  }

  function _iniciarEspacio() {
    if (!window.THREE) return;
    var cont = document.getElementById('disenador3D');
    if (!cont) return;
    cont.innerHTML = '';
    var W = cont.clientWidth || 420, H = cont.clientHeight || 320;

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0xf7f9fa);

    _camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 4000);
    _camera.position.set(0, 0, 520);

    _renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    _renderer.setSize(W, H);
    _renderer.setPixelRatio(window.devicePixelRatio || 1);
    cont.appendChild(_renderer.domElement);

    _scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    var dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 1, 1); _scene.add(dir);

    // Grupo que rota con el mouse (contiene grilla, ejes y la figura).
    _worldGroup = new THREE.Group();
    _scene.add(_worldGroup);

    _agregarGrilla();
    _agregarEjes();

    _figuraGroup = new THREE.Group();
    _worldGroup.add(_figuraGroup);
    _redibujarFigura3d();
    _bindRotacion(cont);
    _animar();
    global.disenador3dSetPlano(_planoActivo);   // plano inicial + resaltado del botón
  }

  // Grilla de referencia en el plano base (XZ) para ubicarse en el espacio.
  function _agregarGrilla() {
    var grid = new THREE.GridHelper(400, 10, 0xcccccc, 0xe6e6e6);
    // GridHelper está en el plano XZ (horizontal) por defecto — bien como piso.
    _worldGroup.add(grid);
  }

  // Ejes XYZ con colores (X rojo, Y verde, Z azul) + su LETRA al final.
  function _agregarEjes() {
    var L = 220;
    _worldGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(L,0,0), 0xd32f2f)); // X rojo
    _worldGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(0,L,0), 0x388e3c)); // Y verde
    _worldGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,L), 0x1976d2)); // Z azul
    _worldGroup.add(_etiquetaEje('X', L + 18, 0, 0, '#d32f2f'));
    _worldGroup.add(_etiquetaEje('Y', 0, L + 18, 0, '#388e3c'));
    _worldGroup.add(_etiquetaEje('Z', 0, 0, L + 18, '#1976d2'));
  }
  function _lineaEje(a, b, color) {
    var g = new THREE.BufferGeometry().setFromPoints([a, b]);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: color }));
  }
  // Etiqueta de texto (sprite con canvas) — liviano, sin cargar fuentes externas.
  function _etiquetaEje(texto, x, y, z, color) {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = color; ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(texto, 32, 34);
    var tex = new THREE.CanvasTexture(cv);
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    spr.position.set(x, y, z); spr.scale.set(28, 28, 1);
    return spr;
  }

  // Dibuja la figura 3D (nodos → tubo). En la Etapa A está vacía; la Etapa B la
  // llena con los clicks. Se deja lista la mecánica de render.
  function _redibujarFigura3d() {
    if (!_figuraGroup) return;
    while (_figuraGroup.children.length) _figuraGroup.remove(_figuraGroup.children[0]);
    if (_nodos3d.length >= 2) {
      var curve = new THREE.CatmullRomCurve3(_nodos3d, false, 'catmullrom', 0.0);
      var geo = new THREE.TubeGeometry(curve, Math.max(16, _nodos3d.length * 12), 8, 12, false);
      var mat = new THREE.MeshStandardMaterial({ color: 0x00695c, metalness: 0.3, roughness: 0.5 });
      _figuraGroup.add(new THREE.Mesh(geo, mat));
    }
    // Nodos como esferitas.
    _nodos3d.forEach(function(p) {
      var s = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 12), new THREE.MeshStandardMaterial({ color: 0x004d40 }));
      s.position.copy(p); _figuraGroup.add(s);
    });
  }
  global.disenador3dRedibujar = _redibujarFigura3d;
  global.disenador3dNodos = function() { return _nodos3d; };

  // ---- Etapa B: DIBUJO por CLICKS sobre un PLANO de trabajo ----
  // Un click 3D es un rayo (ambiguo en profundidad). Solución: el nodo cae en el
  // PLANO de trabajo activo (con snap a grilla). Para dibujar en otra dirección,
  // el usuario cambia el plano (XZ piso / XY frontal / YZ lateral). Clicks + nodos
  // como el 2D; lo único extra es elegir el plano.
  var _GRID3D = 40;              // paso de grilla del espacio
  var _planoActivo = 'XZ';      // 'XZ' (piso) | 'XY' (frontal) | 'YZ' (lateral)
  var _planoOffset = 0;         // desplazamiento del plano en su eje normal
  var _raycaster = null, _mouseNDC = null;
  var _orto = true;             // ORTO: fuerza tramos a 90° en el plano (default ON)

  global.disenador3dToggleOrto = function() {
    _orto = !_orto;
    var b = document.getElementById('dis3dBtnOrto');
    if (b) {
      b.textContent = _orto ? '📐 ORTO: ON' : '📐 ORTO: OFF';
      b.style.background = _orto ? '#00695c' : '#fff';
      b.style.color = _orto ? '#fff' : '#00695c';
    }
  };

  // Cambia el plano de trabajo. El nodo nuevo caerá en este plano.
  global.disenador3dSetPlano = function(p) {
    _planoActivo = (p === 'XY' || p === 'YZ') ? p : 'XZ';
    // El offset del plano = la coordenada normal del último nodo (para "continuar"
    // dibujando desde donde quedó, no volver al origen del plano).
    if (_nodos3d.length) {
      var l = _nodos3d[_nodos3d.length - 1];
      _planoOffset = (_planoActivo === 'XZ') ? l.y : (_planoActivo === 'XY') ? l.z : l.x;
    } else _planoOffset = 0;
    _actualizarPlanoVisual();
    _actualizarInfo3d();
    // Resaltar el botón del plano activo.
    ['XZ', 'XY', 'YZ'].forEach(function(pl) {
      var b = document.getElementById('dis3dPl' + pl);
      if (b) { var on = (pl === _planoActivo);
        b.style.background = on ? '#00695c' : '#fff'; b.style.color = on ? '#fff' : '#333';
        b.style.border = on ? 'none' : '1px solid #ccc'; }
    });
  };

  // Intersección del rayo del click con el plano de trabajo → punto 3D snapeado.
  function _puntoEnPlano(ev) {
    if (!window.THREE || !_renderer) return null;
    var rect = _renderer.domElement.getBoundingClientRect();
    if (!_raycaster) { _raycaster = new THREE.Raycaster(); _mouseNDC = new THREE.Vector2(); }
    _mouseNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    _mouseNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouseNDC, _camera);
    // Plano en coords del MUNDO (sin la rotación del worldGroup): construir el
    // plano y transformar el rayo al espacio local del worldGroup.
    var normal, constante;
    if (_planoActivo === 'XZ') { normal = new THREE.Vector3(0, 1, 0); constante = -_planoOffset; }
    else if (_planoActivo === 'XY') { normal = new THREE.Vector3(0, 0, 1); constante = -_planoOffset; }
    else { normal = new THREE.Vector3(1, 0, 0); constante = -_planoOffset; }
    // Transformar el rayo al espacio local del worldGroup (que está rotado).
    var inv = new THREE.Matrix4().copy(_worldGroup.matrixWorld).invert();
    var origin = _raycaster.ray.origin.clone().applyMatrix4(inv);
    var dir = _raycaster.ray.direction.clone().transformDirection(inv).normalize();
    var plane = new THREE.Plane(normal, constante);
    var ray = new THREE.Ray(origin, dir);
    var hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) return null;
    // Snap a la grilla.
    hit.x = Math.round(hit.x / _GRID3D) * _GRID3D;
    hit.y = Math.round(hit.y / _GRID3D) * _GRID3D;
    hit.z = Math.round(hit.z / _GRID3D) * _GRID3D;
    // ORTO: forzar el tramo a 90° dentro del plano (solo se mueve en UN eje del
    // plano respecto al último nodo — el de mayor cambio). Evita las diagonales.
    if (_orto && _nodos3d.length) {
      var last = _nodos3d[_nodos3d.length - 1];
      // Ejes libres del plano activo (el eje normal queda fijo por el plano).
      var ejes = (_planoActivo === 'XZ') ? ['x', 'z'] : (_planoActivo === 'XY') ? ['x', 'y'] : ['y', 'z'];
      var d0 = Math.abs(hit[ejes[0]] - last[ejes[0]]);
      var d1 = Math.abs(hit[ejes[1]] - last[ejes[1]]);
      // Mantener solo el eje con mayor desplazamiento; el otro se iguala al último.
      if (d0 >= d1) hit[ejes[1]] = last[ejes[1]];
      else hit[ejes[0]] = last[ejes[0]];
    }
    return hit;
  }

  global.disenador3dDeshacer = function() {
    if (_nodos3d.length > 0) _nodos3d.pop();
    _redibujarFigura3d(); _actualizarInfo3d();
  };
  global.disenador3dLimpiarDibujo = function() {
    _nodos3d = []; _redibujarFigura3d(); _actualizarInfo3d();
  };

  // Preview 3D: snapshot del canvas del visor (así el preview = lo que se verá,
  // un mini-render 3D). Requiere preserveDrawingBuffer en el renderer.
  function _actualizarPreview3d() {
    var prev = document.getElementById('disPreview');
    if (!prev) return;
    if (_nodos3d.length < 2 || !_renderer) {
      prev.innerHTML = '<span class="muted" style="font-size:11px;">Dibuja para ver el preview.</span>';
      return;
    }
    try {
      // Forzar un render antes del snapshot.
      _renderer.render(_scene, _camera);
      var url = _renderer.domElement.toDataURL('image/png');
      prev.innerHTML = '<img src="' + url + '" style="max-width:100%; max-height:120px; border-radius:4px;" alt="preview 3D"/>';
    } catch (e) {
      prev.innerHTML = '<span class="muted" style="font-size:11px;">Preview 3D no disponible.</span>';
    }
  }

  var _LETRAS3D = 'ABCDEFGHI'.split('');
  // Panel de parámetros 3D: por cada tramo (nodo i-1 → i), su lado, largo (grillas)
  // y dirección (eje dominante ±). Paridad con el panel del 2D.
  function _actualizarPanel3d() {
    var cont = document.getElementById('dis3dPanel');
    if (!cont) return;
    if (_nodos3d.length < 2) {
      cont.innerHTML = '<div class="muted" style="font-size:12px;">Haz click en el visor para trazar el primer lado.</div>';
      return;
    }
    var html = '<div style="font-weight:700; color:#00695c; margin-bottom:6px;">Parámetros de la figura 3D</div>';
    html += '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
    html += '<tr style="color:#666; text-align:left;"><th style="padding:2px 4px;">Lado</th><th style="padding:2px 4px;">Largo</th><th style="padding:2px 4px;">Dirección</th></tr>';
    for (var i = 1; i < _nodos3d.length; i++) {
      var a = _nodos3d[i - 1], b = _nodos3d[i];
      var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      var largo = Math.round(Math.sqrt(dx*dx + dy*dy + dz*dz) / _GRID3D);
      // Eje dominante para nombrar la dirección.
      var adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
      var dir;
      if (adx >= ady && adx >= adz) dir = (dx >= 0 ? '+X' : '−X');
      else if (ady >= adz) dir = (dy >= 0 ? '+Y' : '−Y');
      else dir = (dz >= 0 ? '+Z' : '−Z');
      var lado = _LETRAS3D[i - 1] || ('L' + i);
      html += '<tr style="border-top:1px solid #eee;">' +
        '<td style="padding:2px 4px; font-weight:700; color:#00695c;">' + lado + '</td>' +
        '<td style="padding:2px 4px;">' + largo + '</td>' +
        '<td style="padding:2px 4px;">' + dir + '</td></tr>';
    }
    html += '</table>';
    html += '<div style="margin-top:6px; font-size:12px; color:#444;"><b>N° de lados:</b> ' + (_nodos3d.length - 1) + '</div>';
    cont.innerHTML = html;
  }

  // Info del dibujo (nº de tramos) en el panel.
  function _actualizarInfo3d() {
    _actualizarPanel3d();
    // Preview con un pequeño delay para que el render del frame esté listo.
    setTimeout(_actualizarPreview3d, 60);
    var el = document.getElementById('dis3dInfo');
    if (el) {
      var n = Math.max(0, _nodos3d.length - 1);
      el.textContent = n + ' tramo' + (n === 1 ? '' : 's') + ' · ' + _nodos3d.length + ' nodos';
    }
  }

  var _downX = 0, _downY = 0, _moved = 0;
  function _bindRotacion(cont) {
    cont.onmousedown = function(e) {
      _dragging = true; _lastX = e.clientX; _lastY = e.clientY;
      _downX = e.clientX; _downY = e.clientY; _moved = 0;
    };
    window.addEventListener('mousemove', _onMove);
    window.addEventListener('mouseup', _onUp);
  }
  function _onMove(e) {
    if (!_dragging) return;
    _rotY += (e.clientX - _lastX) * 0.01;
    _rotX += (e.clientY - _lastY) * 0.01;
    _moved += Math.abs(e.clientX - _lastX) + Math.abs(e.clientY - _lastY);
    _lastX = e.clientX; _lastY = e.clientY;
  }
  function _onUp(e) {
    if (!_dragging) return;
    _dragging = false;
    // Si casi no se movió → fue un CLICK: colocar un nodo en el plano de trabajo.
    if (_moved < 5 && _vista === '3D') {
      // Verificar que el mouseup cayó dentro del canvas 3D.
      var cont = document.getElementById('disenador3D');
      if (cont) {
        var r = cont.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          var p = _puntoEnPlano(e);
          if (p) { _nodos3d.push(p); _redibujarFigura3d(); _actualizarInfo3d(); }
        }
      }
    }
  }

  // Malla visual del plano de trabajo activo (para que el usuario vea dónde caerá
  // el click). Se actualiza al cambiar de plano.
  var _planoMesh = null, _planoBorde = null;
  function _actualizarPlanoVisual() {
    if (!window.THREE || !_worldGroup) return;
    if (_planoMesh) { _worldGroup.remove(_planoMesh); _planoMesh = null; }
    if (_planoBorde) { _worldGroup.remove(_planoBorde); _planoBorde = null; }
    var S = 400;
    var geo = new THREE.PlaneGeometry(S, S);
    // Relleno celeste más visible + borde marcado (para que se distinga el plano).
    var mat = new THREE.MeshBasicMaterial({ color: 0x26a69a, transparent: true, opacity: 0.20, side: THREE.DoubleSide });
    _planoMesh = new THREE.Mesh(geo, mat);
    var edges = new THREE.EdgesGeometry(geo);
    _planoBorde = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00897b, linewidth: 2 }));
    // Orientar según el plano activo.
    function orientar(obj) {
      if (_planoActivo === 'XZ') { obj.rotation.x = -Math.PI / 2; obj.position.y = _planoOffset; }
      else if (_planoActivo === 'XY') { obj.rotation.set(0,0,0); obj.position.set(0,0,_planoOffset); }
      else { obj.rotation.y = Math.PI / 2; obj.position.set(_planoOffset,0,0); }
    }
    orientar(_planoMesh); orientar(_planoBorde);
    _worldGroup.add(_planoMesh); _worldGroup.add(_planoBorde);
    // Etiqueta HTML fija en el visor con el plano activo.
    _actualizarBadgePlano();
  }

  // Badge fijo (HTML) sobre el visor, indicando el plano de trabajo activo.
  function _actualizarBadgePlano() {
    var cont = document.getElementById('disenador3D');
    if (!cont) return;
    var badge = document.getElementById('dis3dBadgePlano');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'dis3dBadgePlano';
      badge.style.cssText = 'position:absolute; top:6px; left:8px; background:rgba(0,137,123,0.9); color:#fff; font-size:11px; font-weight:700; padding:3px 8px; border-radius:4px; pointer-events:none; z-index:2;';
      // El contenedor del visor debe ser relative para posicionar el badge.
      cont.style.position = 'relative';
      cont.appendChild(badge);
    }
    var nombres = { XZ: 'Plano PISO (X-Z)', XY: 'Plano FRONTAL (X-Y)', YZ: 'Plano LATERAL (Y-Z)' };
    badge.textContent = '✏️ ' + (nombres[_planoActivo] || _planoActivo);
  }

  function _animar() {
    if (_vista !== '3D' || !_renderer) return;
    if (_worldGroup) { _worldGroup.rotation.x = _rotX; _worldGroup.rotation.y = _rotY; }
    _renderer.render(_scene, _camera);
    _rafId = requestAnimationFrame(_animar);
  }
  function _detener3D() { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } }

  global.disenador3dEstado = function() { return { vista: _vista, listo: _threeListo, nodos: _nodos3d.length }; };
})(window);
