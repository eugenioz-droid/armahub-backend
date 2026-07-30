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
  barras: []   // vacío: se llena al agregar barras (＋ barra / ＋ barras M) o al cargar un lote
};
var AC2_LADOS=['A','B','C','D','E','F','G','H','I'];
var AC2_TIPOS=['MH','MV','TR','EC','TC','CB'];       // valores de `marca` (subtabs de tipología)
var AC2_ORD_TIPO={MH:0,MV:1,TR:2,EC:3,TC:4,CB:5};
var AC2_TAM={ s:{w:54,h:36}, m:{w:90,h:60}, l:{w:135,h:90} };   // S · M (~+66%) · L (+50% sobre M)
var AC2_DIAMS=[8,10,12,16,18,22,25,28,32,36];        // diámetros estándar (diametros.py)
var AC2_DIMKEYS=['dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i'];

// Catálogo de figuras (GET /figuras-catalogo). _ac2Figuras[codigo] = {parciales,angulos,radio,geometria}.
var _ac2Figuras = {};
var _ac2Seq = 1;   // correlativo para _id estable de cada barra (handlers/id de fila)

// Crea una barra NUEVA con el shape del backend (dim_a..i, marca, etc.). En un subtab la barra
// nace con esa tipología; en TODOS nace SIN marca (el cubicador la elige en el selector de la
// columna Tipología) — según diseño: en TODOS la barra nueva NO tiene tipología fija.
function ac2NuevaBarra(over){
  var b = { _id: _ac2Seq++, piso:'', marca:(AC2.tipo==='TODOS'?'':AC2.tipo),
            diam:null, cant:1, mult:1, figura:'',
            dim_a:null,dim_b:null,dim_c:null,dim_d:null,dim_e:null,dim_f:null,dim_g:null,dim_h:null,dim_i:null,
            ang1:null,ang2:null,ang3:null,ang4:null, radio:null,
            rev:false, _invalida:false };
  if (over) for (var k in over) b[k]=over[k];
  return b;
}

// Qué slots pide una figura del catálogo (dims parciales, nº de ángulos, si usa radio).
// Portado de _acDimsDeFigura del v1. Si la figura no está en el catálogo → nada habilitado.
function ac2DimsDeFigura(codigo){
  var f = _ac2Figuras[codigo];
  if (!f) return { dims:[], angs:0, radio:false };
  var dims = (f.parciales||[]).map(function(L){ return 'dim_'+String(L).toLowerCase(); });
  return { dims:dims, angs:(f.angulos||[]).length, radio:!!f.radio };
}

function ac2Esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function ac2Num(v,d){ if(v==null||v===''||isNaN(v)) return ''; return d? Number(v).toFixed(d): Math.round(Number(v)); }
// Render de la mini-figura desde la geometría REAL del catálogo (_ac2Figuras[cod].geometria).
// El escalado a las medidas reales (dims) llega en el sub-paso 3; aquí ya usa la geometría real.
function ac2FigSvg(b){
  var t=AC2_TAM[AC2.tam];
  var f = _ac2Figuras[b.figura];
  var geo = f && f.geometria;
  if (geo && window.disenadorMotor && window.disenadorMotor.dibujarFigura) {
    try { return '<span style="display:inline-block; vertical-align:middle;">' +
      window.disenadorMotor.dibujarFigura(geo, null, { width:t.w, height:t.h, pad:6 }) + '</span>'; }
    catch(e){}
  }
  // Fallback si no hay geometría o el motor no cargó: caja con el tamaño (muestra el código).
  return '<span style="display:inline-block; width:'+t.w+'px; height:'+t.h+'px; border:1px dashed #cfd8dc; border-radius:3px; vertical-align:middle; text-align:center; line-height:'+t.h+'px; color:#bbb; font-size:9px;">'+ac2Esc(b.figura||'▱')+'</span>';
}

