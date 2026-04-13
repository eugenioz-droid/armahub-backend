// ========================= CUBICACIÓN — Pedidos (E.4) =========================
let _pedidoActual = null;

async function loadPedidos() {
  const container = document.getElementById('pedidosList');
  const estado = document.getElementById('pedidoFiltroEstado').value;
  let url = '/pedidos';
  const params = [];
  if (estado) params.push('estado=' + encodeURIComponent(estado));
  if (params.length) url += '?' + params.join('&');

  const data = await apiGet(url);
  if (!data || !data.pedidos) { container.innerHTML = '<div class="muted">Error cargando pedidos</div>'; return; }
  if (data.pedidos.length === 0) { container.innerHTML = '<div class="muted">No hay pedidos</div>'; return; }

  const estadoColors = { borrador: '#9E9E9E', enviado: '#2196F3', en_proceso: '#FF9800', completado: '#8BC34A', cancelado: '#b42318' };

  container.innerHTML = data.pedidos.map(p => {
    const sc = estadoColors[p.estado] || '#666';
    const fecha = p.fecha_creacion ? p.fecha_creacion.substring(0, 10) : '';
    var tipoBadge = p.tipo === 'especifico'
      ? '<span style="font-size:9px; padding:1px 5px; border-radius:3px; background:#E3F2FD; color:#1565C0;">específico</span>'
      : '<span style="font-size:9px; padding:1px 5px; border-radius:3px; background:#FFF3E0; color:#E65100;">genérico</span>';
    var procBadge = p.procesado ? ' <span style="font-size:9px; padding:1px 5px; border-radius:3px; background:#E8F5E9; color:#2E7D32;">✓ procesado</span>' : '';
    return '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid #f0f0f0; cursor:pointer;" onclick="openPedido(' + p.id + ')">' +
      '<div>' +
        '<span style="font-weight:600; font-size:13px;">' + (p.titulo || 'Sin título') + '</span>' +
        ' <span class="muted" style="font-size:11px;">#' + p.id + '</span> ' + tipoBadge + procBadge +
        '<div class="muted" style="font-size:11px;">' + (p.nombre_proyecto || p.id_proyecto) + ' · ' + p.total_items + ' items · ' + fecha + '</div>' +
      '</div>' +
      '<span style="font-size:11px; padding:2px 8px; border-radius:10px; background:' + sc + '22; color:' + sc + '; font-weight:500;">' + p.estado + '</span>' +
    '</div>';
  }).join('');
}

async function crearPedido() {
  const proy = document.getElementById('pedidoProyecto').value;
  const titulo = document.getElementById('pedidoTitulo').value.trim();
  const msg = document.getElementById('pedidoCreateMsg');
  if (!proy) { msg.innerHTML = '<span class="status-err">Selecciona un proyecto</span>'; return; }
  if (!titulo) { msg.innerHTML = '<span class="status-err">Ingresa un título</span>'; return; }

  var tipo = document.getElementById('pedidoTipo').value || 'generico';
  const res = await apiPostJson('/pedidos', { id_proyecto: proy, titulo: titulo, tipo: tipo });
  if (res && res.ok) {
    msg.innerHTML = '<span class="status-ok">Pedido #' + res.id + ' creado (' + tipo + ')</span>';
    document.getElementById('pedidoTitulo').value = '';
    await loadPedidos();
    openPedido(res.id);
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (res?.detail || 'desconocido') + '</span>';
  }
}

async function openPedido(id) {
  _pedidoActual = id;
  const card = document.getElementById('pedidoDetailCard');
  card.style.display = '';

  const data = await apiGet('/pedidos/' + id);
  if (!data) { card.style.display = 'none'; return; }

  document.getElementById('pedidoDetailTitle').textContent = data.titulo || 'Sin título';
  var tipoLabel = data.tipo === 'especifico' ? 'Específico' : 'Genérico';
  document.getElementById('pedidoDetailMeta').textContent =
    (data.nombre_proyecto || data.id_proyecto) + ' · ' + tipoLabel + ' · Creado por ' + (data.creado_por || '—') +
    ' · ' + (data.fecha_creacion || '').substring(0, 10);
  document.getElementById('pedidoDetailEstado').value = data.estado;

  // Show/hide procesar button
  var btnProc = document.getElementById('btnProcesarPedido');
  if (btnProc) {
    btnProc.style.display = (!data.procesado && (data.estado === 'enviado' || data.estado === 'en_proceso') && data.items && data.items.length > 0) ? '' : 'none';
  }

  // Show/hide sector/piso/ciclo fields based on tipo
  var isEspecifico = data.tipo === 'especifico';
  var sg = document.getElementById('itemSectorGroup');
  var pg = document.getElementById('itemPisoGroup');
  var cg = document.getElementById('itemCicloGroup');
  if (sg) sg.style.display = isEspecifico ? '' : 'none';
  if (pg) pg.style.display = isEspecifico ? '' : 'none';
  if (cg) cg.style.display = isEspecifico ? '' : 'none';

  // Store tipo on the detail card for use by agregarItemPedido
  document.getElementById('pedidoDetailCard').dataset.tipo = data.tipo || 'generico';
  document.getElementById('pedidoDetailCard').dataset.procesado = data.procesado ? '1' : '0';

  const tbody = document.getElementById('pedidoItemsBody');
  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="muted">Sin items — agrega barras arriba</td></tr>';
  } else {
    const estadoItemColors = { pendiente: '#9E9E9E', en_proceso: '#FF9800', completado: '#8BC34A' };
    tbody.innerHTML = data.items.map(i => {
      const ic = estadoItemColors[i.estado] || '#666';
      return '<tr>' +
        '<td>' + (i.eje || '') + '</td>' +
        '<td style="font-weight:600;">' + i.diam + '</td>' +
        '<td>' + (i.largo || '—') + '</td>' +
        '<td>' + i.cantidad + '</td>' +
        '<td>' + (i.sector || '—') + '</td>' +
        '<td>' + (i.piso || '—') + '</td>' +
        '<td>' + (i.ciclo || '—') + '</td>' +
        '<td class="muted">' + (i.nota || '') + '</td>' +
        '<td><span style="font-size:10px; padding:1px 6px; border-radius:8px; background:' + ic + '22; color:' + ic + ';">' + i.estado + '</span></td>' +
        '<td><button onclick="eliminarItemPedido(' + id + ',' + i.id + ')" style="font-size:10px; padding:2px 6px; background:#fff; border:1px solid #ddd; color:#b42318; cursor:pointer;" title="Eliminar item">✕</button></td>' +
      '</tr>';
    }).join('');
  }
}

