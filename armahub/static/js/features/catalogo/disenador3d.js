// ArmaHub — Diseñador de figuras: VISOR 3D (5M.8.5, Etapa 1)
// Toggle 2D/3D en el diseñador. En 3D: visor Three.js con la barra como
// TubeGeometry (tubo de radio Ø siguiendo una polilínea 3D), rotable con el mouse.
// Three.js se carga ON-DEMAND (solo al activar 3D) → no pesa el resto.
//
// Etapa 1 (este archivo): visor funcionando + barra de PRUEBA rotable. La
// definición de la forma por tramos 3D (Etapa 2) y guardar/cargar (Etapa 3) vienen
// después. NO toca el 2D.

(function(global) {
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
  var _threeCargando = false, _threeListo = false;
  var _vista = '2D';
  var _scene = null, _camera = null, _renderer = null, _barra = null;
  var _rotX = -0.4, _rotY = 0.6;        // rotación actual (rad)
  var _dragging = false, _lastX = 0, _lastY = 0;
  var _rafId = null;

  // Cambia entre vista 2D (lienzo) y 3D (visor Three.js).
  global.disenadorSetVista = function(v) {
    _vista = (v === '3D') ? '3D' : '2D';
    var c2d = document.getElementById('disControles2D');
    var v3d = document.getElementById('disenador3D');
    var b2 = document.getElementById('disBtn2D'), b3 = document.getElementById('disBtn3D');
    // Estilo de los botones activos.
    if (b2 && b3) {
      var act = _vista === '2D';
      b2.style.background = act ? '#00695c' : '#fff'; b2.style.color = act ? '#fff' : '#00695c';
      b3.style.background = act ? '#fff' : '#00695c'; b3.style.color = act ? '#00695c' : '#fff';
    }
    if (c2d) c2d.style.display = (_vista === '2D') ? '' : 'none';
    if (v3d) v3d.style.display = (_vista === '3D') ? '' : 'none';
    if (_vista === '3D') _activar3D();
    else _detener3D();
  };

  // Carga Three.js (una vez) y arranca el visor.
  function _activar3D() {
    if (_threeListo) { _iniciarVisor(); return; }
    if (_threeCargando) return;
    _threeCargando = true;
    var cont = document.getElementById('disenador3D');
    if (cont) cont.innerHTML = '<div style="padding:20px; color:#888; font-size:12px;">Cargando visor 3D…</div>';
    var sc = document.createElement('script');
    sc.src = THREE_URL;
    sc.onload = function() { _threeListo = true; _threeCargando = false; _iniciarVisor(); };
    sc.onerror = function() {
      _threeCargando = false;
      if (cont) cont.innerHTML = '<div style="padding:20px; color:#c62828; font-size:12px;">No se pudo cargar el visor 3D (Three.js). Revisa la conexión.</div>';
    };
    document.head.appendChild(sc);
  }

  function _iniciarVisor() {
    if (!window.THREE) return;
    var cont = document.getElementById('disenador3D');
    if (!cont) return;
    cont.innerHTML = '';
    var W = cont.clientWidth || 420, H = cont.clientHeight || 320;

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0xf7f9fa);

    _camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
    _camera.position.set(0, 0, 380);

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setSize(W, H);
    _renderer.setPixelRatio(window.devicePixelRatio || 1);
    cont.appendChild(_renderer.domElement);

    // Luces.
    _scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    var dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(1, 1, 1);
    _scene.add(dir);

    // Barra de PRUEBA (Etapa 1): una U 3D con profundidad, como tubo de radio Ø.
    var puntos = [
      new THREE.Vector3(-120, -60, 0),
      new THREE.Vector3(-120,  60, 0),
      new THREE.Vector3( 120,  60, 40),   // el 40 en Z da la profundidad (3D)
      new THREE.Vector3( 120, -60, 40)
    ];
    _barra = _tuboDesdePuntos(puntos, 8);   // radio 8 = Ø16 de prueba
    _scene.add(_barra);

    _bindRotacion(cont);
    _animar();
  }

  // Construye un tubo (TubeGeometry) de radio dado siguiendo una polilínea 3D.
  function _tuboDesdePuntos(puntos, radio) {
    var curve = new THREE.CatmullRomCurve3(puntos, false, 'catmullrom', 0.0);
    // tension 0 + pocos puntos = tramos casi rectos con esquinas suaves.
    var geo = new THREE.TubeGeometry(curve, Math.max(16, puntos.length * 12), radio, 12, false);
    var mat = new THREE.MeshStandardMaterial({ color: 0x00695c, metalness: 0.3, roughness: 0.5 });
    var grupo = new THREE.Group();
    grupo.add(new THREE.Mesh(geo, mat));
    return grupo;
  }

  // Rotación con arrastre del mouse.
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
    if (_barra) { _barra.rotation.x = _rotX; _barra.rotation.y = _rotY; }
    _renderer.render(_scene, _camera);
    _rafId = requestAnimationFrame(_animar);
  }

  function _detener3D() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  global.disenador3dEstado = function() { return { vista: _vista, listo: _threeListo }; };
})(window);
