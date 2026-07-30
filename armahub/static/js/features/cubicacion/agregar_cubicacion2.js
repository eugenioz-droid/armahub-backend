// ArmaHub — "Agregar Cubicación 2" (creador de lotes, maqueta Etapa 1f → cableado 5N.20).
// Sub-paso 1: contexto REAL (Obra·Ciclo·Eje) desde la API; la grilla/guardado siguen siendo
// maqueta (datos de ejemplo) y se cablean en sub-pasos 2-5.
//
// Estilo: scope global compartido (como el resto de features de cubicación). Las funciones
// ac2* se exponen en window (las llama el HTML via onclick). Estado en el objeto AC2 (NO se
// lee del DOM para el contexto). IDs 'ac2*'. Reusa /filters (obras + ciclos/ejes por obra),
// shared/api.js (apiGet) y shared/combobox.js (Combobox.crear).

/* Estado de la maqueta/creador. */
var AC2 = {
  render:true, tam:'m', tipo:'TODOS', orden:'piso', masiva:false, terminado:false,
  // Contexto real (vive en JS, no en el DOM):
  proyecto:null,   // id de la obra elegida (GET /filters → proyectos[].id)
  ciclo:'',        // ciclo elegido/escrito (texto libre)
  eje:'',          // eje/losa elegido/escrito (texto libre)
  // 5N.20 sub-paso 1: la "tipología" (subtab MH/MV/TR/EC/TC/CB) ES el campo `marca` de la
  // barra (decisión de producto CERRADA). AC2.tipo = valor de `marca` que se asignará a las
  // barras nuevas. NO es un campo nuevo; el guardado (sub-paso siguiente) estampará marca=tipo.
  barras: [
    { piso:'P3', tipo:'MH', diam:16, cant:120, largo:340, peso:643.2, fig:'104B', dims:[340,85], r:null, rev:true,  invalida:false },
    { piso:'P3', tipo:'TR', diam:12, cant:80,  largo:500, peso:355.0, fig:'201A', dims:[200,100,200], r:8, a3:135, rev:false, invalida:false },
    { piso:'P4', tipo:'MH', diam:16, cant:120, largo:340, peso:643.2, fig:'104B', dims:[340,85], r:null, rev:true,  invalida:false },
    { piso:'P5', tipo:'MV', diam:10, cant:60,  largo:280, peso:172.5, fig:'101A', dims:[280,999], r:null, rev:false, invalida:true }  // ejemplo inválido: 101A no usa B
  ]
};
var AC2_LADOS=['A','B','C','D','E','F','G','H','I'];
var AC2_TIPOS=['MH','MV','TR','EC','TC','CB'];
var AC2_ORD_TIPO={MH:0,MV:1,TR:2,EC:3,TC:4,CB:5};
var AC2_TAM={ s:{w:54,h:36}, m:{w:90,h:60}, l:{w:135,h:90} };   // S · M (~+66%) · L (+50% sobre M)

function ac2Esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function ac2Num(v,d){ if(v==null||v===''||isNaN(v)) return ''; return d? Number(v).toFixed(d): Math.round(Number(v)); }
// Geometrías de EJEMPLO por figura (maqueta) para ver el render REAL escalar con S/M/L.
// Al cablear se usará la geometría del catálogo (/figuras-catalogo).
var AC2_GEO_EJEMPLO = {
  '104B': { dim:'2D', tramos:[{lado:'A',tipo:'recto'},{lado:'B',tipo:'recto'}], puntos:[{x:0,y:0},{x:100,y:0},{x:100,y:40}] },  // L
  '101A': { dim:'2D', tramos:[{lado:'A',tipo:'recto'}], puntos:[{x:0,y:0},{x:100,y:0}] },  // recta
  '201A': { dim:'2D', tramos:[{lado:'A',tipo:'recto'},{lado:'B',tipo:'recto'},{lado:'C',tipo:'recto'}], puntos:[{x:0,y:40},{x:0,y:0},{x:100,y:0},{x:100,y:40}] }  // U
};
function ac2FigSvg(b){
  var t=AC2_TAM[AC2.tam];
  var geo = AC2_GEO_EJEMPLO[b.fig];
  if (geo && window.disenadorMotor && window.disenadorMotor.dibujarFigura) {
    try { return '<span style="display:inline-block; vertical-align:middle;">' +
      window.disenadorMotor.dibujarFigura(geo, null, { width:t.w, height:t.h, pad:6 }) + '</span>'; }
    catch(e){}
  }
  // Fallback si el motor no cargó: caja con el tamaño para ver el escalado igual.
  return '<span style="display:inline-block; width:'+t.w+'px; height:'+t.h+'px; border:1px dashed #cfd8dc; border-radius:3px; vertical-align:middle; text-align:center; line-height:'+t.h+'px; color:#bbb; font-size:9px;">'+ac2Esc(b.fig||'▱')+'</span>';
}