async function cambiarEstadoPedido() {
  if (!_pedidoActual) return;
  const estado = document.getElementById('pedidoDetailEstado').value;
  const msg = document.getElementById('pedidoDetailMsg');
  const res = await fetch('/pedidos/' + _pedidoActual, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: estado })
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Estado actualizado a: ' + estado + '</span>';
    await loadPedidos();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || 'desconocido') + '</span>';
  }
}

async function eliminarPedido() {
  if (!_pedidoActual) return;
  if (!confirm('¿Eliminar este pedido y todos sus items?')) return;
  const res = await apiDelete('/pedidos/' + _pedidoActual);
  if (res && res.ok) {
    document.getElementById('pedidoDetailCard').style.display = 'none';
    _pedidoActual = null;
    await loadPedidos();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function agregarItemPedido() {
  if (!_pedidoActual) return;
  var eje = (document.getElementById('itemEje').value || '').trim() || null;
  const diam = parseFloat(document.getElementById('itemDiam').value);
  const largo = parseFloat(document.getElementById('itemLargo').value) || null;
  const cantidad = parseInt(document.getElementById('itemCant').value) || 1;
  const sector = document.getElementById('itemSector').value || null;
  var piso = (document.getElementById('itemPiso').value || '').trim().toUpperCase() || null;
  var ciclo = (document.getElementById('itemCiclo').value || '').trim().toUpperCase() || null;
  const nota = document.getElementById('itemNota').value.trim() || null;
  const msg = document.getElementById('pedidoDetailMsg');

  if (!diam || isNaN(diam)) { msg.innerHTML = '<span class="status-err">Ingresa diámetro</span>'; return; }

  var body = { diam: diam, largo: largo, cantidad: cantidad, nota: nota };
  if (eje) body.eje = eje;
  if (sector) body.sector = sector;
  if (piso) body.piso = piso;
  if (ciclo) body.ciclo = ciclo;

  const res = await apiPostJson('/pedidos/' + _pedidoActual + '/items', body);
  if (res && res.ok) {
    document.getElementById('itemEje').value = '';
    document.getElementById('itemDiam').value = '';
    document.getElementById('itemLargo').value = '';
    document.getElementById('itemCant').value = '1';
    document.getElementById('itemSector').value = '';
    document.getElementById('itemPiso').value = '';
    document.getElementById('itemCiclo').value = '';
    document.getElementById('itemNota').value = '';
    msg.innerHTML = '<span class="status-ok">Item agregado</span>';
    await openPedido(_pedidoActual);
    await loadPedidos();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (res?.detail || 'desconocido') + '</span>';
  }
}

async function eliminarItemPedido(pedidoId, itemId) {
  if (!confirm('¿Eliminar este item?')) return;
  const res = await apiDelete('/pedidos/' + pedidoId + '/items/' + itemId);
  if (res && res.ok) {
    await openPedido(pedidoId);
    await loadPedidos();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function procesarPedido() {
  if (!_pedidoActual) return;
  if (!confirm('¿Procesar este pedido? Se generarán barras en la cubicación del proyecto. Esta acción no se puede deshacer.')) return;
  var msg = document.getElementById('pedidoDetailMsg');
  msg.innerHTML = '<span class="muted">Procesando...</span>';
  var res = await fetch('/pedidos/' + _pedidoActual + '/procesar', {
    method: 'POST', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Pedido procesado: ' + data.barras_creadas + ' barras generadas</span>';
    await openPedido(_pedidoActual);
    await loadPedidos();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || 'desconocido') + '</span>';
  }
}
