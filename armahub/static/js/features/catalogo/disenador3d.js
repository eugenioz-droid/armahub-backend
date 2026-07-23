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
    if (_vista === '3D') _activar3D(); else _detener3D();
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

    _renderer = new THREE.WebGLRenderer({ antialias: true });
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

  // Ejes XYZ con colores (X rojo, Y verde, Z azul) para orientar el dibujo.
  function _agregarEjes() {
    var L = 220;
    _worldGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(L,0,0), 0xd32f2f)); // X rojo
    _worldGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(0,L,0), 0x388e3c)); // Y verde
    _worldGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,L), 0x1976d2)); // Z azul
  }
  function _lineaEje(a, b, color) {
    var g = new THREE.BufferGeometry().setFromPoints([a, b]);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: color }));
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
    return hit;
  }

  global.disenador3dDeshacer = function() {
    if (_nodos3d.length > 0) _nodos3d.pop();
    _redibujarFigura3d(); _actualizarInfo3d();
  };
  global.disenador3dLimpiarDibujo = function() {
    _nodos3d = []; _redibujarFigura3d(); _actualizarInfo3d();
  };

  // Info del dibujo (nº de tramos) en el panel.
  function _actualizarInfo3d() {
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
  var _planoMesh = null;
  function _actualizarPlanoVisual() {
    if (!window.THREE || !_worldGroup) return;
    if (_planoMesh) { _worldGroup.remove(_planoMesh); _planoMesh = null; }
    var geo = new THREE.PlaneGeometry(400, 400);
    var mat = new THREE.MeshBasicMaterial({ color: 0x4db6ac, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
    _planoMesh = new THREE.Mesh(geo, mat);
    if (_planoActivo === 'XZ') { _planoMesh.rotation.x = -Math.PI / 2; _planoMesh.position.y = _planoOffset; }
    else if (_planoActivo === 'XY') { _planoMesh.position.z = _planoOffset; }
    else { _planoMesh.rotation.y = Math.PI / 2; _planoMesh.position.x = _planoOffset; }
    _worldGroup.add(_planoMesh);
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