function ac2Visibles(){
  // _i = índice en AC2.barras (para que el toggle Rev mute la barra correcta pese al reorden).
  AC2.barras.forEach(function(b,i){ b._i=i; });
  var arr = AC2.barras.filter(function(b){ return AC2.tipo==='TODOS' || b.tipo===AC2.tipo; });
  var porTipo = (AC2.tipo==='TODOS' && AC2.orden==='tipo') || AC2.masiva;
  arr.sort(function(a,b){ return porTipo
    ? ((AC2_ORD_TIPO[a.tipo]-AC2_ORD_TIPO[b.tipo]) || a.piso.localeCompare(b.piso))
    : (a.piso.localeCompare(b.piso) || (AC2_ORD_TIPO[a.tipo]-AC2_ORD_TIPO[b.tipo])); });
  return arr;
}

function ac2Thead(){
  var mostrarTipo = (AC2.tipo==='TODOS');   // en subtab se oculta la columna Tipología
  var h='<tr style="color:#666; background:#fafafa;">';
  // Solo en modo masivo, un check de SELECCIÓN al inicio (para acciones masivas).
  if (AC2.masiva) h+='<th style="padding:3px 6px; text-align:center; width:22px;" title="Seleccionar">☑</th>';
  h+='<th style="text-align:left; padding:3px 6px;">Piso</th>';
  if (mostrarTipo) h+='<th style="text-align:left; padding:3px 6px;">Tipología</th>';
  h+='<th style="text-align:right; padding:3px 6px;">φ</th><th style="text-align:right; padding:3px 6px;">Cant</th>';
  h+='<th style="text-align:right; padding:3px 6px;">Largo</th><th style="text-align:right; padding:3px 10px 3px 6px;">Peso Tot</th>';
  // Figura + Dibujo separados del bloque numérico (Peso Tot) con un borde suave y aire.
  h+='<th style="text-align:left; padding:3px 6px 3px 14px; border-left:1px solid #e0e0e0;">Figura</th>';
  if (AC2.render) h+='<th style="text-align:left; padding:3px 6px;">Dibujo</th>';
  AC2_LADOS.forEach(function(L){ h+='<th style="text-align:right; padding:3px 6px;">'+L+'</th>'; });
  ['α1','α2','α3','α4'].forEach(function(a){ h+='<th style="text-align:right; padding:3px 6px;">'+a+'</th>'; });
  h+='<th style="text-align:right; padding:3px 6px;">R</th>';
  h+='<th style="padding:3px 6px; text-align:center;" title="Revisada por el cubicador">Rev</th>';
  h+='<th style="padding:3px 6px;"></th></tr>';
  return h;
}