// Orden de marca para agrupar (las conocidas primero en su orden; el resto al final alfabético).
function ac2OrdMarca(m){ return (m in AC2_ORD_TIPO) ? AC2_ORD_TIPO[m] : 90; }
function ac2Visibles(){
  var arr = AC2.barras.filter(function(b){ return AC2.tipo==='TODOS' || b.marca===AC2.tipo; });
  var porTipo = (AC2.tipo==='TODOS' && AC2.orden==='tipo') || AC2.masiva;
  arr.sort(function(a,b){ return porTipo
    ? ((ac2OrdMarca(a.marca)-ac2OrdMarca(b.marca)) || String(a.piso).localeCompare(String(b.piso)))
    : (String(a.piso).localeCompare(String(b.piso)) || (ac2OrdMarca(a.marca)-ac2OrdMarca(b.marca))); });
  return arr;
}
function ac2BarraPorId(id){ for(var i=0;i<AC2.barras.length;i++){ if(AC2.barras[i]._id===id) return AC2.barras[i]; } return null; }

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

// Estilos de celda reutilizables.
var AC2_TDS='padding:2px 5px; border-top:1px solid #f0f0f0;';
// input numérico editable en celda; onchange muta el dato (sin re-render, salvo figura).
function ac2Inp(id, campo, val, w){
  return '<input type="number" value="'+(val==null?'':ac2Esc(val))+'" '+
    'onchange="ac2SetBarra('+id+',\''+campo+'\',this.value)" '+
    'style="width:'+(w||46)+'px; font-size:11px; text-align:right; padding:1px 3px; border:1px solid #dfe6e9; border-radius:3px;"/>';
}
// celda deshabilitada (la figura no usa ese slot).
function ac2CeldaOff(){ return '<td style="'+AC2_TDS+' background:#fafafa;"></td>'; }

