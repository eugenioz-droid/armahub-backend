// ========================= ADMIN — Entidades: Constructoras + Calculistas (E.5) =========================

// ========================= CLIENTES / CONSTRUCTORAS =========================
let _clientesCache = [];

async function loadClientes() {
  const data = await apiGet('/constructoras?activo=true');
  if (!data) return;
  _clientesCache = data.constructoras || [];

  // Populate client selector in crear obra
  const sel = document.getElementById('newObraCliente');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Sin constructora --</option>' +
      _clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    if (prev) sel.value = prev;
  }

  // Populate constructora selector in crear obra desde reclamo
  const recSel = document.getElementById('recNuevoProjConstructora');
  if (recSel) {
    const prev = recSel.value;
    recSel.innerHTML = '<option value="">— Sin constructora —</option>' +
      _clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    if (prev) recSel.value = prev;
  }

  // Render client list
  const container = document.getElementById('clientesContainer');
  if (!container) return;
  if (_clientesCache.length === 0) {
    container.innerHTML = '<div class="muted">No hay constructoras registradas</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:6px 8px;">Nombre</th>' +
    '<th style="padding:6px 8px;">RUT</th>' +
    '<th style="padding:6px 8px;">Contacto</th>' +
    '<th style="padding:6px 8px;">Email</th>' +
    '<th style="padding:6px 8px;">Tel</th>' +
    '<th style="padding:6px 8px;">Proyectos</th>' +
    '<th style="padding:6px 8px;">Kilos</th>' +
    '<th style="padding:6px 4px;"></th>' +
    '</tr>' +
    _clientesCache.map(c => `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:5px 8px; font-weight:500;">${c.nombre}</td>
      <td style="padding:5px 8px;" class="muted">${c.rut || '-'}</td>
      <td style="padding:5px 8px;">${c.contacto || '-'}</td>
      <td style="padding:5px 8px;">${c.email || '-'}</td>
      <td style="padding:5px 8px;">${c.telefono || '-'}</td>
      <td style="padding:5px 8px; text-align:center;"><span class="badge">${c.proyectos_count}</span></td>
      <td style="padding:5px 8px; text-align:right;">${c.total_kilos.toFixed(0)} kg</td>
      <td style="padding:5px 4px;">
        <button class="secondary" style="font-size:10px; padding:2px 6px;" onclick="editarCliente(${c.id})">Editar</button>
      </td>
    </tr>`).join('') +
    '</table>';
}

function toggleNuevoCliente() {
  const form = document.getElementById('nuevoClienteForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function crearCliente() {
  const nombre = document.getElementById('ncNombre').value.trim();
  const msg = document.getElementById('crearClienteMsg');
  if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';

  const body = { nombre: nombre };
  const rut = document.getElementById('ncRut').value.trim();
  const contacto = document.getElementById('ncContacto').value.trim();
  const email = document.getElementById('ncEmail').value.trim();
  const telefono = document.getElementById('ncTelefono').value.trim();
  if (rut) body.rut = rut;
  if (contacto) body.contacto = contacto;
  if (email) body.email = email;
  if (telefono) body.telefono = telefono;

  const res = await fetch(apiUrl('/constructoras'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.textContent = 'Constructora creada'; msg.style.color = '#558B2F';
    document.getElementById('ncNombre').value = '';
    document.getElementById('ncRut').value = '';
    document.getElementById('ncContacto').value = '';
    document.getElementById('ncEmail').value = '';
    document.getElementById('ncTelefono').value = '';
    document.getElementById('nuevoClienteForm').style.display = 'none';
    await loadClientes();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function editarCliente(clienteId) {
  const c = _clientesCache.find(x => x.id === clienteId);
  if (!c) return;
  const nuevoNombre = prompt('Nombre de la constructora:', c.nombre);
  if (nuevoNombre === null || nuevoNombre.trim() === '') return;
  const body = { nombre: nuevoNombre.trim() };
  const res = await fetch(apiUrl('/constructoras/' + clienteId), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadClientes();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

// ========================= CALCULISTAS =========================
let _calculistasCache = [];

async function loadCalculistas() {
  const data = await apiGet('/calculistas?activo=true');
  if (!data) return;
  _calculistasCache = data.calculistas || [];

  // Populate calculista selector in crear obra
  const sel = document.getElementById('newObraCalculista');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Sin calculista --</option>' +
      _calculistasCache.map(c => '<option value="' + c.id + '">' + c.nombre + '</option>').join('');
    if (prev) sel.value = prev;
  }

  // Populate calculista selector in crear obra desde reclamo
  const recSel = document.getElementById('recNuevoProjCalculista');
  if (recSel) {
    const prev = recSel.value;
    recSel.innerHTML = '<option value="">— Sin calculista —</option>' +
      _calculistasCache.map(c => '<option value="' + c.id + '">' + c.nombre + '</option>').join('');
    if (prev) recSel.value = prev;
  }

  // Render calculista list
  const container = document.getElementById('calculistasContainer');
  if (!container) return;
  if (_calculistasCache.length === 0) {
    container.innerHTML = '<div class="muted">No hay calculistas registrados</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:6px 8px;">Nombre</th>' +
    '<th style="padding:6px 8px;">Email</th>' +
    '<th style="padding:6px 8px;">Proyectos</th>' +
    '<th style="padding:6px 8px;">Barras</th>' +
    '<th style="padding:6px 8px;">Kilos</th>' +
    '<th style="padding:6px 4px;"></th>' +
    '</tr>' +
    _calculistasCache.map(c => '<tr style="border-bottom:1px solid #eee;">' +
      '<td style="padding:5px 8px; font-weight:500;">' + c.nombre + '</td>' +
      '<td style="padding:5px 8px;" class="muted">' + (c.email || '-') + '</td>' +
      '<td style="padding:5px 8px; text-align:center;"><span class="badge">' + c.proyectos_count + '</span></td>' +
      '<td style="padding:5px 8px; text-align:right;">' + c.total_barras.toLocaleString() + '</td>' +
      '<td style="padding:5px 8px; text-align:right;">' + c.total_kilos.toFixed(0) + ' kg</td>' +
      '<td style="padding:5px 4px;">' +
        '<button class="secondary" style="font-size:10px; padding:2px 6px;" onclick="editarCalculista(' + c.id + ')">Editar</button>' +
      '</td>' +
    '</tr>').join('') +
    '</table>';
}

function toggleNuevoCalculista() {
  const form = document.getElementById('nuevoCalculistaForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function crearCalculista() {
  const nombre = document.getElementById('nCalcNombre').value.trim();
  const msg = document.getElementById('crearCalculistaMsg');
  if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';

  const body = { nombre: nombre };
  const email = document.getElementById('nCalcEmail').value.trim();
  if (email) body.email = email;

  const res = await fetch(apiUrl('/calculistas'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.textContent = 'Calculista creado'; msg.style.color = '#558B2F';
    document.getElementById('nCalcNombre').value = '';
    document.getElementById('nCalcEmail').value = '';
    document.getElementById('nuevoCalculistaForm').style.display = 'none';
    await loadCalculistas();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function editarCalculista(calcId) {
  const c = _calculistasCache.find(x => x.id === calcId);
  if (!c) return;
  const nuevoNombre = prompt('Nombre del calculista:', c.nombre);
  if (nuevoNombre === null || nuevoNombre.trim() === '') return;
  const body = { nombre: nuevoNombre.trim() };
  const res = await fetch(apiUrl('/calculistas/' + calcId), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadCalculistas();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}