function ac2Fila(b){
  var mostrarTipo=(AC2.tipo==='TODOS');
  var td='<td style="padding:2px 6px; border-top:1px solid #f0f0f0;">';
  var tdr='<td style="padding:2px 6px; border-top:1px solid #f0f0f0; text-align:right;">';
  // Celda de dim: roja si la barra es inválida (simulado con b.invalida en la maqueta).
  var tddim=function(v){ var bg=b.invalida?' background:#ffcdd2;':(v!=null&&v!==''?'':' background:#fafafa;'); return '<td style="padding:2px 6px; border-top:1px solid #f0f0f0; text-align:right;'+bg+'">'+ac2Num(v)+'</td>'; };
  var h='<tr'+(b.invalida?' title="Geometría inválida para la figura"':'')+'>';
  // Check de SELECCIÓN masiva SOLO al inicio y SOLO en modo masivo. data-grp = tipología
  // (para que el check maestro del grupo marque/desmarque solo los suyos).
  if (AC2.masiva) h+='<td style="padding:2px 6px; border-top:1px solid #f0f0f0; text-align:center;"><input type="checkbox" class="ac2sel" data-grp="'+ac2Esc(b.tipo)+'" onclick="ac2SelFila()"/></td>';
  h+=td+ac2Esc(b.piso)+'</td>';
  if (mostrarTipo) h+=td+'<b>'+ac2Esc(b.tipo)+'</b></td>';   // en TODOS: aquí iría un <select> al cablear
  h+=tdr+ac2Num(b.diam)+'</td>'+tdr+ac2Num(b.cant)+'</td>';
  h+='<td style="padding:2px 6px; border-top:1px solid #f0f0f0; text-align:right; color:#1565c0; font-weight:600;">'+ac2Num(b.largo)+'</td>';
  h+='<td style="padding:2px 10px 2px 6px; border-top:1px solid #f0f0f0; text-align:right; color:#00695c; font-weight:600;">'+ac2Num(b.peso,1)+'</td>';
  // Figura separada del bloque numérico con borde suave + aire a la izquierda.
  h+='<td style="padding:2px 6px 2px 14px; border-top:1px solid #f0f0f0; border-left:1px solid #eee; color:#666;"><b>'+ac2Esc(b.fig)+'</b></td>';
  if (AC2.render) h+=td+ac2FigSvg(b)+'</td>';
  for (var i=0;i<9;i++){ h+=tddim(b.dims[i]); }
  for (var j=0;j<4;j++){ var av=b['a'+(j+1)]; h+= (av!=null&&av!=='')?(tdr+ac2Num(av)+'</td>'):'<td style="padding:2px 6px; border-top:1px solid #f0f0f0; background:#fafafa;"></td>'; }
  h+= (b.r!=null&&b.r!=='')?(tdr+ac2Num(b.r)+'</td>'):'<td style="padding:2px 6px; border-top:1px solid #f0f0f0; background:#fafafa;"></td>';
  // Rev (revisada por el cubicador) — AL FINAL, antes de las acciones.
  h+='<td style="padding:2px 6px; border-top:1px solid #f0f0f0; text-align:center;"><input type="checkbox"'+(b.rev?' checked':'')+' onclick="ac2ToggleRev('+b._i+',this)" title="Marcar/desmarcar revisada"/></td>';
  // Acciones por fila: + (agrega debajo COPIANDO la tipología), ⎘ (duplicar), ✕.
  h+='<td style="padding:2px 6px; border-top:1px solid #f0f0f0; white-space:nowrap;">'+
     '<span title="Agregar barra '+ac2Esc(b.tipo)+' debajo (copia la tipología)" style="color:#00695c; cursor:pointer; font-weight:700; margin-right:6px;">＋</span>'+
     '<span title="Duplicar" style="color:#1565c0; cursor:pointer; margin-right:6px;">⎘</span>'+
     '<span title="Quitar" style="color:#c62828; cursor:pointer;">✕</span></td></tr>';
  return h;
}

function ac2GrupoHdr(tipo, cnt){
  // cols = masiva(0/1) + Piso + [Tipo] + φ+Cant+Largo+Peso+Figura(5) + [Dibujo] + 9 lados
  //        + 4 áng + R + Rev + acciones.
  var cols = (AC2.masiva?1:0) + 1 + (AC2.tipo==='TODOS'?1:0) + 5 + (AC2.render?1:0) + 9 + 4 + 1 + 1 + 1;
  return '<tr style="background:#eef2f3;"><td colspan="'+cols+'" style="padding:3px 8px; border-top:1px solid #ddd; font-weight:700; color:#37474f;">'+
    (AC2.masiva?'<input type="checkbox" class="ac2grp" data-grp="'+ac2Esc(tipo)+'" onclick="ac2SelGrupo(this)" style="vertical-align:middle; margin-right:6px;" title="Marcar/desmarcar todo el grupo '+ac2Esc(tipo)+'"/>':'')+
    '▎'+ac2Esc(tipo)+' · '+cnt+' barra'+(cnt>1?'s':'')+'</td></tr>';
}