function ac2Fila(b){
  var mostrarTipo=(AC2.tipo==='TODOS');
  var info = b.figura ? ac2DimsDeFigura(b.figura) : {dims:[],angs:0,radio:false};
  var td='<td style="'+AC2_TDS+'">';
  var tdr='<td style="'+AC2_TDS+' text-align:right;">';
  var h='<tr id="ac2row_'+b._id+'"'+(b._invalida?' title="Geometría inválida para la figura"':'')+'>';
  if (AC2.masiva) h+='<td style="'+AC2_TDS+' text-align:center;"><input type="checkbox" class="ac2sel" data-grp="'+ac2Esc(b.marca)+'" onclick="ac2SelFila()"/></td>';
  // Piso (texto libre editable).
  h+='<td style="'+AC2_TDS+'"><input type="text" value="'+ac2Esc(b.piso)+'" onchange="ac2SetBarra('+b._id+',\'piso\',this.value)" style="width:44px; font-size:11px; padding:1px 3px; border:1px solid #dfe6e9; border-radius:3px;"/></td>';
  // Tipología (marca) — select solo en TODOS; en un subtab está implícita. Opción vacía para
  // barras nuevas sin tipología aún (en TODOS nacen sin marca; el cubicador la elige acá).
  if (mostrarTipo){
    var op='<option value=""'+(b.marca?'':' selected')+'>— tipo —</option>'+
      AC2_TIPOS.map(function(m){return '<option'+(m===b.marca?' selected':'')+'>'+m+'</option>';}).join('');
    h+='<td style="'+AC2_TDS+'"><select onchange="ac2SetBarra('+b._id+',\'marca\',this.value)" style="font-size:11px; padding:1px 2px;">'+op+'</select></td>';
  }
  // φ (diámetro) — select de lista fija.
  var opd='<option value=""></option>'+AC2_DIAMS.map(function(d){return '<option'+(Number(b.diam)===d?' selected':'')+'>'+d+'</option>';}).join('');
  h+='<td style="'+AC2_TDS+' text-align:right;"><select onchange="ac2SetBarra('+b._id+',\'diam\',this.value)" style="font-size:11px; padding:1px 2px;">'+opd+'</select></td>';
  // Cant.
  h+='<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,'cant',b.cant,40)+'</td>';
  // Largo (calculado, sub-paso 3) — solo lectura.
  h+='<td class="ac2-largo" style="'+AC2_TDS+' text-align:right; color:#1565c0; font-weight:600;">'+ac2Num(b._largo)+'</td>';
  // Peso (calculado, sub-paso 3) — solo lectura.
  h+='<td class="ac2-peso" style="'+AC2_TDS+' padding-right:10px; text-align:right; color:#00695c; font-weight:600;">'+ac2Num(b._peso,1)+'</td>';
  // Figura (input+datalist del catálogo). Cambiarla re-renderiza SOLO la fila (cambian las dims).
  h+='<td style="'+AC2_TDS+' padding-left:14px; border-left:1px solid #eee;"><input type="text" list="ac2_figDatalist" value="'+ac2Esc(b.figura)+'" onchange="ac2SetBarra('+b._id+',\'figura\',this.value)" placeholder="fig" style="width:54px; font-size:11px; padding:1px 3px; border:1px solid #dfe6e9; border-radius:3px;"/></td>';
  if (AC2.render) h+=td+ac2FigSvg(b)+'</td>';
  // Dims A-I: input si la figura usa ese lado, celda gris si no.
  for (var i=0;i<9;i++){ var k=AC2_DIMKEYS[i];
    h+= (info.dims.indexOf(k)!==-1) ? '<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,k,b[k])+'</td>' : ac2CeldaOff();
  }
  // Ángulos α1-α4: input si la figura usa ese ángulo.
  for (var j=0;j<4;j++){ var ak='ang'+(j+1);
    h+= (j<info.angs) ? '<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,ak,b[ak],40)+'</td>' : ac2CeldaOff();
  }
  // Radio.
  h+= info.radio ? '<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,'radio',b.radio,44)+'</td>' : ac2CeldaOff();
  // Rev (revisada).
  h+='<td style="'+AC2_TDS+' text-align:center;"><input type="checkbox"'+(b.rev?' checked':'')+' onclick="ac2ToggleRev('+b._id+',this)" title="Marcar/desmarcar revisada"/></td>';
  // Acciones por fila.
  h+='<td style="'+AC2_TDS+' white-space:nowrap;">'+
     '<span onclick="ac2CopiarTipologia('+b._id+')" title="Agregar barra '+ac2Esc(b.marca)+' debajo" style="color:#00695c; cursor:pointer; font-weight:700; margin-right:6px;">＋</span>'+
     '<span onclick="ac2Duplicar('+b._id+')" title="Duplicar" style="color:#1565c0; cursor:pointer; margin-right:6px;">⎘</span>'+
     '<span onclick="ac2Quitar('+b._id+')" title="Quitar" style="color:#c62828; cursor:pointer;">✕</span></td></tr>';
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
  var renderEl=document.getElementById('ac2_render'); if(renderEl) AC2.render=renderEl.checked;
  var arr=ac2Visibles();
  // EMPTY STATE: sin barras aún, mostrar un mensaje según haya obra elegida o no.
  if (!arr.length) {
    var msg = AC2.proyecto
      ? 'Aún no has agregado barras. Usa <b>＋ barra</b> o <b>＋ barras M</b> para empezar.'
      : 'Elige una <b>obra</b> arriba para empezar a cubicar.';
    cont.innerHTML='<div style="padding:26px 16px; text-align:center; color:#90a4ae; font-size:13px;">'+msg+'</div>';
    var rc=document.getElementById('ac2_revcount'); if(rc) rc.textContent='';
    var ro=document.getElementById('ac2_rollup'); if(ro) ro.innerHTML='';
    var cx=document.getElementById('ac2_ctx'); if(cx) cx.innerHTML=ac2CtxText();
    return;
  }
  var agrupar=((AC2.tipo==='TODOS' && AC2.orden==='tipo') || AC2.masiva);
  var html='<table style="width:100%; min-width:1150px; font-size:11px; border-collapse:collapse; white-space:nowrap;"><thead>'+ac2Thead()+'</thead><tbody>';
  if (agrupar) {
    var actual=null;
    arr.forEach(function(b){ if(b.marca!==actual){ actual=b.marca; html+=ac2GrupoHdr(actual, arr.filter(function(x){return x.marca===actual;}).length); } html+=ac2Fila(b); });
  } else arr.forEach(function(b){ html+=ac2Fila(b); });
  html+='</tbody></table>';
  cont.innerHTML=html;
  // Rollup + contador de revisadas (sobre las visibles). Peso = calculado (sub-paso 3).
  var rev=arr.filter(function(b){return b.rev;}).length;
  var uds=arr.reduce(function(s,b){return s+(Number(b.cant)||0);},0);
  var kg=arr.reduce(function(s,b){return s+(Number(b._peso)||0);},0);
  document.getElementById('ac2_revcount').textContent='✓ '+rev+' de '+arr.length+' revisadas';
  document.getElementById('ac2_rollup').innerHTML='<b style="color:#37474f;">'+arr.length+'</b> barras · <b style="color:#37474f;">'+ac2Num(uds)+'</b> uds · <b style="color:#00695c;">'+ac2Num(kg,1)+'</b> kg';
  document.getElementById('ac2_ctx').innerHTML=ac2CtxText();
};

