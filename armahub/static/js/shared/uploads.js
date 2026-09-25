(function(global) {
  // ══════════════════════════════════════════════════════════════════════════════
  // PEGAR CON Ctrl+V (25-sep)
  // ------------------------------------------------------------------------------
  // Esto existió antes y se QUITÓ porque pegaba siempre en el formulario de registro,
  // aunque el usuario estuviera escribiendo el análisis. El problema nunca fue pegar:
  // fue no saber DÓNDE. Así que la regla de acá es no adivinar nunca:
  //
  //   1. Va a la zona ARMADA: la del trozo de pantalla donde el usuario tiene el foco
  //      (su `scopeId`), o la que clickeó. Escribes el análisis, pegas, cae en las
  //      imágenes del análisis.
  //   2. Si no hay ninguna armada pero hay UNA SOLA zona visible, es esa. Este es el
  //      caso normal: la pantalla ya esconde la zona que tu rol no puede usar, así que
  //      un cubicador sólo ve la del análisis y un USC sólo la del registro.
  //   3. Si hay varias y ninguna armada (le pasa al admin, que las ve todas), NO se
  //      elige por él: se le dice dónde hacer clic. Eso es exactamente lo que fallaba.
  //
  // Sólo actúa sobre imágenes del portapapeles. Pegar texto no se toca nunca.
  // ══════════════════════════════════════════════════════════════════════════════
  var _zonasPaste = [];      // {id, fileInputId, onFiles, fileFilter, scopeId, hintId, hintBase, color}
  var _armadaId = null;
  var _pasteListo = false;

  function _visible(el) { return !!(el && el.offsetParent !== null); }
  function _zonaPorId(id) {
    for (var i = 0; i < _zonasPaste.length; i++) if (_zonasPaste[i].id === id) return _zonasPaste[i];
    return null;
  }
  function _zonasVisibles() {
    return _zonasPaste.filter(function(z) { return _visible(document.getElementById(z.id)); });
  }

  // Pinta cuál está armada: sólo la armada dice "pega aquí". Sin esto el usuario no
  // tiene forma de saber a dónde va a caer su recorte antes de soltarlo.
  function _pintarArmada() {
    _zonasPaste.forEach(function(z) {
      var zona = document.getElementById(z.id);
      var hint = z.hintId ? document.getElementById(z.hintId) : null;
      var on = (z.id === _armadaId) && _visible(zona);
      if (zona) zona.style.borderColor = on ? (z.color || '#7b1fa2') : '';
      if (hint && z.hintBase != null) {
        hint.textContent = on ? (z.hintBase + ' · o pega con Ctrl+V') : z.hintBase;
        hint.style.color = on ? (z.color || '#7b1fa2') : '';
      }
    });
  }

  function _armar(id) {
    if (_armadaId === id) return;
    _armadaId = id;
    _pintarArmada();
  }

  function _zonaDestino() {
    var armada = _zonaPorId(_armadaId);
    if (armada && _visible(document.getElementById(armada.id))) return armada;
    var vis = _zonasVisibles();
    return vis.length === 1 ? vis[0] : null;
  }

  // Un recorte pegado llega SIEMPRE como "image.png". Si se pegan varios quedan todos
  // con el mismo nombre y en la ficha no hay forma de distinguirlos, ni de saber cuál
  // es cuál al descargarlos. Se les pone la hora.
  function _nombrarPegada(file) {
    var base = String(file.name || '').replace(/\.[^.]+$/, '');
    if (base && base.toLowerCase() !== 'image') return file;
    var ext = String(file.type || '').split('/')[1] || 'png';
    if (ext === 'jpeg') ext = 'jpg';
    var d = new Date();
    var p = function(n) { return (n < 10 ? '0' : '') + n; };
    var nombre = 'pegada-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + ext;
    try {
      return new File([file], nombre, { type: file.type, lastModified: file.lastModified || Date.now() });
    } catch (e) {
      return file;   // navegador sin constructor File: se sube con el nombre que traiga
    }
  }

  function _avisarAmbiguo() {
    var vis = _zonasVisibles();
    vis.forEach(function(z) {
      var hint = z.hintId ? document.getElementById(z.hintId) : null;
      if (!hint || z.hintBase == null) return;
      hint.textContent = '¿Aquí? Haz clic en esta zona y vuelve a pegar';
      hint.style.color = '#e65100';
      setTimeout(function() {
        if (z.id !== _armadaId) { hint.textContent = z.hintBase; hint.style.color = ''; }
      }, 4000);
    });
  }

  function _onPaste(e) {
    var cd = e.clipboardData || global.clipboardData;
    var items = cd && cd.items;
    if (!items) return;
    var pegados = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind !== 'file') continue;
      var f = items[i].getAsFile();
      if (f) pegados.push(f);
    }
    if (!pegados.length) return;            // pegó texto: no es asunto nuestro
    if (!_zonasVisibles().length) return;   // no hay dónde: que el pegado siga su curso
    var z = _zonaDestino();
    if (!z) { e.preventDefault(); _avisarAmbiguo(); return; }
    var utiles = pegados.filter(z.fileFilter).map(_nombrarPegada);
    if (!utiles.length) return;             // pegó un archivo que esta zona no acepta
    e.preventDefault();
    z.onFiles(utiles);
  }

  function _bindPasteGlobal() {
    if (_pasteListo) return;
    _pasteListo = true;
    document.addEventListener('paste', _onPaste);
    // ARMAR POR FOCO: el usuario escribe en el análisis → la zona del análisis queda
    // armada sin que tenga que hacer nada extra. Es lo que convierte esto en práctico:
    // sacas el recorte, Ctrl+V, y cae donde estabas trabajando.
    document.addEventListener('focusin', function(ev) {
      var el = ev.target;
      if (!el || !el.closest) return;
      for (var i = 0; i < _zonasPaste.length; i++) {
        var z = _zonasPaste[i];
        if (!z.scopeId) continue;
        var scope = document.getElementById(z.scopeId);
        if (scope && scope.contains(el) && _visible(document.getElementById(z.id))) { _armar(z.id); return; }
      }
    });
  }

  function bindDropZone(zoneId, fileInputId, onFiles, options) {
    var zone = document.getElementById(zoneId);
    var fileInput = document.getElementById(fileInputId);
    if (!zone || !fileInput) return;

    var settings = options || {};
    var activeBorderColor = settings.activeBorderColor || '#7b1fa2';
    var activeBackground = settings.activeBackground || '#f3e5f5';
    var fileFilter = settings.fileFilter || function(file) { return true; };

    // Registro para el Ctrl+V. Una sola vez por zona: initRecImageDropZones se llama en
    // cada apertura del modal y duplicar el registro subiría la imagen dos veces.
    if (!_zonaPorId(zoneId)) {
      var hintEl = settings.hintId ? document.getElementById(settings.hintId) : null;
      _zonasPaste.push({
        id: zoneId, fileInputId: fileInputId, onFiles: onFiles, fileFilter: fileFilter,
        scopeId: settings.scopeId || null, hintId: settings.hintId || null,
        hintBase: hintEl ? hintEl.textContent : null, color: activeBorderColor
      });
      zone.addEventListener('click', function() { _armar(zoneId); });
      _bindPasteGlobal();
    }

    function collectFiles(fileList) {
      var files = [];
      if (!fileList) return files;
      for (var i = 0; i < fileList.length; i++) {
        if (fileFilter(fileList[i])) files.push(fileList[i]);
      }
      return files;
    }

    zone.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = activeBorderColor;
      zone.style.background = activeBackground;
    });

    zone.addEventListener('dragleave', function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = '';
      zone.style.background = '';
    });

    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = '';
      zone.style.background = '';
      var files = collectFiles(e.dataTransfer && e.dataTransfer.files);
      if (files.length) onFiles(files);
    });

    fileInput.addEventListener('change', function() {
      var files = collectFiles(fileInput.files);
      fileInput.value = '';
      if (files.length) onFiles(files);
    });
  }

  function appendImagePreviewItems(files, stagedFiles, config) {
    var settings = config || {};
    var preview = document.getElementById(settings.previewId);
    var emptyHint = settings.emptyHintId ? document.getElementById(settings.emptyHintId) : null;
    if (!preview) return;

    for (var i = 0; i < files.length; i++) {
      stagedFiles.push(files[i]);
      var idx = stagedFiles.length - 1;
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative; display:inline-block;';
      wrap.setAttribute('data-idx', idx);

      var img = document.createElement('img');
      img.style.cssText = 'width:70px; height:70px; object-fit:cover; border-radius:6px; border:1px solid #ddd;';
      img.src = URL.createObjectURL(files[i]);

      var btn = document.createElement('button');
      btn.textContent = '✕';
      btn.style.cssText = 'position:absolute; top:-4px; right:-4px; background:#e53935; color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:11px; cursor:pointer; line-height:18px; padding:0;';
      btn.setAttribute('data-idx', idx);
      btn.onclick = function(ev) {
        ev.stopPropagation();
        var rmIdx = parseInt(this.getAttribute('data-idx'), 10);
        stagedFiles[rmIdx] = null;
        this.parentElement.remove();
        var hasAny = stagedFiles.some(function(file) { return file !== null; });
        if (emptyHint) emptyHint.style.display = hasAny ? 'none' : '';
      };

      wrap.appendChild(img);
      wrap.appendChild(btn);
      preview.appendChild(wrap);
    }

    if (emptyHint) emptyHint.style.display = 'none';
  }

  async function uploadFilesSequentially(files, options) {
    var items = Array.isArray(files) ? files.filter(function(file) { return !!file; }) : [];
    var settings = options || {};
    var results = [];

    for (var i = 0; i < items.length; i++) {
      var request = settings.buildRequest(items[i], i);
      var response = await fetch(request.url, request.fetchOptions);
      if (response.status === 401) {
        if (settings.onUnauthorized) settings.onUnauthorized();
        return { ok: false, unauthorized: true };
      }
      var data;
      try {
        data = await response.json();
      } catch (e) {
        return { ok: false, detail: 'Error del servidor (' + response.status + ')', index: i, file: items[i] };
      }
      if (!data.ok) {
        return { ok: false, detail: data.detail || 'desconocido', data: data, index: i, file: items[i] };
      }
      results.push(data);
    }

    return { ok: true, count: items.length, results: results };
  }

  global.bindDropZone = bindDropZone;
  global.appendImagePreviewItems = appendImagePreviewItems;
  global.uploadFilesSequentially = uploadFilesSequentially;
  global.ArmaHubUploads = {
    bindDropZone: bindDropZone,
    appendImagePreviewItems: appendImagePreviewItems,
    uploadFilesSequentially: uploadFilesSequentially
  };
})(window);