window.ac2Render=function(){
  var cont=document.getElementById('ac2_grid'); if(!cont) return;
  AC2.render=document.getElementById('ac2_render').checked;
  var arr=ac2Visibles();
  var agrupar=((AC2.tipo==='TODOS' && AC2.orden==='tipo') || AC2.masiva);
  var html='<table style="width:100%; min-width:1150px; font-size:11px; border-collapse:collapse; white-space:nowrap;"><thead>'+ac2Thead()+'</thead><tbody>';
  if (agrupar) {
    var actual=null;
    arr.forEach(function(b){ if(b.tipo!==actual){ actual=b.tipo; html+=ac2GrupoHdr(actual, arr.filter(function(x){return x.tipo===actual;}).length); } html+=ac2Fila(b); });
  } else arr.forEach(function(b){ html+=ac2Fila(b); });
  html+='</tbody></table>';
  cont.innerHTML=html;
  // Rollup + contador de revisadas (sobre las visibles).
  var rev=arr.filter(function(b){return b.rev;}).length;
  var uds=arr.reduce(function(s,b){return s+(b.cant||0);},0);
  var kg=arr.reduce(function(s,b){return s+(b.peso||0);},0);
  document.getElementById('ac2_revcount').textContent='✓ '+rev+' de '+arr.length+' revisadas';
  document.getElementById('ac2_rollup').innerHTML='<b style="color:#37474f;">'+arr.length+'</b> barras · <b style="color:#37474f;">'+ac2Num(uds)+'</b> uds · <b style="color:#00695c;">'+ac2Num(kg,1)+'</b> kg';
  document.getElementById('ac2_ctx').innerHTML='contexto: <b>ELEV · MURO'+(AC2.tipo!=='TODOS'?' · '+AC2.tipo:'')+'</b> · Eje <b>24(A-E)</b>';
};

window.ac2SetTipo=function(t){
  AC2.tipo=t;
  AC2_TIPOS.concat(['TODOS']).forEach(function(x){ var b=document.getElementById('ac2t_'+x); if(b) b.className='ac2tab'+(x===t?' on':''); });
  // El orden Piso/Tipología solo aplica en TODOS.
  document.getElementById('ac2_ordenWrap').style.display=(t==='TODOS')?'inline-flex':'none';
  ac2Render();
};
window.ac2SetOrden=function(o){ AC2.orden=o;
  ['piso','tipo'].forEach(function(x){ var b=document.getElementById('ac2o_'+x); if(b){var on=(o===x); b.style.background=on?'#00695c':'#fff'; b.style.color=on?'#fff':'#00695c';} });
  ac2Render(); };
window.ac2ToggleMasiva=function(){ AC2.masiva=!AC2.masiva;
  var b=document.getElementById('ac2_masivaBtn'); b.style.background=AC2.masiva?'#2e7d32':'#fff'; b.style.color=AC2.masiva?'#fff':'#00695c'; b.style.borderColor=AC2.masiva?'#2e7d32':'#00695c';
  document.getElementById('ac2_masivaBar').style.display=AC2.masiva?'flex':'none';
  ac2Render(); };
window.ac2SetTam=function(t){ AC2.tam=t;
  ['s','m','l'].forEach(function(x){ var b=document.getElementById('ac2r_'+x); if(b){var on=(t===x); b.style.background=on?'#00695c':'#fff'; b.style.color=on?'#fff':'#607d8b';} });
  ac2Render(); };