// Texto de contexto REAL (obra/ciclo/eje/tipología elegidos), sin datos hardcodeados.
function ac2CtxText(){
  var obra = AC2.proyecto ? ('Obra '+ac2Esc(AC2.proyecto)) : '—';
  var partes=[obra];
  if (AC2.ciclo) partes.push('Ciclo '+ac2Esc(AC2.ciclo));
  if (AC2.eje)   partes.push('Eje '+ac2Esc(AC2.eje));
  if (AC2.tipo && AC2.tipo!=='TODOS') partes.push(ac2Esc(AC2.tipo));
  return 'contexto: <b>'+partes.join(' · ')+'</b>';
}

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
window.ac2ToggleRev=function(id,el){
  // Revisión de a 1 (proceso real): guarda el estado en el dato (marca/desmarca). No re-render
  // completo (el checkbox ya refleja el valor); solo refresca el contador de revisadas.
  var b=ac2BarraPorId(id); if(b) b.rev=el.checked;
  ac2ActualizarContadores();
};

// ── Edición de celda: muta el dato. Sin re-render (el input ya muestra el valor). Solo la
//    FIGURA re-renderiza su fila (cambian qué dims pide). Casting numérico donde aplica. ──
var AC2_CAMPOS_NUM={diam:1,cant:1,mult:1,radio:1,ang1:1,ang2:1,ang3:1,ang4:1,
  dim_a:1,dim_b:1,dim_c:1,dim_d:1,dim_e:1,dim_f:1,dim_g:1,dim_h:1,dim_i:1};
window.ac2SetBarra=function(id,campo,valor){
  var b=ac2BarraPorId(id); if(!b) return;
  if (campo in AC2_CAMPOS_NUM){ var s=String(valor).trim(); b[campo]=(s===''?null:Number(s)); }
  else b[campo]=valor;
  if (campo==='figura'){ ac2ReRenderFila(id); }          // cambian las dims → re-pinta la fila
  // Elegir la tipología en TODOS puede cambiar la agrupación/orden → re-render completo.
  else if (campo==='marca'){ var agrupa=((AC2.tipo==='TODOS' && AC2.orden==='tipo')||AC2.masiva); if(agrupa){ ac2Render(); return; } }
  ac2ActualizarContadores();                              // cant/rev afectan el rollup
};

