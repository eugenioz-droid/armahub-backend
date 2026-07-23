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

  function _bindRotacion(cont) {
    cont.onmousedown = function(e) { _dragging = true; _lastX = e.clientX; _lastY = e.clientY; };
    window.addEventListener('mousemove', _onMove);
    window.addEventListener('mouseup', function() { _dragging = false; });
  }
  function _onMove(e) {
    if (!_dragging) return;
    _rotY += (e.clientX - _lastX) * 0.01;
    _rotX += (e.clientY - _lastY) * 0.01;
    _lastX = e.clientX; _lastY = e.clientY;
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