window.ac2ToggleRev=function(i,el){
  // Revisión de a 1 (proceso real): guarda el nuevo estado en el dato para que se
  // pueda MARCAR y también DESMARCAR (antes no persistía y "volvía" al re-render).
  if (AC2.barras[i]) AC2.barras[i].rev = el.checked;
  ac2Render();
};
// Check MAESTRO del grupo: marca/desmarca todas las filas de esa tipología.
window.ac2SelGrupo=function(el){
  var grp=el.getAttribute('data-grp'), on=el.checked;
  document.querySelectorAll('.ac2sel[data-grp="'+grp+'"]').forEach(function(c){ c.checked=on; });
  el.indeterminate=false;
  ac2SelResumen();
};
// Al marcar UNA fila: sincroniza el maestro de su grupo (checked / indeterminate).
window.ac2SelFila=function(){
  document.querySelectorAll('.ac2grp').forEach(function(m){
    var grp=m.getAttribute('data-grp');
    var hijos=[].slice.call(document.querySelectorAll('.ac2sel[data-grp="'+grp+'"]'));
    var marc=hijos.filter(function(c){return c.checked;}).length;
    m.checked=(marc>0 && marc===hijos.length);
    m.indeterminate=(marc>0 && marc<hijos.length);
  });
  ac2SelResumen();
};
// Contador de seleccionadas en la barra de acciones masivas.
function ac2SelResumen(){
  var s=document.getElementById('ac2_selcount'); if(!s) return;
  var nsel=document.querySelectorAll('.ac2sel:checked').length;
  s.textContent = nsel? (nsel+' seleccionada'+(nsel>1?'s':'')) : 'ninguna seleccionada';
}
window.ac2ToggleTerminado=function(){
  AC2.terminado=!AC2.terminado;
  var b=document.getElementById('ac2_bandera'), badge=document.getElementById('ac2_estadoBadge');
  if (AC2.terminado){ b.textContent='🏁'; b.style.background='#e8f5e9'; b.style.color='#2e7d32'; b.style.borderColor='#a5d6a7';
    badge.textContent='Lote #128 · 🔒 Terminado'; badge.style.background='#e8f5e9'; badge.style.color='#2e7d32'; badge.style.borderColor='#a5d6a7'; }
  else { b.textContent='🚩'; b.style.background='#ffebee'; b.style.color='#c62828'; b.style.borderColor='#ef9a9a';
    badge.textContent='Lote #128 · En edición'; badge.style.background='#fff3e0'; badge.style.color='#e65100'; badge.style.borderColor='#ffb74d'; }
};
window.ac2EliminarLote=function(){
  var t=prompt('Esto BORRA el lote #128 y TODAS sus barras.\n\nEscribe ELIMINAR para confirmar:');
  if (t==='ELIMINAR') alert('(maqueta) El lote se eliminaría aquí.');
  else if (t!=null) alert('Cancelado: debes escribir exactamente ELIMINAR.');
};
window.ac2TogglePisos=function(){
  var m=document.getElementById('ac2_pisosMenu'); if(!m) return;
  m.style.display=(m.style.display==='none')?'block':'none';
};
// ＋ barras M: una barra por cada piso seleccionado, con SU piso y la tipología activa.
window.ac2AgregarBarrasMulti=function(){
  var pisos=[].slice.call(document.querySelectorAll('.ac2piso:checked')).map(function(c){return c.value;});
  if(!pisos.length){ alert('Selecciona al menos un piso en “⚙ Pisos múltiples”.'); return; }
  // Tipología nueva = la del subtab activo; en TODOS, MH por defecto (editable por fila).
  var tipo=(AC2.tipo==='TODOS')?'MH':AC2.tipo;
  pisos.forEach(function(p){
    AC2.barras.push({ piso:p, tipo:tipo, diam:16, cant:0, largo:0, peso:0, fig:'', dims:[], r:null, rev:false, invalida:false });
  });
  ac2Render();
};
window.ac2Descartar=function(){
  // Descartar lo NO guardado (distinto de eliminar un lote ya guardado).
  if (confirm('Se descartará todo lo que no hayas guardado.\n\n¿Continuar?')) alert('(maqueta) Se descartaría el formulario.');
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXTO REAL (5N.20 sub-paso 1) — Obra·Ciclo·Eje desde /filters.
// El estado vive en AC2.{proyecto,ciclo,eje}; los comboboxes solo lo escriben.
// ─────────────────────────────────────────────────────────────────────────────
var _ac2ObrasCache = [];    // [{id, label, sub}] para el combobox de obra
var _ac2CiclosObra = [];    // [{id, label}] ciclos de la obra elegida (texto libre)
var _ac2EjesObra = [];      // [{id, label}] ejes de la obra elegida (texto libre)
var _ac2CbObra=null, _ac2CbCiclo=null, _ac2CbEje=null;

// Carga la lista de obras (GET /api/v1/filters → {proyectos:[{id,nombre}]}).
async function _ac2CargarObras(){
  try {
    var d = await apiGet('/filters');
    _ac2ObrasCache = ((d && d.proyectos) || []).map(function(p){
      return { id:String(p.id), label:String(p.nombre==null?p.id:p.nombre), sub:String(p.id) };
    });
  } catch(e){ _ac2ObrasCache = []; }
  if (_ac2CbObra) _ac2CbObra.refrescar();
}

// Carga el contexto de la obra (GET /api/v1/filters?proyecto=X → {ciclos:[str], ejes:[str]}).
async function _ac2CargarContexto(idProyecto){
  try {
    var d = await apiGet('/filters?proyecto=' + encodeURIComponent(idProyecto));
    _ac2CiclosObra = ((d && d.ciclos) || []).map(function(v){ return { id:String(v), label:String(v) }; });
    _ac2EjesObra   = ((d && d.ejes)   || []).map(function(v){ return { id:String(v), label:String(v) }; });
  } catch(e){ _ac2CiclosObra = []; _ac2EjesObra = []; }
  if (_ac2CbCiclo) _ac2CbCiclo.refrescar();
  if (_ac2CbEje)   _ac2CbEje.refrescar();
}

function _ac2InitComboboxes(){
  if (!window.Combobox) return;   // combobox.js aún no cargó
  var iO=document.getElementById('ac2_obra'),
      iC=document.getElementById('ac2_ciclo'),
      iE=document.getElementById('ac2_eje');
  // Obra: resuelve a id. Al elegir → guarda id en el estado y dispara la carga de contexto.
  if (iO && !_ac2CbObra){
    _ac2CbObra = Combobox.crear(iO, {
      items: function(){ return _ac2ObrasCache; },
      getSub: function(it){ return it.sub; },
      placeholder: '🔍 buscar obra…',
      onSelect: function(it){
        AC2.proyecto = it ? it.id : null;
        // Al cambiar de obra, el ciclo/eje elegidos dejan de aplicar → limpiar estado.
        AC2.ciclo=''; AC2.eje='';
        if (_ac2CbCiclo) _ac2CbCiclo.limpiar();
        if (_ac2CbEje)   _ac2CbEje.limpiar();
        _ac2CiclosObra=[]; _ac2EjesObra=[];
        if (AC2.proyecto) _ac2CargarContexto(AC2.proyecto);
      }
    });
  }
  // Ciclo: texto libre (se puede escribir uno nuevo o elegir uno existente de la obra).
  if (iC && !_ac2CbCiclo){
    _ac2CbCiclo = Combobox.crear(iC, {
      items: function(){ return _ac2CiclosObra; },
      textoLibre: true,
      placeholder: '🔍 buscar o escribir ciclo…',
      onSelect: function(it){ AC2.ciclo = it ? it.id : (_ac2CbCiclo ? _ac2CbCiclo.getTexto().trim() : ''); }
    });
  }
  // Eje/Losa: texto libre (el cubicador puede crear un eje nuevo).
  if (iE && !_ac2CbEje){
    _ac2CbEje = Combobox.crear(iE, {
      items: function(){ return _ac2EjesObra; },
      textoLibre: true,
      placeholder: '🔍 buscar o escribir eje…',
      onSelect: function(it){ AC2.eje = it ? it.id : (_ac2CbEje ? _ac2CbEje.getTexto().trim() : ''); }
    });
  }
}

// Loader del tab (registrado en shell.js tabLoaders['agregar2']): se llama al ACTIVAR el
// tab (clic o restauración tras F5). Refresca la lista de obras real. Idempotente.
async function loadAgregarCubicacion2(){
  if(!document.getElementById('ac2_grid')) return;
  _ac2InitComboboxes();
  ac2SetTipo('TODOS');
  await _ac2CargarObras();
}
window.loadAgregarCubicacion2 = loadAgregarCubicacion2;

// Init al cargar el módulo (el markup ya está en el DOM por el {% include %}). El loader
// del tab vuelve a correr al activarlo; ambas rutas son idempotentes.
function _ac2Init(){ if(document.getElementById('ac2_grid')){ _ac2InitComboboxes(); ac2SetTipo('TODOS'); _ac2CargarObras(); } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _ac2Init);
else _ac2Init();
