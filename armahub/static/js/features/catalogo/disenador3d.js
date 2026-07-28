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
  var _rotX = 0, _rotY = 0, _rotZ = 0;  // rotación extra de la vista (la cámara ya da
                                        // el ángulo isométrico natural con Z arriba).
                                        // _rotZ = giro sobre el eje Y del mundo (botón Y).
  var _dragging = false, _lastX = 0, _lastY = 0;
  var _rafId = null;

  // Nodos de la figura 3D (Vector3). Etapa B los llenará con clicks.
  var _nodos3d = [];

  // Ángulo de la proyección isométrica (grados). Configurable por figura (30/35/40):
  // se guarda en geometria.iso_angulo y define cómo se ve la figura 3D en TODA la
  // plataforma. Default 30 (estándar de dibujo técnico).
  var _isoAngulo = 30;

  // Proyección ISOMÉTRICA de un punto 3D → punto 2D (para la vista 2D vectorial).
  // Convención del editor: Z es la ALTURA (vertical), X e Y horizontales. Debe verse
  // IGUAL que el visor 3D. Se usa la proyección BASE (que preserva la dirección de los
  // segmentos — NO se tocan los ejes 3D de entrada, así las patas no se invierten) y
  // luego se ROTA la IMAGEN 2D final 180° (negar x e y de salida). Rotar la imagen ≠
  // espejar ejes: mantiene las direcciones de recorrido, solo gira la vista completa.
  // FIX DE RAÍZ (2026): en vez de una fórmula iso inventada (que nunca calzaba con el
  // visor porque proyectaba con otra orientación), se proyecta con los MISMOS vectores
  // de la cámara real del canvas Three.js (posición 3D del azimut, mirando al origen,
  // up=Z). right/camUp se derivan de esa cámara → el preview queda IGUAL que el canvas
  // por construcción, no por prueba-y-error. Ortográfico (iso), sin perspectiva, sin
  // depender de Three.js en runtime (los vectores son constantes por el ángulo).
  // El ángulo iso (30/40/50) controla la ELEVACIÓN de la cámara virtual sobre el plano.
  var _isoBasisCache = null, _isoBasisAng = null;
  function _isoBasis() {
    if (_isoBasisCache && _isoBasisAng === _isoAngulo) return _isoBasisCache;
    // Cámara: azimut fijo a 45° (esquina) mirando al origen; elevación = _isoAngulo.
    var el = _isoAngulo * Math.PI / 180;   // elevación sobre el plano horizontal
    var az = 45 * Math.PI / 180;           // azimut (desde qué esquina se mira)
    // Posición de la cámara (dir desde el origen hacia el ojo), con Z arriba.
    var ex = Math.cos(el) * Math.cos(az);
    var ey = -Math.cos(el) * Math.sin(az);
    var ez = Math.sin(el);
    // forward = -eye (mira al origen); up = Z.
    var fx = -ex, fy = -ey, fz = -ez;
    // right = forward × up (up = (0,0,1)).
    var rx = fy * 1 - fz * 0, ry = fz * 0 - fx * 1, rz = fx * 0 - fy * 0;
    var rn = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1; rx/=rn; ry/=rn; rz/=rn;
    // camUp = right × forward.
    var ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    var un = Math.sqrt(ux*ux + uy*uy + uz*uz) || 1; ux/=un; uy/=un; uz/=un;
    _isoBasisCache = { rx: rx, ry: ry, rz: rz, ux: ux, uy: uy, uz: uz };
    _isoBasisAng = _isoAngulo;
    return _isoBasisCache;
  }
  // Base de proyección FIJADA (capturada de la cámara real con "Fijar vista"). Si es
  // null, se usa la base paramétrica del ángulo iso (_isoBasis). Al fijar vista, el
  // preview hereda la orientación EXACTA del canvas (con su profundidad), en vez de un
  // iso plano. Se guarda con la figura (geometria.vista_base) para persistir.
  var _isoBaseFijada = null;
  function _iso(p) {
    var b = _isoBaseFijada || _isoBasis();
    // Proyección ortográfica: x = p·right, y = p·camUp. NO invertir la y: el motor
    // (svgDesdePuntos/tx) ya la invierte al dibujar; con camUp·Z positivo, esa única
    // inversión deja la altura Z hacia arriba (verificado numéricamente).
    return { x: p.x*b.rx + p.y*b.ry + p.z*b.rz,
             y: p.x*b.ux + p.y*b.uy + p.z*b.uz };
  }
  // Captura la base de proyección de la CÁMARA real en el sistema local del worldGroup
  // (así _iso, que proyecta coords locales de los nodos, reproduce la vista del canvas).
  function _capturarBaseVista() {
    if (!_camera || !_worldGroup || !window.THREE) return null;
    _worldGroup.updateMatrixWorld();
    // right/up de la cámara en MUNDO.
    var right = new THREE.Vector3().setFromMatrixColumn(_camera.matrixWorld, 0).normalize();
    var up = new THREE.Vector3().setFromMatrixColumn(_camera.matrixWorld, 1).normalize();
    // Llevarlos al sistema LOCAL del worldGroup (solo rotación → usar la parte 3x3).
    var invRot = new THREE.Matrix3().setFromMatrix4(_worldGroup.matrixWorld).invert();
    right.applyMatrix3(invRot).normalize();
    up.applyMatrix3(invRot).normalize();
    return { rx: right.x, ry: right.y, rz: right.z, ux: up.x, uy: up.y, uz: up.z };
  }
  global.disenador3dSetIsoAngulo = function(deg) {
    var d = Number(deg); if (isNaN(d)) return;
    _isoAngulo = d;
    _isoBaseFijada = null;   // elegir un ángulo iso vuelve al modo paramétrico (descarta vista fijada)
    _actualizarPreview3d();   // refrescar el preview con el nuevo ángulo
  };
  global.disenador3dGetIsoAngulo = function() { return _isoAngulo; };
  // Botones 30/35/40 del selector de ángulo de vista: setea + resalta el activo +
  // refresca el preview en vivo (para que el usuario vea cómo queda antes de guardar).
  global.disenador3dSetVistaAngulo = function(deg) {
    disenador3dSetIsoAngulo(deg);
    [30, 40, 50].forEach(function(a) {
      var b = document.getElementById('dis3dIso' + a);
      if (!b) return;
      var on = (a === deg);
      b.style.background = on ? '#00695c' : '#fff';
      b.style.color = on ? '#fff' : '#00695c';
      b.style.border = on ? 'none' : '1px solid #ccc';
    });
  };

  // Nodos 3D → puntos 2D isométricos (para el SVG de etiquetado / preview 2D).
  global.disenador3dNodos2D = function() {
    return _nodos3d.map(function(p) { return _iso(p); });
  };
  global.disenador3dTieneFigura = function() { return _nodos3d.length >= 2; };

  global.disenadorSetVista = function(v) {
    var destino = (v === '3D') ? '3D' : '2D';
    if (destino === _vista) return;   // ya estamos ahí
    // Cambiar de vista DESCARTA la figura del otro modo (2D y 3D no se mezclan).
    // Avisar solo si hay una figura que se perdería.
    var hay2d = (typeof disenador2dTieneFigura === 'function') && disenador2dTieneFigura();
    var hay3d = _nodos3d.length >= 2;
    var perdemos = (destino === '3D') ? hay2d : hay3d;
    if (perdemos && !confirm('Cambiar a vista ' + destino + ' descartará la figura actual y empezarás de cero. ¿Continuar?')) {
      return;   // el usuario canceló → no cambiamos de vista
    }
    // Limpiar el lado que se abandona.
    if (destino === '3D') { if (typeof disenador2dLimpiarSilencioso === 'function') disenador2dLimpiarSilencioso(); }
    else { disenador3dLimpiarDibujo(); }
    _vista = destino;
    var c2d = document.getElementById('disControles2D');
    var v3d = document.getElementById('disenador3DWrap');   // wrapper (visor + botones eje)
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
    var trazo3d = document.getElementById('disTrazo3DRow');   // trazo 3D arriba del canvas
    if (trazo3d) trazo3d.style.display = (_vista === '3D') ? 'flex' : 'none';
    // Resaltar el botón del plano activo al entrar a 3D (por defecto XY).
    if (_vista === '3D') { ['XZ','XY','YZ'].forEach(function(pl){ var b=document.getElementById('dis3dPl'+pl); if(b){var on=(pl===_planoActivo); b.style.background=on?'#00695c':'rgba(255,255,255,0.9)'; b.style.color=on?'#fff':'#00695c'; b.style.border='1px solid #00695c';} }); }
    // UN SOLO panel visible: en 3D-dibujando el panel 3D (largo/dirección de tramos);
    // en 2D el panel unificado (disenadorPanel). El etiquetado 3D muestra el 2D.
    var p3d = document.getElementById('dis3dPanelWrap');
    var p2d = document.getElementById('disenadorPanelWrap');
    if (p3d) p3d.style.display = (_vista === '3D') ? '' : 'none';
    if (p2d) p2d.style.display = (_vista === '3D') ? 'none' : '';
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
    // Convención de ingeniería: Z es la ALTURA (vertical). Orientamos la cámara con
    // el "arriba" en Z y la ubicamos en una vista isométrica natural (mirando desde
    // adelante-derecha-arriba hacia el origen), no de frente al plano.
    _camera.up.set(0, 0, 1);
    _camera.position.set(360, -360, 300);
    _camera.lookAt(0, 0, 0);

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
    // Si se cargó una figura ANTES de que Three.js estuviera listo (re-editar),
    // ahora que el espacio existe: redibujarla y refrescar el preview con su
    // snapshot + etiquetas.
    if (_nodos3d.length >= 2) {
      _redibujarFigura3d();
      _actualizarInfo3d();
      setTimeout(_actualizarPreview3d, 80);
    }
  }

  // Grilla de referencia = PISO horizontal en el plano XY (Z es la altura). El
  // GridHelper nace en XZ (Y vertical), así que lo rotamos 90° sobre X para llevarlo
  // al plano XY con Z como normal vertical (convención de ingeniería).
  var _gridMesh = null;
  function _agregarGrilla() {
    var grid = new THREE.GridHelper(400, 10, 0xcccccc, 0xe6e6e6);
    grid.rotation.x = Math.PI / 2;
    _gridMesh = grid;
    _worldGroup.add(grid);
  }

  // Ejes XYZ con colores (X rojo, Y verde, Z azul) + su LETRA al final. Van en un
  // grupo propio (_ejesGroup) para poder ocultarlos al capturar el snapshot (los
  // ejes son ayuda de dibujo, no parte de la barra guardada).
  var _ejesGroup = null;
  function _agregarEjes() {
    var L = 220;
    _ejesGroup = new THREE.Group();
    _ejesGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(L,0,0), 0xd32f2f)); // X rojo
    _ejesGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(0,L,0), 0x388e3c)); // Y verde
    _ejesGroup.add(_lineaEje(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,L), 0x1976d2)); // Z azul
    _ejesGroup.add(_etiquetaEje('X', L + 18, 0, 0, '#d32f2f'));
    _ejesGroup.add(_etiquetaEje('Y', 0, L + 18, 0, '#388e3c'));
    _ejesGroup.add(_etiquetaEje('Z', 0, 0, L + 18, '#1976d2'));
    _worldGroup.add(_ejesGroup);
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

  // Por SEGMENTO (nodo i-1 → i): tipo 'recto'|'arco', radio, plano y sweep del arco.
  var _tiposSeg3d = [], _radiosSeg3d = [], _planosSeg3d = [], _sweepsSeg3d = [];

  // Genera puntos intermedios de un ARCO 3D entre a y b, curvado EN el plano dado.
  // El plano define el eje normal (fijo); el arco vive en los otros dos ejes.
  function _puntosArco3d(a, b, radio, plano, sweep) {
    var ejes = (plano === 'XZ') ? ['x','z'] : (plano === 'XY') ? ['x','y'] : ['y','z'];
    var normalEje = (plano === 'XZ') ? 'y' : (plano === 'XY') ? 'z' : 'x';
    // Trabajar en 2D dentro del plano.
    var ax = a[ejes[0]], ay = a[ejes[1]], bx = b[ejes[0]], by = b[ejes[1]];
    var cuerda = Math.sqrt((bx-ax)*(bx-ax) + (by-ay)*(by-ay)) || 1;
    var r = Math.max(radio || cuerda*0.75, cuerda/2 + 0.5);
    // Centro del arco (a un lado de la cuerda según sweep).
    var mx = (ax+bx)/2, my = (ay+by)/2;
    var h = Math.sqrt(Math.max(0, r*r - (cuerda/2)*(cuerda/2)));
    var ux = (bx-ax)/cuerda, uy = (by-ay)/cuerda;       // dir cuerda
    var nx = -uy, ny = ux;                               // normal a la cuerda
    var s = (sweep ? 1 : -1);
    var cx = mx + nx*h*s, cy = my + ny*h*s;             // centro
    var a0 = Math.atan2(ay-cy, ax-cx), a1 = Math.atan2(by-cy, bx-cx);
    // Elegir el arco corto en el sentido del sweep.
    var da = a1 - a0; while (da > Math.PI) da -= 2*Math.PI; while (da < -Math.PI) da += 2*Math.PI;
    var pts = [], N = 16;
    for (var k = 0; k <= N; k++) {
      var ang = a0 + da * (k/N);
      var p = {}; p[ejes[0]] = cx + r*Math.cos(ang); p[ejes[1]] = cy + r*Math.sin(ang);
      p[normalEje] = a[normalEje] + (b[normalEje]-a[normalEje])*(k/N);   // interp normal
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    return pts;
  }

  // 4 cotas de CADA arco, calculadas en el espacio 3D real y PROYECTADAS con _iso
  // (mismo espacio que los puntos de la figura) → nunca se descalibran de la vista.
  // Las 4 cotas: DESARROLLO del arco (curva paralela con offset, NO una recta),
  // RADIO (centro→arco), y proyecciones HORIZONTAL y VERTICAL (bounding box).
  // Devuelve [{desarrollo:[pts...], radio:[c,g], horiz:[a,b], vert:[a,b]}] proyectados.
  function _cotasArco3d() {
    var res = [];
    for (var i = 1; i < _nodos3d.length; i++) {
      if (_tiposSeg3d[i-1] !== 'arco') continue;
      var a = _nodos3d[i-1], b = _nodos3d[i];
      var plano = _planosSeg3d[i-1] || _planoActivo;
      var radio = _radiosSeg3d[i-1] || 0, sweep = _sweepsSeg3d[i-1];
      // Ejes del plano del arco (los 2 en los que curva) + el normal (fijo).
      var ejes = (plano === 'XZ') ? ['x','z'] : (plano === 'XY') ? ['x','y'] : ['y','z'];
      var normalEje = (plano === 'XZ') ? 'y' : (plano === 'XY') ? 'z' : 'x';
      // Geometría del arco EN el plano (igual que _puntosArco3d).
      var ax = a[ejes[0]], ay = a[ejes[1]], bx = b[ejes[0]], by = b[ejes[1]];
      var cuerdaLen = Math.sqrt((bx-ax)*(bx-ax)+(by-ay)*(by-ay)) || 1;
      var r = Math.max(radio || cuerdaLen*0.75, cuerdaLen/2 + 0.5);
      var mx = (ax+bx)/2, my = (ay+by)/2;
      var hh = Math.sqrt(Math.max(0, r*r - (cuerdaLen/2)*(cuerdaLen/2)));
      var ux = (bx-ax)/cuerdaLen, uy = (by-ay)/cuerdaLen, nx = -uy, ny = ux;
      var s = (sweep ? 1 : -1);
      var cx = mx + nx*hh*s, cy = my + ny*hh*s;            // centro (IGUAL que _puntosArco3d)
      var nrm = a[normalEje];   // coord normal (el plano es constante en ese eje)
      // Helper: punto 3D desde coords del plano (e0,e1) + normal.
      function P3(e0, e1) { var o = {}; o[ejes[0]]=e0; o[ejes[1]]=e1; o[normalEje]=nrm; return { x:o.x, y:o.y, z:o.z }; }
      // --- Barrido de ángulos IDÉNTICO al tubo (_puntosArco3d): a0→a1, arco CORTO. ---
      // Así el desarrollo y el radio comban EXACTAMENTE hacia el mismo lado que el fierro.
      var a0 = Math.atan2(ay - cy, ax - cx);
      var a1 = Math.atan2(by - cy, bx - cx);
      var da = a1 - a0; while (da > Math.PI) da -= 2*Math.PI; while (da < -Math.PI) da += 2*Math.PI;
      // Guata REAL = punto medio del arco (a mitad de barrido, a distancia r del centro).
      var angMed = a0 + da/2;
      var gx = cx + r*Math.cos(angMed), gy = cy + r*Math.sin(angMed);
      // Punto del arco para el RADIO: inclinado ~45° respecto a la guata (perpendicular
      // a la cuerda), para que el radio NO salga vertical y se distinga de la proy.
      // vertical. Se limita a no pasarse del extremo del arco si éste es chico.
      var incl = Math.min(Math.PI/4, Math.abs(da)/2 * 0.85) * (da >= 0 ? 1 : -1);
      var angRad = angMed + incl;
      var rpx = cx + r*Math.cos(angRad), rpy = cy + r*Math.sin(angRad);
      // --- DESARROLLO: misma curva del arco, empujada a radio r+off (queda por fuera). ---
      var offArco = Math.max(6, r*0.14);
      var rOff = r + offArco;
      var N = 24, desarrollo = [];
      for (var k = 0; k <= N; k++) {
        var t = a0 + da * (k / N);
        var ex = cx + rOff * Math.cos(t), ey = cy + rOff * Math.sin(t);
        desarrollo.push(_iso(P3(ex, ey)));
      }
      // --- RADIO: del PUNTO MEDIO de la cuerda al arco, inclinado 45°. ---
      // Nace en el medio de la recta que une los 2 nodos (mx,my) y sube al punto del
      // arco inclinado 45° (rpx,rpy).
      var M3 = P3(mx, my), R3 = P3(rpx, rpy);
      // VERT: la SAGITA (flecha) del arco = del medio de la cuerda a la GUATA,
      // perpendicular a la cuerda. Es el "alto" real del arco y por construcción
      // nunca cae paralela a la horizontal. Se dibuja AL COSTADO del arco (desplazada
      // lateralmente a lo largo de la cuerda hacia el extremo b), no al centro, para
      // que no se encime con el radio.
      var lat = cuerdaLen * 0.5 + offArco; // corrimiento lateral (más allá del extremo)
      var mvx = mx + ux*lat, mvy = my + uy*lat;   // base de la sagita, corrida al costado
      var gvx = gx + ux*lat, gvy = gy + uy*lat;   // tope de la sagita, mismo corrimiento
      var Mv3 = P3(mvx, mvy), Gv3 = P3(gvx, gvy);
      res.push({
        desarrollo: desarrollo,          // curva (muchos puntos)
        radio:  [ _iso(M3), _iso(R3) ],  // medio cuerda → punto del arco a 45°
        // HORIZ: recta directa entre los DOS NODOS extremos del arco (más limpio).
        horiz:  [ _iso({ x: a.x, y: a.y, z: a.z }), _iso({ x: b.x, y: b.y, z: b.z }) ],
        vert:   [ _iso(Mv3), _iso(Gv3) ]  // sagita (alto del arco) dibujada al costado
      });
    }
    return res;
  }

  // Construye la polilínea COMPLETA del tubo respetando rectos y arcos por tramo.
  function _polilineaTubo() {
    var pts = [_nodos3d[0].clone()];
    for (var i = 1; i < _nodos3d.length; i++) {
      if (_tiposSeg3d[i-1] === 'arco') {
        var arco = _puntosArco3d(_nodos3d[i-1], _nodos3d[i], _radiosSeg3d[i-1], _planosSeg3d[i-1] || _planoActivo, _sweepsSeg3d[i-1]);
        for (var k = 1; k < arco.length; k++) pts.push(arco[k]);
      } else {
        pts.push(_nodos3d[i].clone());
      }
    }
    return pts;
  }

  // Puntos de cada ARCO ya PROYECTADOS con _iso (mismos puntos 3D que el tubo del
  // visor). El motor SVG los dibuja como polyline (L), en vez de reconstruir la curva
  // con el comando SVG 'A' en 2D (que salía invertida porque la iso deforma el círculo).
  // Devuelve { <índice de segmento i-1>: [ptProy, ptProy, ...] } solo para arcos.
  function _arcosIso() {
    var res = {};
    for (var i = 1; i < _nodos3d.length; i++) {
      if (_tiposSeg3d[i-1] !== 'arco') continue;
      var arco3d = _puntosArco3d(_nodos3d[i-1], _nodos3d[i], _radiosSeg3d[i-1], _planosSeg3d[i-1] || _planoActivo, _sweepsSeg3d[i-1]);
      res[i-1] = arco3d.map(function(p) { return _iso({ x: p.x, y: p.y, z: p.z }); });
    }
    return res;
  }

  function _redibujarFigura3d() {
    if (!_figuraGroup) return;
    while (_figuraGroup.children.length) _figuraGroup.remove(_figuraGroup.children[0]);
    if (_nodos3d.length >= 2) {
      var linea = _polilineaTubo();
      // Estilo LÍNEA fina (como el 2D), no tubo grueso. Un tubo delgado da grosor
      // visual mínimo + se ve bien en cualquier ángulo. Radio pequeño (1.5).
      var curve = new THREE.CatmullRomCurve3(linea, false, 'catmullrom', 0.0);
      var geo = new THREE.TubeGeometry(curve, Math.max(24, linea.length * 4), 1.5, 6, false);
      var mat = new THREE.MeshBasicMaterial({ color: 0x00695c });
      _figuraGroup.add(new THREE.Mesh(geo, mat));
    }
    // Nodos como esferitas (marcadas con su índice para poder arrastrarlas).
    _nodosMesh = [];
    _nodos3d.forEach(function(p, idx) {
      var s = new THREE.Mesh(new THREE.SphereGeometry(4.5, 10, 10), new THREE.MeshBasicMaterial({ color: 0x004d40 }));
      s.position.copy(p); s.userData.nodoIdx = idx;
      _figuraGroup.add(s); _nodosMesh.push(s);
    });
  }
  var _nodosMesh = [];
  global.disenador3dRedibujar = _redibujarFigura3d;
  global.disenador3dNodos = function() { return _nodos3d; };

  // ---- Etapa B: DIBUJO por CLICKS sobre un PLANO de trabajo ----
  // Un click 3D es un rayo (ambiguo en profundidad). Solución: el nodo cae en el
  // PLANO de trabajo activo (con snap a grilla). Para dibujar en otra dirección,
  // el usuario cambia el plano. Convención de ingeniería: Z = ALTURA (vertical),
  // X e Y horizontales. PISO = XY (horizontal), FRONTAL = XZ, LATERAL = YZ.
  var _GRID3D = 40;              // paso de grilla del espacio
  var _planoActivo = 'XY';      // 'XY' (piso, horizontal) | 'XZ' (frontal) | 'YZ' (lateral)
  var _planoOffset = 0;         // desplazamiento del plano en su eje normal
  var _raycaster = null, _mouseNDC = null;
  var _orto = true;             // ORTO: fuerza tramos a 90° en el plano (default ON)

  // Modo de trazo 3D: recto o arco (para el próximo segmento).
  var _modoTrazo3d = 'recto', _segSel3d = -1;
  global.disenador3dSetTrazo = function(t) { _modoTrazo3d = (t === 'arco') ? 'arco' : 'recto'; };
  global.disenador3dSetRadio = function(v) {
    var r = Number(v) || 80;
    var val = document.getElementById('dis3dRadioVal'); if (val) val.textContent = r;
    if (_segSel3d >= 0) { _radiosSeg3d[_segSel3d] = r; _redibujarFigura3d(); _actualizarInfo3d(); }
  };
  global.disenador3dInvertirCurva = function() {
    if (_segSel3d >= 0 && _tiposSeg3d[_segSel3d] === 'arco') {
      _sweepsSeg3d[_segSel3d] = _sweepsSeg3d[_segSel3d] ? 0 : 1;
      _redibujarFigura3d(); _actualizarInfo3d();
    }
  };
  function _actualizarSlider3d() {
    var wrap = document.getElementById('dis3dRadioWrap');
    var es = _segSel3d >= 0 && _tiposSeg3d[_segSel3d] === 'arco';
    if (wrap) wrap.style.display = es ? 'inline-flex' : 'none';
    if (es) { var sl = document.getElementById('dis3dRadioSlider'); if (sl) sl.value = _radiosSeg3d[_segSel3d] || 80;
      var val = document.getElementById('dis3dRadioVal'); if (val) val.textContent = Math.round(_radiosSeg3d[_segSel3d] || 80); }
  }

  global.disenador3dToggleOrto = function() {
    _orto = !_orto;
    var b = document.getElementById('dis3dBtnOrto');
    if (b) {
      // Botón compacto (solo ícono 📐): el estado ON/OFF se refleja con el color, no
      // con texto. title informa el estado para accesibilidad.
      b.style.background = _orto ? '#00695c' : 'rgba(255,255,255,0.9)';
      b.style.color = _orto ? '#fff' : '#00695c';
      b.title = _orto ? 'Ortogonal: ON (ángulos rectos)' : 'Ortogonal: OFF (ángulos libres)';
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
        b.style.background = on ? '#00695c' : 'rgba(255,255,255,0.9)'; b.style.color = on ? '#fff' : '#00695c';
        b.style.border = '1px solid #00695c'; }
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
    // ORTO: snapea el ángulo del tramo (dentro del plano) a múltiplos de 45°
    // (0/45/90/135…), igual que el 2D. Permite rectos, diagonales limpias y 135°.
    if (_orto && _nodos3d.length) {
      var last = _nodos3d[_nodos3d.length - 1];
      var ejes = (_planoActivo === 'XZ') ? ['x', 'z'] : (_planoActivo === 'XY') ? ['x', 'y'] : ['y', 'z'];
      var e0 = hit[ejes[0]] - last[ejes[0]], e1 = hit[ejes[1]] - last[ejes[1]];
      var dist = Math.sqrt(e0 * e0 + e1 * e1);
      if (dist > 0.1) {
        var ang = Math.atan2(e1, e0);
        var snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);   // múltiplos de 45°
        // Largo a la grilla (proyección sobre la dirección snapeada).
        var largo = Math.max(_GRID3D, Math.round(dist / _GRID3D) * _GRID3D);
        hit[ejes[0]] = Math.round((last[ejes[0]] + largo * Math.cos(snap)) / _GRID3D) * _GRID3D;
        hit[ejes[1]] = Math.round((last[ejes[1]] + largo * Math.sin(snap)) / _GRID3D) * _GRID3D;
      }
    }
    return hit;
  }

  global.disenador3dDeshacer = function() {
    if (_nodos3d.length > 0) { _nodos3d.pop(); _tiposSeg3d.pop(); _radiosSeg3d.pop(); _planosSeg3d.pop(); _sweepsSeg3d.pop(); _segSel3d = -1; }
    // Recolocar el plano de trabajo al ÚLTIMO nodo restante (si no, el plano queda
    // flotando en la posición del nodo borrado hasta que se dibuje otro).
    if (_nodos3d.length) {
      var l = _nodos3d[_nodos3d.length - 1];
      _planoOffset = (_planoActivo === 'XZ') ? l.y : (_planoActivo === 'XY') ? l.z : l.x;
    } else { _planoOffset = 0; }
    _actualizarPlanoVisual();
    _redibujarFigura3d(); _actualizarInfo3d(); _actualizarSlider3d();
  };
  global.disenador3dLimpiarDibujo = function() {
    _nodos3d = []; _tiposSeg3d = []; _radiosSeg3d = []; _planosSeg3d = []; _sweepsSeg3d = []; _segSel3d = -1;
    _etiquetas3d = [];   // etiquetas 3D también se limpian (figura nueva)
    _isoBaseFijada = null;   // figura nueva → sin vista fijada (vuelve al iso paramétrico)
    if (typeof disenadorResetSeleccionEtiqueta === 'function') disenadorResetSeleccionEtiqueta();
    _redibujarFigura3d(); _actualizarInfo3d(); _actualizarSlider3d();
  };

  // Carga una figura 3D guardada (geo.nodos + tramos) al editor para re-editarla.
  // Reconstruye los nodos 3D y los arrays por segmento; restaura snapshot/etiquetas.
  global.disenador3dCargarFigura = function(geo) {
    if (!geo || geo.dim !== '3D' || !geo.nodos || geo.nodos.length < 2) return false;
    _nodos3d = geo.nodos.map(function(n) { return new THREE.Vector3(n.x, n.y, n.z); });
    if (geo.iso_angulo != null && !isNaN(geo.iso_angulo)) _isoAngulo = Number(geo.iso_angulo);
    // Restaurar la orientación fijada (si la figura se guardó con "Fijar vista").
    _isoBaseFijada = (geo.vista_base && geo.vista_base.rx != null) ? geo.vista_base : null;
    var tr = geo.tramos || [];
    _tiposSeg3d = tr.map(function(t) { return t.tipo || 'recto'; });
    _radiosSeg3d = tr.map(function(t) { return t.radio || 0; });
    _planosSeg3d = tr.map(function(t) { return t.plano || null; });
    _sweepsSeg3d = tr.map(function(t) { return t.sweep != null ? t.sweep : 1; });
    _segSel3d = -1;
    _snapshotFijado = geo.snapshot || null;
    _etiquetas3d = (geo.etiquetas || []).slice();
    if (_threeListo && _scene) { _redibujarFigura3d(); _actualizarInfo3d(); _actualizarSlider3d(); }
    return true;
  };

  var _snapshotFijado = null;   // dataURL del snapshot fijado por el usuario (o null)

  // Captura un PNG de la vista SIN el plano ni la grilla (solo la barra + ejes),
  // ENCUADRANDO la cámara a la figura para que llene el frame (antes quedaba chica
  // y perdida en el centro con mucho espacio vacío). Restaura todo tras capturar.
  function _capturarSnapshot() {
    if (!_renderer || !_camera) return null;
    // Ocultar ayudas de dibujo (plano + grilla + EJES) para la foto: solo la barra.
    var ocultados = [];
    [_planoMesh, _planoBorde, _gridMesh, _ejesGroup].forEach(function(o) {
      if (o && o.visible) { o.visible = false; ocultados.push(o); }
    });
    // Guardar la posición actual de la cámara para restaurarla.
    var pos0 = _camera.position.clone();
    // Encuadrar: centro y radio de la figura (nodos) en coords del MUNDO (con la
    // rotación actual del worldGroup aplicada), y acercar la cámara para que llene.
    _encuadrarCamaraAFigura();
    var url = null;
    try { _renderer.render(_scene, _camera); url = _renderer.domElement.toDataURL('image/png'); }
    catch (e) { url = null; }
    // Restaurar cámara y visibilidades.
    _camera.position.copy(pos0);
    _camera.lookAt(0, 0, 0);
    ocultados.forEach(function(o) { o.visible = true; });
    return url;
  }

  // Ajusta la distancia de la cámara para que la figura (nodos) llene el frame,
  // manteniendo el ángulo de vista actual. Mira al CENTRO de la figura.
  function _encuadrarCamaraAFigura() {
    if (!_nodos3d.length) return;
    // Bounding box de los nodos en el espacio del worldGroup (local).
    var min = _nodos3d[0].clone(), max = _nodos3d[0].clone();
    _nodos3d.forEach(function(p) {
      min.min(p); max.max(p);
    });
    var centroLocal = min.clone().add(max).multiplyScalar(0.5);
    // Radio que envuelve la figura (media diagonal del bbox) + margen.
    var radio = max.clone().sub(min).length() * 0.5;
    if (radio < 1) radio = 40;   // figura mínima
    radio *= 1.35;               // margen para que no quede pegada al borde
    // Centro en coords del MUNDO (aplicar la rotación actual del worldGroup).
    var centroMundo = centroLocal.clone();
    if (_worldGroup) { _worldGroup.updateMatrixWorld(); centroMundo.applyMatrix4(_worldGroup.matrixWorld); }
    // Distancia para que el radio quepa en el FOV vertical de la cámara.
    var fov = _camera.fov * Math.PI / 180;
    var dist = radio / Math.sin(fov / 2);
    // Mantener la DIRECCIÓN actual de la cámara (desde el origen), reubicándola a
    // esa distancia del centro de la figura.
    var dir = _camera.position.clone().normalize();   // dirección desde origen
    _camera.position.copy(centroMundo).add(dir.multiplyScalar(dist));
    _camera.lookAt(centroMundo);
  }

  // FIJAR la vista 3D actual como el snapshot oficial (lo que se verá/guardará).
  // Así el usuario controla desde qué ángulo se representa la figura 3D.
  global.disenador3dFijarVista = function() {
    if (_nodos3d.length < 2 || !_renderer) { alert('Dibuja la figura 3D antes de fijar la vista.'); return; }
    try {
      // Capturar la orientación REAL del canvas (right/up de la cámara en local del
      // worldGroup) → el preview la hereda con su profundidad, en vez del iso plano.
      _isoBaseFijada = _capturarBaseVista();
      _snapshotFijado = _capturarSnapshot();   // respaldo PNG
      _actualizarPreview3d();
      if (typeof showToast === 'function') showToast('Vista fijada: el preview usa la orientación actual del 3D.', 'success');
    } catch (e) { alert('No se pudo fijar la vista.'); }
  };
  global.disenador3dSnapshot = function() { return _snapshotFijado; };

  // ---- ETIQUETADO 3D: oculta el canvas 3D y muestra el lienzo 2D con el snapshot
  // de la barra como fondo, para etiquetar encima (reutiliza TODO el sistema 2D).
  var _etiquetando3d = false;
  var _etiquetas3d = [];        // etiquetas colocadas sobre el snapshot (persisten)
  global.disenador3dToggleEtiquetas = function() {
    if (!_etiquetando3d) {
      if (_nodos3d.length < 2) { alert('Dibuja la figura 3D (al menos 2 nodos) antes de etiquetar.'); return; }
      // Etiquetado sobre el SVG isométrico VECTORIAL (no una foto): se pasa la
      // geometría iso (puntos proyectados + tramos) al lienzo 2D.
      var geoIso = _geometriaLiveParaRender();
      if (!geoIso) { alert('No se pudo preparar la figura para etiquetar.'); return; }
      _etiquetando3d = true;
      // Ocultar el visor 3D y sus controles; mostrar el lienzo 2D (con imagen).
      var v3d = document.getElementById('disenador3DWrap'), ctrl3d = document.getElementById('disControles3D');
      var c2d = document.getElementById('disControles2D');
      if (v3d) v3d.style.display = 'none';
      if (ctrl3d) ctrl3d.style.display = 'none';
      var tr3 = document.getElementById('disTrazo3DRow'); if (tr3) tr3.style.display = 'none';   // ocultar trazo 3D al etiquetar
      if (c2d) c2d.style.display = '';
      // Panel: ocultar el de tramos 3D, mostrar el unificado (parámetros por etiqueta).
      var p3dW = document.getElementById('dis3dPanelWrap'); if (p3dW) p3dW.style.display = 'none';
      var p2dW = document.getElementById('disenadorPanelWrap'); if (p2dW) p2dW.style.display = '';
      // Ocultar los controles de DIBUJO 2D (trazo/deshacer/etc.), solo dejar etiquetas.
      _toggleControlesDibujo2d(false);
      if (typeof disenadorEntrarEtiquetado3D === 'function') disenadorEntrarEtiquetado3D(geoIso, _etiquetas3d);
      _actualizarBtnEtiq3d(true);
      // NO refrescar el preview aquí: debe quedarse EXACTAMENTE como estaba (no saltar).
      // El lienzo de etiquetado hereda el mismo encuadre (misma fórmula que el preview).
      // Mostrar el botón "Terminar etiquetado" (el de "Etiquetar barra" quedó oculto
      // con los controles 3D → sin él no había forma de salir del etiquetado).
      var bt = document.getElementById('disBtnTerminarEtiq3d'); if (bt) bt.style.display = '';
    } else {
      // Guardar las etiquetas colocadas y volver al visor 3D.
      if (typeof disenador3dEtiquetasGet === 'function') _etiquetas3d = disenador3dEtiquetasGet();
      if (typeof disenadorSalirEtiquetado3D === 'function') disenadorSalirEtiquetado3D();
      _etiquetando3d = false;
      var bt2 = document.getElementById('disBtnTerminarEtiq3d'); if (bt2) bt2.style.display = 'none';
      var v3d2 = document.getElementById('disenador3DWrap'), ctrl3d2 = document.getElementById('disControles3D');
      var c2d2 = document.getElementById('disControles2D');
      if (c2d2) c2d2.style.display = 'none';
      if (v3d2) v3d2.style.display = '';
      if (ctrl3d2) ctrl3d2.style.display = '';
      var tr32 = document.getElementById('disTrazo3DRow'); if (tr32) tr32.style.display = 'flex';   // restaurar trazo 3D
      // Panel: volver a mostrar el de tramos 3D, ocultar el unificado.
      var p3dW2 = document.getElementById('dis3dPanelWrap'); if (p3dW2) p3dW2.style.display = '';
      var p2dW2 = document.getElementById('disenadorPanelWrap'); if (p2dW2) p2dW2.style.display = 'none';
      _toggleControlesDibujo2d(true);   // restaurar para cuando se vuelva a 2D
      _actualizarBtnEtiq3d(false);
      _iniciarEspacio();   // re-render del visor 3D
    }
  };
  // Muestra/oculta los controles de DIBUJO 2D (trazo, deshacer, limpiar, terminar),
  // dejando solo la barra de etiquetas visible durante el etiquetado 3D.
  function _toggleControlesDibujo2d(mostrar) {
    var ids = ['disenadorLienzo'];   // el lienzo SIEMPRE visible; ocultamos los hermanos de control
    var c2d = document.getElementById('disControles2D');
    if (!c2d) return;
    // Ocultar las filas .row de controles de dibujo (no la barra de etiquetas).
    var rows = c2d.querySelectorAll(':scope > .row');
    rows.forEach(function(r) { r.style.display = mostrar ? '' : 'none'; });
    var btnEt = document.getElementById('disBtnEtiquetas');
    if (btnEt && btnEt.parentElement) btnEt.parentElement.style.display = mostrar ? '' : 'none';
  }
  function _actualizarBtnEtiq3d(on) {
    var b = document.getElementById('dis3dBtnEtiquetas');
    // Mismos textos que el 2D: OFF = "🏷️ Etiquetas", ON = "🏷️ Etiquetas: ON".
    if (b) { b.textContent = on ? '🏷️ Etiquetas: ON' : '🏷️ Etiquetas';
      b.style.background = on ? '#00695c' : '#fff'; b.style.color = on ? '#fff' : '#00695c'; }
  }
  global.disenador3dEtiquetas = function() { return _etiquetas3d.slice(); };
  global.disenador3dSetEtiquetas = function(arr) { _etiquetas3d = (arr || []).slice(); };

  // Geometría 3D para guardar: nodos (normalizados al 1er nodo), tramos con
  // lado + dirección + largo, y la vista isométrica 2D (para render en catálogo/BM).
  global.disenador3dGeometria = function() {
    if (_nodos3d.length < 2) return null;
    var p0 = _nodos3d[0];
    var nodos = _nodos3d.map(function(p) { return { x: p.x - p0.x, y: p.y - p0.y, z: p.z - p0.z }; });
    var tramos = [], parciales = [];
    for (var i = 1; i < _nodos3d.length; i++) {
      var a = _nodos3d[i - 1], b = _nodos3d[i];
      var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      var largo = Math.round(Math.sqrt(dx*dx + dy*dy + dz*dz) / _GRID3D);
      var lado = _LETRAS3D[i - 1] || ('L' + i);
      parciales.push(lado);
      tramos.push({ lado: lado, largo: largo, dx: dx, dy: dy, dz: dz,
        tipo: _tiposSeg3d[i-1] || 'recto', radio: _radiosSeg3d[i-1] || 0,
        plano: _planosSeg3d[i-1] || null, sweep: _sweepsSeg3d[i-1] != null ? _sweepsSeg3d[i-1] : 1 });
    }
    // Vista isométrica 2D (puntos) para dibujar la miniatura sin cargar Three.js.
    var puntos2d = _nodos3d.map(function(p) { return _iso(p); });
    return {
      dim: '3D',
      nodos: nodos,
      tramos: tramos,
      parciales: parciales,
      puntos: puntos2d,           // vista iso 2D (motor SVG la dibuja como render)
      arcos_iso: _arcosIso(),     // puntos de cada arco proyectados (polyline fiel al 3D)
      iso_angulo: _isoAngulo,     // ángulo de la proyección iso (para re-render coherente)
      vista_base: _isoBaseFijada, // orientación fijada con "Fijar vista" (null si no se fijó)
      angulos_iso: _angulosReales3d(),   // ángulos reales 3D (posición en la proyección)
      cotas_arco_iso: _cotasArco3d(),    // 4 cotas de cada arco, ya proyectadas
      snapshot: _snapshotFijado || _capturarSnapshot()   // fallback (foto de respaldo)
    };
  };

  // Preview 3D: dibujo VECTORIAL (SVG iso) del preview chico #disPreview. Usa la
  // proyección isométrica de los nodos (dibujarFigura del motor 2D), no una foto →
  // paramétrico, sin deformación, con las etiquetas integradas.
  function _actualizarPreview3d() {
    var prev = document.getElementById('disPreview');
    if (!prev) return;
    if (_nodos3d.length < 2) {
      prev.innerHTML = '<span class="muted" style="font-size:11px;">Dibuja la barra 3D para ver el preview.</span>';
      return;
    }
    // Geometría en vivo (puntos iso + tramos + etiquetas) → SVG con el motor 2D.
    var geo = _geometriaLiveParaRender();
    if (geo && window.disenadorMotor && window.disenadorMotor.dibujarFigura) {
      try { prev.innerHTML = window.disenadorMotor.dibujarFigura(geo, null, { width: 210, height: 140, pad: 18 }); return; }
      catch (e) { /* fallback abajo */ }
    }
    prev.innerHTML = '<span class="muted" style="font-size:11px;">Preview no disponible.</span>';
  }
  // Geometría mínima para el render SVG iso en vivo (sin recalcular todo el guardado).
  function _geometriaLiveParaRender() {
    if (_nodos3d.length < 2) return null;
    var puntos2d = _nodos3d.map(function(p) { return _iso(p); });
    var tramos = [];
    for (var i = 1; i < _nodos3d.length; i++) {
      tramos.push({ lado: _LETRAS3D[i-1] || ('L'+i), tipo: _tiposSeg3d[i-1] || 'recto',
                    radio: _radiosSeg3d[i-1] || 0, sweep: _sweepsSeg3d[i-1] != null ? _sweepsSeg3d[i-1] : 1 });
    }
    return { dim: '3D', puntos: puntos2d, tramos: tramos, etiquetas: _etiquetas3d.slice(),
             arcos_iso: _arcosIso(), ejes_iso: _ejesIso(),
             angulos_iso: _angulosReales3d(), cotas_arco_iso: _cotasArco3d() };
  }

  // Ejes X/Y/Z proyectados con _iso (misma orientación que la figura), para dibujarlos
  // SUTILMENTE en el preview → ayudan a entender la profundidad/orientación de la barra.
  // Cada eje: origen (0,0,0) → punto unitario escalado. Longitud relativa al tamaño.
  function _ejesIso() {
    if (!_nodos3d.length) return null;
    // Escala de los ejes = una fracción del tamaño de la figura (para que no dominen).
    var min = _nodos3d[0].clone(), max = _nodos3d[0].clone();
    _nodos3d.forEach(function(p){ min.min(p); max.max(p); });
    var L = Math.max(40, max.clone().sub(min).length() * 0.28);
    var o = _iso({ x: 0, y: 0, z: 0 });
    return {
      x: { o: o, p: _iso({ x: L, y: 0, z: 0 }) },
      y: { o: o, p: _iso({ x: 0, y: L, z: 0 }) },
      z: { o: o, p: _iso({ x: 0, y: 0, z: L }) }
    };
  }

  // Ángulos REALES de los vértices, calculados en 3D (con los nodos), NO de la
  // proyección. Aplica el criterio aSa (igual que el 2D): un doblez de 90° es
  // implícito (no cuenta como α especial); solo los ≠90 y ≠0 se marcan (α rojo).
  // Devuelve [{idx, texto, x, y}] con la posición en la PROYECCIÓN (para dibujar).
  function _angulosReales3d() {
    var out = [], nAlfa = 0;
    for (var j = 1; j < _nodos3d.length - 1; j++) {
      // Saltar vértices adyacentes a un arco (la curva es el doblez, no un ángulo).
      if (_tiposSeg3d[j-1] === 'arco' || _tiposSeg3d[j] === 'arco') continue;
      var a = _nodos3d[j-1], v = _nodos3d[j], b = _nodos3d[j+1];
      // Ángulo interno real 3D entre los dos segmentos (producto punto de vectores).
      var u1 = { x: a.x-v.x, y: a.y-v.y, z: a.z-v.z };
      var u2 = { x: b.x-v.x, y: b.y-v.y, z: b.z-v.z };
      var m1 = Math.sqrt(u1.x*u1.x+u1.y*u1.y+u1.z*u1.z) || 1;
      var m2 = Math.sqrt(u2.x*u2.x+u2.y*u2.y+u2.z*u2.z) || 1;
      var cos = (u1.x*u2.x+u1.y*u2.y+u1.z*u2.z)/(m1*m2);
      cos = Math.max(-1, Math.min(1, cos));
      var interno = Math.round(Math.acos(cos) * 180 / Math.PI);   // ángulo interno real
      if (interno === 0 || interno === 180) continue;   // recto continuo, sin doblez
      if (interno === 90) continue;                     // 90° implícito (criterio aSa)
      nAlfa++;
      // Posición: bisectriz en la PROYECCIÓN (donde se ve el vértice en 2D).
      var pv = _iso(v), pa = _iso(a), pb = _iso(b);
      var w1x = pa.x-pv.x, w1y = pa.y-pv.y; var l1 = Math.sqrt(w1x*w1x+w1y*w1y)||1;
      var w2x = pb.x-pv.x, w2y = pb.y-pv.y; var l2 = Math.sqrt(w2x*w2x+w2y*w2y)||1;
      var bx = w1x/l1+w2x/l2, by = w1y/l1+w2y/l2; var bl = Math.sqrt(bx*bx+by*by);
      if (bl < 0.15) { bx = -w1y/l1; by = w1x/l1; bl = 1; }
      out.push({ texto: 'α'+nAlfa, x: pv.x + (bx/bl)*14, y: pv.y + (by/bl)*14 });
    }
    return out;
  }

  // Al cambiar la figura, el snapshot fijado deja de ser válido (se libera).
  function _invalidarSnapshot() { _snapshotFijado = null; }

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
    _invalidarSnapshot();   // la figura cambió → el snapshot fijado ya no vale
    // Preview con un pequeño delay para que el render del frame esté listo.
    setTimeout(_actualizarPreview3d, 60);
    var el = document.getElementById('dis3dInfo');
    if (el) {
      var n = Math.max(0, _nodos3d.length - 1);
      el.textContent = n + ' tramo' + (n === 1 ? '' : 's') + ' · ' + _nodos3d.length + ' nodos';
    }
  }

  var _downX = 0, _downY = 0, _moved = 0, _dragNodo = -1;
  function _bindRotacion(cont) {
    cont.onmousedown = function(e) {
      _lastX = e.clientX; _lastY = e.clientY;
      _downX = e.clientX; _downY = e.clientY; _moved = 0;
      // ¿El mousedown golpeó una esfera de nodo? → arrastrar ese nodo (no rotar).
      _dragNodo = _nodoBajoCursor(e);
      _dragging = (_dragNodo < 0);   // solo rota si NO arrastramos un nodo
    };
    window.addEventListener('mousemove', _onMove);
    window.addEventListener('mouseup', _onUp);
  }

  // Índice del nodo bajo el cursor (raycast contra las esferas), o -1.
  function _nodoBajoCursor(ev) {
    if (!window.THREE || !_renderer || !_nodosMesh.length) return -1;
    var rect = _renderer.domElement.getBoundingClientRect();
    if (!_raycaster) { _raycaster = new THREE.Raycaster(); _mouseNDC = new THREE.Vector2(); }
    _mouseNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    _mouseNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouseNDC, _camera);
    var hits = _raycaster.intersectObjects(_nodosMesh, false);
    if (hits.length && hits[0].object.userData.nodoIdx != null) return hits[0].object.userData.nodoIdx;
    return -1;
  }

  function _onMove(e) {
    // Arrastrar un nodo: reposicionarlo en el plano de trabajo activo.
    if (_dragNodo >= 0) {
      var p = _puntoEnPlano(e);
      if (p && _nodos3d[_dragNodo]) {
        _nodos3d[_dragNodo].copy(p);
        _redibujarFigura3d(); _actualizarInfo3d();
        _moved += 10;   // marcar que hubo arrastre (para no colocar nodo al soltar)
      }
      return;
    }
    if (!_dragging) return;
    var dx = (e.clientX - _lastX) * 0.01, dy = (e.clientY - _lastY) * 0.01;
    // CANDADO DE EJE: si hay un eje seleccionado, el arrastre solo rota alrededor de
    // ESE eje (usa el desplazamiento total del mouse). Sin eje = 2 ejes como siempre.
    if (_ejeRot === 'Z') { _rotY += dx; }        // eje vertical (girar la mesa)
    else if (_ejeRot === 'X') { _rotX += dy; }   // inclinar adelante/atrás
    else if (_ejeRot === 'Y') { _rotZ += dx; }   // girar sobre el eje Y del mundo
    else { _rotY += dx; _rotX += dy; }           // libre: 2 ejes (como siempre)
    _moved += Math.abs(e.clientX - _lastX) + Math.abs(e.clientY - _lastY);
    _lastX = e.clientX; _lastY = e.clientY;
  }
  function _onUp(e) {
    if (_dragNodo >= 0) { _dragNodo = -1; return; }   // fin del arrastre de nodo
    if (!_dragging) return;
    _dragging = false;
    // Si casi no se movió → fue un CLICK: colocar un nodo en el plano de trabajo.
    if (_moved < 5 && _vista === '3D') {
      var cont = document.getElementById('disenador3D');
      if (cont) {
        var r = cont.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          var p = _puntoEnPlano(e);
          if (p) {
            _nodos3d.push(p);
            // Marcar el segmento recién creado según el modo de trazo.
            if (_nodos3d.length >= 2) {
              var seg = _nodos3d.length - 2;
              _tiposSeg3d[seg] = _modoTrazo3d;
              if (_modoTrazo3d === 'arco') {
                var a = _nodos3d[seg], b = _nodos3d[seg+1];
                var cu = Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y)+(b.z-a.z)*(b.z-a.z));
                _radiosSeg3d[seg] = Math.round(cu * 0.75);
                _planosSeg3d[seg] = _planoActivo;   // el arco vive en el plano activo
                _sweepsSeg3d[seg] = 1;
                _segSel3d = seg;
              }
            }
            _redibujarFigura3d(); _actualizarInfo3d(); _actualizarSlider3d();
          }
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
    var nombres = { XY: 'Plano PISO (X-Y)', XZ: 'Plano FRONTAL (X-Z)', YZ: 'Plano LATERAL (Y-Z)' };
    badge.textContent = '✏️ ' + (nombres[_planoActivo] || _planoActivo);
  }

  function _animar() {
    if (_vista !== '3D' || !_renderer) return;
    // Con Z vertical: el arrastre HORIZONTAL (_rotY) gira alrededor del eje vertical
    // Z; el arrastre VERTICAL (_rotX) inclina alrededor del eje X del mundo. _rotZ
    // gira sobre el eje Y del mundo (botón Y). Orden ZXY para que el giro sobre Z se
    // sienta como "girar la mesa".
    if (_worldGroup) {
      _worldGroup.rotation.order = 'ZXY';
      _worldGroup.rotation.z = _rotY;
      _worldGroup.rotation.x = _rotX;
      _worldGroup.rotation.y = _rotZ;
    }
    _renderer.render(_scene, _camera);
    _rafId = requestAnimationFrame(_animar);
  }

  // CANDADO DE EJE (botones X/Y/Z en la esquina del canvas): selecciona un eje y el
  // arrastre con mouse queda RESTRINGIDO a rotar solo alrededor de ese eje. Sin eje
  // ('libre') rota en 2 ejes como siempre. Es un selector: no rota solo, solo filtra
  // qué componente cambia el arrastre (_onMove). No toca geometría ni clicks → seguro.
  var _ejeRot = null;   // 'X' | 'Y' | 'Z' | null (libre)
  global.disenador3dSetEjeRot = function(eje) {
    _ejeRot = (_ejeRot === eje) ? null : eje;   // volver a clickear el mismo = liberar
    ['X','Y','Z'].forEach(function(e) {
      var b = document.getElementById('dis3dEje' + e);
      if (b) { b.style.background = (e === _ejeRot) ? '#00695c' : 'rgba(255,255,255,0.9)';
               b.style.color = (e === _ejeRot) ? '#fff' : '#00695c'; }
    });
  };
  function _detener3D() { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } }

  global.disenador3dEstado = function() { return { vista: _vista, listo: _threeListo, nodos: _nodos3d.length }; };
})(window);