// Re-render GRANULAR: reemplaza SOLO el <tr> de esa barra (no toda la tabla).
function ac2ReRenderFila(id){
  var b=ac2BarraPorId(id); if(!b) return;
  var tr=document.getElementById('ac2row_'+id);
  if (tr) tr.outerHTML=ac2Fila(b);
}
// Refresca contador de revisadas + rollup sin reconstruir la tabla.
function ac2ActualizarContadores(){
  var arr=ac2Visibles();
  var rev=arr.filter(function(b){return b.rev;}).length;
  var uds=arr.reduce(function(s,b){return s+(Number(b.cant)||0);},0);
  var kg=arr.reduce(function(s,b){return s+(Number(b._peso)||0);},0);
  var rc=document.getElementById('ac2_revcount'); if(rc) rc.textContent=arr.length?('✓ '+rev+' de '+arr.length+' revisadas'):'';
  var ro=document.getElementById('ac2_rollup'); if(ro) ro.innerHTML=arr.length?('<b style="color:#37474f;">'+arr.length+'</b> barras · <b style="color:#37474f;">'+ac2Num(uds)+'</b> uds · <b style="color:#00695c;">'+ac2Num(kg,1)+'</b> kg'):'';
}

// ── Agregar / copiar / duplicar / quitar barras (cambios estructurales → re-render completo) ──
window.ac2AgregarBarra=function(){
  if (!AC2.proyecto){ alert('Elige primero una obra.'); return; }
  AC2.barras.push(ac2NuevaBarra({ piso:'' }));
  ac2Render();
};
window.ac2CopiarTipologia=function(id){
  var b=ac2BarraPorId(id); if(!b) return;
  var idx=AC2.barras.indexOf(b);
  AC2.barras.splice(idx+1,0, ac2NuevaBarra({ marca:b.marca, piso:b.piso }));
  ac2Render();
};
window.ac2Duplicar=function(id){
  var b=ac2BarraPorId(id); if(!b) return;
  var copia=JSON.parse(JSON.stringify(b)); copia._id=_ac2Seq++; copia.rev=false;
  AC2.barras.splice(AC2.barras.indexOf(b)+1,0, copia);
  ac2Render();
};
window.ac2Quitar=function(id){
  AC2.barras=AC2.barras.filter(function(x){return x._id!==id;});
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
  // (El guardado/terminado real del lote se cablea en el sub-paso 5.) Por ahora solo refleja
  // el estado visual del formulario en curso, sin número de lote inventado.
  AC2.terminado=!AC2.terminado;
  var b=document.getElementById('ac2_bandera'), badge=document.getElementById('ac2_estadoBadge');
  if (AC2.terminado){ b.textContent='🏁'; b.style.background='#e8f5e9'; b.style.color='#2e7d32'; b.style.borderColor='#a5d6a7';
    badge.textContent='🔒 Terminado'; badge.style.background='#e8f5e9'; badge.style.color='#2e7d32'; badge.style.borderColor='#a5d6a7'; }
  else { b.textContent='🚩'; b.style.background='#ffebee'; b.style.color='#c62828'; b.style.borderColor='#ef9a9a';
    badge.textContent=AC2.barras.length?'En edición':'Nuevo lote · sin barras'; badge.style.background='#fff3e0'; badge.style.color='#e65100'; badge.style.borderColor='#ffb74d'; }
};
window.ac2TogglePisos=function(){
  var m=document.getElementById('ac2_pisosMenu'); if(!m) return;
  m.style.display=(m.style.display==='none')?'block':'none';
};
// ＋ barras M: una barra por cada piso seleccionado, con SU piso y la tipología activa.
// Los pisos vienen de la CONFIG de pisos de la obra (tarea aparte, aún no disponible).
window.ac2AgregarBarrasMulti=function(){
  if (!AC2.proyecto){ alert('Elige primero una obra.'); return; }
  var pisos=[].slice.call(document.querySelectorAll('.ac2piso:checked')).map(function(c){return c.value;});
  if(!pisos.length){ alert('Aún no hay pisos configurados para esta obra.\nLa configuración de pisos es una tarea pendiente.'); return; }
  pisos.forEach(function(p){ AC2.barras.push(ac2NuevaBarra({ piso:p })); });
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
var _ac2CiclosObra = [];    // [{id, label}] ciclos de la obra elegida (texto libre)
var _ac2EjesObra = [];      // [{id, label}] ejes de la obra elegida (texto libre)
var _ac2CbObra=null, _ac2CbCiclo=null, _ac2CbEje=null;

// Carga la lista de obras (GET /api/v1/filters → {proyectos:[{id,nombre}]}) y la pasa al
// COMPONENTE buscador de obra (el mismo del Bar Manager).
async function _ac2CargarObras(){
  var proyectos = [];
  try {
    var d = await apiGet('/filters');
    proyectos = (d && d.proyectos) || [];
  } catch(e){ proyectos = []; }
  if (_ac2CbObra) _ac2CbObra.setProyectos(proyectos);
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
  var iC=document.getElementById('ac2_ciclo'),
      iE=document.getElementById('ac2_eje');
  // Obra: MISMO componente que el Bar Manager (shared/buscador_obra.js). Al elegir → guarda
  // el id en el estado y dispara la carga de contexto (ciclos/ejes de esa obra).
  if (document.getElementById('ac2_obra') && !_ac2CbObra && window.BuscadorObra){
    _ac2CbObra = window.BuscadorObra.crear({
      inputId:'ac2_obra', datalistId:'ac2_obraDatalist', selectId:'ac2_obraSel',
      onElegir: function(idProyecto){
        AC2.proyecto = idProyecto || null;
        // Al cambiar de obra, el ciclo/eje elegidos dejan de aplicar → limpiar estado.
        AC2.ciclo=''; AC2.eje='';
        if (_ac2CbCiclo) _ac2CbCiclo.limpiar();
        if (_ac2CbEje)   _ac2CbEje.limpiar();
        _ac2CiclosObra=[]; _ac2EjesObra=[];
        if (AC2.proyecto) _ac2CargarContexto(AC2.proyecto);
      }
    });
  }
  if (!window.Combobox) return;   // combobox.js aún no cargó (ciclo/eje lo usan)
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

// Catálogo de figuras (GET /figuras-catalogo). Cachea _ac2Figuras[codigo] = {parciales,
// angulos, radio, geometria} y puebla el <datalist id=ac2_figDatalist> de la grilla. Una vez.
async function _ac2CargarFiguras(){
  if (Object.keys(_ac2Figuras).length) return;   // ya cargadas
  var figs=[];
  try { var d=await apiGet('/figuras-catalogo'); figs=(d && d.figuras)||[]; } catch(e){ figs=[]; }
  figs.forEach(function(f){ if(f && f.codigo) _ac2Figuras[f.codigo]=f; });
  var dl=document.getElementById('ac2_figDatalist');
  if (dl) dl.innerHTML=figs.map(function(f){ return '<option value="'+ac2Esc(f.codigo)+'"></option>'; }).join('');
}

// Loader del tab (registrado en shell.js tabLoaders['agregar2']): se llama al ACTIVAR el
// tab (clic o restauración tras F5). Refresca la lista de obras real. Idempotente.
async function loadAgregarCubicacion2(){
  if(!document.getElementById('ac2_grid')) return;
  _ac2InitComboboxes();
  await _ac2CargarFiguras();
  await _ac2CargarObras();
  ac2SetTipo(AC2.tipo || 'TODOS');   // re-sincroniza subtabs + re-pinta el grid al (re)entrar
}
window.loadAgregarCubicacion2 = loadAgregarCubicacion2;

// Init al cargar el módulo (el markup ya está en el DOM por el {% include %}). El loader
// del tab vuelve a correr al activarlo; ambas rutas son idempotentes.
function _ac2Init(){ if(document.getElementById('ac2_grid')){ _ac2InitComboboxes(); ac2SetTipo('TODOS'); _ac2CargarObras(); } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _ac2Init);
else _ac2Init();
