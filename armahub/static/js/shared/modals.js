(function(global) {
  var imageViewerState = {
    images: [],
    currentIndex: 0,
    isOpen: false,
    options: {},
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0
  };

  function resolveModal(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  function showModal(target, displayMode) {
    var modal = resolveModal(target);
    if (!modal) return null;
    modal.style.display = displayMode !== undefined ? displayMode : 'flex';
    return modal;
  }

  function hideModal(target) {
    var modal = resolveModal(target);
    if (!modal) return null;
    modal.style.display = 'none';
    return modal;
  }

  function isModalOpen(target) {
    var modal = resolveModal(target);
    return !!(modal && modal.style.display !== 'none');
  }

  function getFileIcon(filename) {
    if (imageViewerState.options.getFileIcon) {
      return imageViewerState.options.getFileIcon(filename);
    }
    return '📄';
  }

  function getCategoryLabel(tipo) {
    if (tipo === 'antecedente' || tipo === 'ImagenesRegistro') return '📋 Registro';
    if (tipo === 'respuesta' || tipo === 'ImagenesAnalisis') return '💬 Análisis';
    return tipo || '—';
  }

  function formatViewerDate(value) {
    if (typeof global.formatDateTime === 'function') {
      return global.formatDateTime(value, '—');
    }
    if (!value) return '—';
    return String(value).replace('T', ' ').substring(0, 19);
  }

  // ── Zoom helpers ──

  function resetZoom() {
    imageViewerState.zoom = 1;
    imageViewerState.panX = 0;
    imageViewerState.panY = 0;
    applyTransform();
    updateZoomLabel();
  }

  function setZoom(newZoom) {
    imageViewerState.zoom = Math.min(Math.max(newZoom, 0.5), 5);
    if (imageViewerState.zoom <= 1) {
      imageViewerState.panX = 0;
      imageViewerState.panY = 0;
    }
    applyTransform();
    updateZoomLabel();
  }

  function applyTransform() {
    var img = document.getElementById('imageViewerMainImg');
    if (!img) return;
    var s = imageViewerState;
    img.style.transform = 'translate(' + s.panX + 'px, ' + s.panY + 'px) scale(' + s.zoom + ')';
    img.style.cursor = s.zoom > 1 ? 'grab' : 'zoom-in';
  }

  function updateZoomLabel() {
    var label = document.getElementById('imageViewerZoomLabel');
    if (label) label.textContent = Math.round(imageViewerState.zoom * 100) + '%';
  }

  // ── Nav buttons ──

  function createNavButton(symbol, onClick) {
    var button = document.createElement('button');
    button.textContent = symbol;
    button.style.cssText = 'position:absolute; top:50%; transform:translateY(-50%); width:44px; height:44px; border:none; background:rgba(0,0,0,0.5); color:white; font-size:22px; border-radius:50%; cursor:pointer; z-index:1001; transition:background 0.2s; line-height:44px; text-align:center;';
    if (symbol === '‹') button.style.left = '12px';
    if (symbol === '›') button.style.right = '12px';
    button.onmouseover = function() { this.style.background = 'rgba(0,0,0,0.8)'; };
    button.onmouseout = function() { this.style.background = 'rgba(0,0,0,0.5)'; };
    button.onclick = function(e) { e.stopPropagation(); onClick(); };
    return button;
  }

  // ── Viewer DOM ──

  function createImageViewer() {
    var modal = document.createElement('div');
    modal.id = 'imageModalViewer';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.92); z-index:10000; display:flex; flex-direction:column; backdrop-filter:blur(4px);';
    modal.onclick = function(e) { if (e.target === modal) closeImageViewer(); };

    // ── Top bar ──
    var topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 16px; color:#ddd; font-size:13px; flex-shrink:0; user-select:none;';
    topBar.onclick = function(e) { e.stopPropagation(); };

    var titleEl = document.createElement('div');
    titleEl.id = 'imageModalViewerTitle';
    titleEl.style.cssText = 'font-size:13px; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:50%;';
    topBar.appendChild(titleEl);

    // Zoom controls
    var zoomBar = document.createElement('div');
    zoomBar.style.cssText = 'display:flex; align-items:center; gap:6px;';

    var zoomOut = document.createElement('button');
    zoomOut.textContent = '−';
    zoomOut.title = 'Alejar';
    zoomOut.style.cssText = 'width:28px; height:28px; border:1px solid #555; background:transparent; color:#ddd; border-radius:4px; cursor:pointer; font-size:16px; line-height:28px;';
    zoomOut.onclick = function() { setZoom(imageViewerState.zoom - 0.25); };
    zoomBar.appendChild(zoomOut);

    var zoomLabel = document.createElement('span');
    zoomLabel.id = 'imageViewerZoomLabel';
    zoomLabel.style.cssText = 'color:#aaa; font-size:12px; min-width:40px; text-align:center;';
    zoomLabel.textContent = '100%';
    zoomBar.appendChild(zoomLabel);

    var zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    zoomIn.title = 'Acercar';
    zoomIn.style.cssText = 'width:28px; height:28px; border:1px solid #555; background:transparent; color:#ddd; border-radius:4px; cursor:pointer; font-size:16px; line-height:28px;';
    zoomIn.onclick = function() { setZoom(imageViewerState.zoom + 0.25); };
    zoomBar.appendChild(zoomIn);

    var zoomReset = document.createElement('button');
    zoomReset.textContent = '⟳';
    zoomReset.title = 'Resetear zoom';
    zoomReset.style.cssText = 'width:28px; height:28px; border:1px solid #555; background:transparent; color:#ddd; border-radius:4px; cursor:pointer; font-size:14px; line-height:28px;';
    zoomReset.onclick = resetZoom;
    zoomBar.appendChild(zoomReset);

    var openTab = document.createElement('button');
    openTab.textContent = '↗';
    openTab.title = 'Abrir en nueva pestaña';
    openTab.style.cssText = 'width:28px; height:28px; border:1px solid #555; background:transparent; color:#ddd; border-radius:4px; cursor:pointer; font-size:14px; line-height:28px; margin-left:8px;';
    openTab.onclick = function() {
      var img = imageViewerState.images[imageViewerState.currentIndex];
      if (img && img.url) window.open(img.url, '_blank');
    };
    zoomBar.appendChild(openTab);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Cerrar (Esc)';
    closeBtn.style.cssText = 'width:28px; height:28px; border:none; background:transparent; color:#999; cursor:pointer; font-size:18px; line-height:28px; margin-left:12px;';
    closeBtn.onmouseover = function() { this.style.color = '#fff'; };
    closeBtn.onmouseout = function() { this.style.color = '#999'; };
    closeBtn.onclick = closeImageViewer;
    zoomBar.appendChild(closeBtn);

    topBar.appendChild(zoomBar);

    // ── Main area ──
    var mainArea = document.createElement('div');
    mainArea.style.cssText = 'flex:1; display:flex; position:relative; overflow:hidden; min-height:0;';
    mainArea.onclick = function(e) { e.stopPropagation(); };

    var viewer = document.createElement('div');
    viewer.id = 'imageViewerContent';
    viewer.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;';

    mainArea.appendChild(viewer);

    // ── Bottom bar (thumbnails) ──
    var bottomBar = document.createElement('div');
    bottomBar.id = 'imageViewerFooter';
    bottomBar.style.cssText = 'display:flex; justify-content:center; align-items:center; padding:8px 16px; gap:4px; flex-shrink:0; overflow-x:auto;';
    bottomBar.onclick = function(e) { e.stopPropagation(); };

    modal.appendChild(topBar);
    modal.appendChild(mainArea);
    modal.appendChild(bottomBar);
    return modal;
  }

  function renderImageViewer() {
    var state = imageViewerState;
    if (!state.images.length || state.currentIndex >= state.images.length) return;

    var image = state.images[state.currentIndex];
    var viewer = document.getElementById('imageViewerContent');
    var title = document.getElementById('imageModalViewerTitle');
    var footer = document.getElementById('imageViewerFooter');
    if (!viewer || !title || !footer) return;

    // Reset zoom on image change
    state.zoom = 1; state.panX = 0; state.panY = 0;
    updateZoomLabel();

    title.textContent = (state.currentIndex + 1) + ' / ' + state.images.length + '  ·  ' + (image.filename || 'Archivo');
    viewer.innerHTML = '';

    // Nav arrows
    if (state.currentIndex > 0) viewer.appendChild(createNavButton('‹', navigatePrevious));
    if (state.currentIndex < state.images.length - 1) viewer.appendChild(createNavButton('›', navigateNext));

    if (image.content_type && image.content_type.startsWith('image/')) {
      var img = document.createElement('img');
      img.id = 'imageViewerMainImg';
      img.src = image.url;
      img.draggable = false;
      img.style.cssText = 'max-width:95%; max-height:95%; object-fit:contain; transition:transform 0.15s ease; transform-origin:center center; cursor:zoom-in; user-select:none;';

      // Double-click toggle zoom
      img.ondblclick = function(e) {
        e.preventDefault();
        if (state.zoom > 1) { resetZoom(); } else { setZoom(2); }
      };

      // Wheel zoom
      img.onwheel = function(e) {
        e.preventDefault();
        var delta = e.deltaY < 0 ? 0.2 : -0.2;
        setZoom(state.zoom + delta);
      };

      // Pan on drag when zoomed
      img.onmousedown = function(e) {
        if (state.zoom <= 1) return;
        e.preventDefault();
        state.isPanning = true;
        state.panStartX = e.clientX - state.panX;
        state.panStartY = e.clientY - state.panY;
        img.style.cursor = 'grabbing';
        img.style.transition = 'none';
      };
      document.addEventListener('mousemove', handlePanMove);
      document.addEventListener('mouseup', handlePanEnd);

      viewer.appendChild(img);
    } else if (image.content_type === 'application/pdf') {
      var iframe = document.createElement('iframe');
      iframe.src = image.url;
      iframe.style.cssText = 'width:90%; height:90%; border:none; border-radius:6px; background:white;';
      viewer.appendChild(iframe);
    } else {
      var fileDiv = document.createElement('div');
      fileDiv.style.cssText = 'text-align:center; padding:40px; color:#ccc;';
      var iconSpan = document.createElement('div');
      iconSpan.style.cssText = 'font-size:56px; margin-bottom:12px;';
      iconSpan.textContent = getFileIcon(image.filename);
      fileDiv.appendChild(iconSpan);

      var nameSpan = document.createElement('div');
      nameSpan.style.cssText = 'font-size:16px; font-weight:600; margin-bottom:6px; color:#eee;';
      nameSpan.textContent = image.filename || 'Archivo';
      fileDiv.appendChild(nameSpan);

      var typeSpan = document.createElement('div');
      typeSpan.style.cssText = 'color:#888; margin-bottom:16px; font-size:13px;';
      typeSpan.textContent = image.content_type || 'Desconocido';
      fileDiv.appendChild(typeSpan);

      var dlBtn = document.createElement('button');
      dlBtn.textContent = 'Abrir archivo';
      dlBtn.style.cssText = 'padding:8px 18px; background:#1976d2; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;';
      dlBtn.onclick = function() { window.open(image.url, '_blank'); };
      fileDiv.appendChild(dlBtn);

      viewer.appendChild(fileDiv);
    }

    // Thumbnail strip
    footer.innerHTML = '';
    if (state.images.length > 1) {
      for (var i = 0; i < state.images.length; i++) {
        var thumbBtn = document.createElement('button');
        thumbBtn.style.cssText = 'width:40px; height:40px; border:2px solid ' + (i === state.currentIndex ? '#1976d2' : 'transparent') + '; border-radius:4px; padding:0; cursor:pointer; overflow:hidden; background:#222; flex-shrink:0; transition:border-color 0.2s;';
        if (state.images[i].content_type && state.images[i].content_type.startsWith('image/')) {
          var thumbImg = document.createElement('img');
          thumbImg.src = state.images[i].url;
          thumbImg.style.cssText = 'width:100%; height:100%; object-fit:cover;';
          thumbImg.draggable = false;
          thumbBtn.appendChild(thumbImg);
        } else {
          thumbBtn.style.cssText += 'font-size:16px; display:flex; align-items:center; justify-content:center; color:#aaa;';
          thumbBtn.textContent = '📄';
        }
        thumbBtn.onclick = (function(index) { return function() { navigateToImage(index); }; })(i);
        footer.appendChild(thumbBtn);
      }
    }
  }

  function handlePanMove(e) {
    if (!imageViewerState.isPanning) return;
    imageViewerState.panX = e.clientX - imageViewerState.panStartX;
    imageViewerState.panY = e.clientY - imageViewerState.panStartY;
    applyTransform();
  }

  function handlePanEnd() {
    if (!imageViewerState.isPanning) return;
    imageViewerState.isPanning = false;
    var img = document.getElementById('imageViewerMainImg');
    if (img) {
      img.style.cursor = imageViewerState.zoom > 1 ? 'grab' : 'zoom-in';
      img.style.transition = 'transform 0.15s ease';
    }
  }

  function openImageViewer(images, startIndex, options) {
    closeImageViewer();
    imageViewerState.images = Array.isArray(images) ? images : [];
    imageViewerState.currentIndex = startIndex || 0;
    imageViewerState.isOpen = imageViewerState.images.length > 0;
    imageViewerState.options = options || {};
    imageViewerState.zoom = 1;
    imageViewerState.panX = 0;
    imageViewerState.panY = 0;
    if (!imageViewerState.isOpen) return;

    document.body.appendChild(createImageViewer());
    renderImageViewer();
    document.addEventListener('keydown', handleImageViewerKeydown);
  }

  function closeImageViewer() {
    var modal = document.getElementById('imageModalViewer');
    if (modal) modal.remove();
    imageViewerState.isOpen = false;
    imageViewerState.isPanning = false;
    document.removeEventListener('keydown', handleImageViewerKeydown);
    document.removeEventListener('mousemove', handlePanMove);
    document.removeEventListener('mouseup', handlePanEnd);
  }

  function navigatePrevious() {
    if (imageViewerState.currentIndex > 0) {
      imageViewerState.currentIndex--;
      renderImageViewer();
    }
  }

  function navigateNext() {
    if (imageViewerState.currentIndex < imageViewerState.images.length - 1) {
      imageViewerState.currentIndex++;
      renderImageViewer();
    }
  }

  function navigateToImage(index) {
    imageViewerState.currentIndex = index;
    renderImageViewer();
  }

  function handleImageViewerKeydown(e) {
    if (!imageViewerState.isOpen) return;
    if (e.key === 'Escape') closeImageViewer();
    if (e.key === 'ArrowLeft') navigatePrevious();
    if (e.key === 'ArrowRight') navigateNext();
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(imageViewerState.zoom + 0.25); }
    if (e.key === '-') { e.preventDefault(); setZoom(imageViewerState.zoom - 0.25); }
    if (e.key === '0') { e.preventDefault(); resetZoom(); }
  }

  global.showModal = showModal;
  global.hideModal = hideModal;
  global.isModalOpen = isModalOpen;
  global.openImageViewer = openImageViewer;
  global.closeImageViewer = closeImageViewer;
  global.ArmaHubModal = {
    showModal: showModal,
    hideModal: hideModal,
    isModalOpen: isModalOpen,
    openImageViewer: openImageViewer,
    closeImageViewer: closeImageViewer
  };
})(window);