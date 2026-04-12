(function(global) {
  function bindDropZone(zoneId, fileInputId, onFiles, options) {
    var zone = document.getElementById(zoneId);
    var fileInput = document.getElementById(fileInputId);
    if (!zone || !fileInput) return;

    var settings = options || {};
    var activeBorderColor = settings.activeBorderColor || '#7b1fa2';
    var activeBackground = settings.activeBackground || '#f3e5f5';
    var fileFilter = settings.fileFilter || function(file) { return true; };

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
      var data = await response.json();
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