(function(global) {
  var imageViewerState = {
    images: [],
    currentIndex: 0,
    isOpen: false,
    options: {}
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

  function createNavButton(symbol, onClick) {
    var button = document.createElement('button');
    button.innerHTML = symbol;
    button.style.cssText = 'position:absolute; top:50%; transform:translateY(-50%); width:48px; height:48px; border:none; background:rgba(0,0,0,0.7); color:white; font-size:24px; border-radius:50%; cursor:pointer; z-index:1001; transition:all 0.2s;';
    if (symbol === '‹') button.style.left = '20px';
    if (symbol === '›') button.style.right = '20px';
    button.onmouseover = function() { this.style.background = 'rgba(0,0,0,0.9)'; };
    button.onmouseout = function() { this.style.background = 'rgba(0,0,0,0.7)'; };
    button.onclick = onClick;
    return button;
  }

  function createImageViewer() {
    var modal = document.createElement('div');
    modal.id = 'imageModalViewer';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:10000; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(5px);';
    modal.onclick = function(e) {
      if (e.target === modal) closeImageViewer();
    };

    var content = document.createElement('div');
    content.style.cssText = 'position:relative; width:90%; height:90%; max-width:1200px; background:white; border-radius:12px; overflow:hidden; display:flex; flex-direction:column;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:16px 20px; background:#f5f5f5; border-bottom:1px solid #e0e0e0;';
    header.onclick = function(e) { e.stopPropagation(); };

    var title = document.createElement('div');
    title.id = 'imageModalViewerTitle';
    title.style.cssText = 'font-size:16px; font-weight:600; color:#333;';
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'width:32px; height:32px; border:none; background:#f44336; color:white; border-radius:50%; cursor:pointer; font-size:18px; font-weight:bold;';
    closeBtn.onclick = closeImageViewer;
    header.appendChild(closeBtn);

    var mainArea = document.createElement('div');
    mainArea.style.cssText = 'flex:1; display:flex; position:relative; overflow:hidden;';
    mainArea.onclick = function(e) { e.stopPropagation(); };

    var viewer = document.createElement('div');
    viewer.id = 'imageViewerContent';
    viewer.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; background:#fafafa; position:relative;';

    var sidebar = document.createElement('div');
    sidebar.id = 'imageViewerSidebar';
    sidebar.style.cssText = 'width:300px; background:white; border-left:1px solid #e0e0e0; padding:20px; overflow-y:auto;';

    var footer = document.createElement('div');
    footer.id = 'imageViewerFooter';
    footer.style.cssText = 'display:flex; justify-content:center; align-items:center; padding:12px; background:#f5f5f5; border-top:1px solid #e0e0e0; gap:8px;';

    mainArea.appendChild(viewer);
    mainArea.appendChild(sidebar);
    content.appendChild(header);
    content.appendChild(mainArea);
    content.appendChild(footer);
    modal.appendChild(content);
    return modal;
  }

  function renderImageViewer() {
    var state = imageViewerState;
    if (!state.images.length || state.currentIndex >= state.images.length) return;

    var image = state.images[state.currentIndex];
    var viewer = document.getElementById('imageViewerContent');
    var sidebar = document.getElementById('imageViewerSidebar');
    var title = document.getElementById('imageModalViewerTitle');
    var footer = document.getElementById('imageViewerFooter');
    if (!viewer || !sidebar || !title || !footer) return;

    title.textContent = (state.currentIndex + 1) + ' / ' + state.images.length + ' - ' + (image.filename || 'Archivo');
    viewer.innerHTML = '';

    var prevBtn = createNavButton('‹', navigatePrevious);
    var nextBtn = createNavButton('›', navigateNext);
    prevBtn.style.display = state.currentIndex > 0 ? 'block' : 'none';
    nextBtn.style.display = state.currentIndex < state.images.length - 1 ? 'block' : 'none';
    viewer.appendChild(prevBtn);
    viewer.appendChild(nextBtn);

    if (image.content_type && image.content_type.startsWith('image/')) {
      var img = document.createElement('img');
      img.src = image.url;
      img.style.cssText = 'max-width:100%; max-height:100%; object-fit:contain; border-radius:8px;';
      viewer.appendChild(img);
    } else if (image.content_type === 'application/pdf') {
      var iframe = document.createElement('iframe');
      iframe.src = image.url;
      iframe.style.cssText = 'width:100%; height:100%; border:none; border-radius:8px;';
      viewer.appendChild(iframe);
    } else {
      var fileDiv = document.createElement('div');
      fileDiv.style.cssText = 'text-align:center; padding:40px;';
      fileDiv.innerHTML = '<div style="font-size:64px; margin-bottom:16px;">' + getFileIcon(image.filename) + '</div>' +
        '<div style="font-size:18px; font-weight:600; margin-bottom:8px;">' + (image.filename || 'Archivo') + '</div>' +
        '<div style="color:#666; margin-bottom:20px;">Tipo: ' + (image.content_type || 'Desconocido') + '</div>' +
        '<button onclick="window.open(\'' + image.url + '\', \"_blank\")" style="padding:10px 20px; background:#1976d2; color:white; border:none; border-radius:6px; cursor:pointer; font-size:14px;">Descargar archivo</button>';
      viewer.appendChild(fileDiv);
    }

    sidebar.innerHTML = '<h4 style="margin:0 0 16px 0; color:#333;">Información del archivo</h4>' +
      '<div style="margin-bottom:12px;"><strong>Nombre:</strong><br><span style="color:#666; word-break:break-all;">' + (image.filename || '—') + '</span></div>' +
      '<div style="margin-bottom:12px;"><strong>Tipo:</strong><br><span style="color:#666;">' + (image.content_type || '—') + '</span></div>' +
      '<div style="margin-bottom:12px;"><strong>Subido por:</strong><br><span style="color:#666;">' + (image.subido_por || '—') + '</span></div>' +
      '<div style="margin-bottom:12px;"><strong>Fecha:</strong><br><span style="color:#666;">' + formatViewerDate(image.fecha_subida) + '</span></div>' +
      (image.descripcion ? '<div style="margin-bottom:12px;"><strong>Descripción:</strong><br><span style="color:#666;">' + image.descripcion + '</span></div>' : '') +
      (image.tipo ? '<div style="margin-bottom:12px;"><strong>Categoría:</strong><br><span style="color:#666; background:#e3f2fd; padding:2px 8px; border-radius:4px; font-size:12px;">' + getCategoryLabel(image.tipo) + '</span></div>' : '');

    footer.innerHTML = '';
    for (var i = 0; i < state.images.length; i++) {
      var dot = document.createElement('button');
      dot.style.cssText = 'width:8px; height:8px; border:none; border-radius:50%; background:' + (i === state.currentIndex ? '#1976d2' : '#ccc') + '; cursor:pointer; margin:0 2px; transition:all 0.2s;';
      dot.onclick = (function(index) {
        return function() { navigateToImage(index); };
      })(i);
      footer.appendChild(dot);
    }
  }

  function openImageViewer(images, startIndex, options) {
    closeImageViewer();
    imageViewerState.images = Array.isArray(images) ? images : [];
    imageViewerState.currentIndex = startIndex || 0;
    imageViewerState.isOpen = imageViewerState.images.length > 0;
    imageViewerState.options = options || {};
    if (!imageViewerState.isOpen) return;

    document.body.appendChild(createImageViewer());
    renderImageViewer();
    document.addEventListener('keydown', handleImageViewerKeydown);
  }

  function closeImageViewer() {
    var modal = document.getElementById('imageModalViewer');
    if (modal) modal.remove();
    imageViewerState.isOpen = false;
    document.removeEventListener('keydown', handleImageViewerKeydown);
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