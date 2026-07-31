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
  seleccion:{},    // { _id: true } — barras marcadas en modo masivo. Estado JS (NO en el DOM):
                   // así sobrevive a los re-renders de fila (antes se perdía → bug masivo).
  // Contexto real (vive en JS, no en el DOM):
  proyecto:null,   // id de la obra elegida (GET /filters → proyectos[].id)
  ciclo:'',        // ciclo elegido/escrito (texto libre)
  eje:'',          // eje/losa elegido/escrito (texto libre)
  sector:'',       // sector constructivo elegido (FUND/ELEV/VCIELO/LCIELO)
  estructura:'',   // estructura elegida (MURO/LOSA/VIGA/COLUMNA/FUNDACION/GENERAL)
  loteId:null,     // id del lote en curso (null = aún no creado; se crea al primer guardado)
  loteEstado:'',   // '' | 'borrador' | 'terminada'
  // 5N.20 sub-paso 1: la "tipología" (subtab MH/MV/TR/EC/TC/CB) ES el campo `marca` de la
  // barra (decisión de producto CERRADA). AC2.tipo = valor de `marca` que se asignará a las
  // barras nuevas. NO es un campo nuevo; el guardado (sub-paso siguiente) estampará marca=tipo.
  barras: []   // vacío: se llena al agregar barras (＋ barra / ＋ barras M) o al cargar un lote
};
var AC2_LADOS=['A','B','C','D','E','F','G','H','I'];
// Sectores constructivos (enum fijo, orden canónico de barras.py) — sin endpoint.
var AC2_SECTORES=['ELEV','LCIELO','VCIELO','FUND'];
// Estructuras y sus tipologías: se cargan de GET /tipologias (agrupado por estructura). Cada
// tipología trae sus `figuras`. AC2_TIPOS_MAP[estructura]=[{codigo,nombre,figuras}]. Fallback
// mínimo (catálogo _TIPOLOGIAS_SEED) por si la API no responde; 'GEN' = estructura GENERAL.
var AC2_ESTRUCTURAS=['MURO','LOSA','VIGA','COLUMNA','FUNDACION','GEN'];
var AC2_TIPOS_MAP={
  MURO:[{codigo:'MH'},{codigo:'MV'},{codigo:'TR'},{codigo:'EC'},{codigo:'TC'},{codigo:'CB'}],
  LOSA:[{codigo:'Fi'},{codigo:'Fs'},{codigo:"F'i"},{codigo:"F's"},{codigo:'F'},{codigo:"F'"},{codigo:'SP'},{codigo:'Rp'},{codigo:'TRL'}],
  VIGA:[{codigo:'CBS'},{codigo:'CBS2'},{codigo:'CBSn'},{codigo:'CBI'},{codigo:'CBI2'},{codigo:'CBIn'},{codigo:'LT'},{codigo:'ES'},{codigo:'TRV'}],
  COLUMNA:[{codigo:'CB'},{codigo:'CB2'},{codigo:'CBn'},{codigo:'TRC'},{codigo:'ESC'}],
  FUNDACION:[{codigo:'Fi'},{codigo:'Fs'},{codigo:"F'i"},{codigo:"F's"},{codigo:'SPF'},{codigo:'TRF'}],
  GEN:[{codigo:'CB'},{codigo:'F'},{codigo:"F'"}]
};
// AC2_TIPOS = códigos de tipología de la estructura ACTUAL (subtabs). Se recalcula al elegir
// estructura (ac2SetEstructura). AC2_ORD_TIPO deriva del orden de esa lista.
var AC2_TIPOS=AC2_TIPOS_MAP.MURO.map(function(t){return t.codigo;});
var AC2_ORD_TIPO={}; AC2_TIPOS.forEach(function(t,i){ AC2_ORD_TIPO[t]=i; });
// Tamaños del render. Se agrandaron para que las ETIQUETAS (cotas/ángulos, que salen fuera del
// contorno) quepan sin cortarse. + XL para figuras densas.
var AC2_TAM={ s:{w:70,h:52}, m:{w:110,h:80}, l:{w:160,h:118}, xl:{w:220,h:160} };
var AC2_DIAMS=[8,10,12,16,18,22,25,28,32,36];        // diámetros estándar (diametros.py)
var AC2_DIMKEYS=['dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i'];

// Catálogo de figuras (GET /figuras-catalogo). _ac2Figuras[codigo] = {parciales,angulos,radio,geometria}.
var _ac2Figuras = {};
var _ac2Seq = 1;   // correlativo para _id estable de cada barra (handlers/id de fila)
// Pisos disponibles de la obra (combinados: existentes + plantilla), para el <select> de la
// grilla y el menú "＋barras M". Se cargan al elegir obra (GET /pisos-combinados).
var _ac2Pisos = [];   // ['S2','S1','P1',...] en orden lógico (subterráneos → P1..Pn → SM)

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

// Largo por defecto de los lados EXTREMOS = 10 × diámetro, PERO en unidades coherentes: el
// diámetro está en MM y las medidas de la barra en CM. 10×φ(mm) = 10φ mm = φ cm.
// → extremo (cm) = FACTOR × diámetro(mm) / 10. Ej: φ10mm → 10cm; φ16mm → 16cm.
var AC2_FACTOR_EXTREMO=10;      // veces el diámetro
var AC2_MM_A_CM=10;             // 1 cm = 10 mm (el diámetro viene en mm; las medidas en cm)
var AC2_LARGO_INTERMEDIO=100;   // cm, estándar para lados intermedios
var AC2_MIN_LADO_REL=0.28;      // en el render, ningún lado se dibuja menor a 28% del lado más grande (evita que los chicos se pierdan)
// Valores por DEFECTO al elegir figura/diámetro (regla del cubicador, estilo ADetailer):
//  - Ángulos: los del CATÁLOGO de la figura (f.angulos), se rellenan al elegir figura.
//  - Lados EXTREMOS (1º y último parcial): AC2_FACTOR_EXTREMO × diámetro (al elegir diámetro).
//  - Lados INTERMEDIOS: AC2_LARGO_INTERMEDIO, al elegir figura.
//  - RADIO: NO se rellena (queda vacío para llenar a mano).
// Solo rellena celdas VACÍAS (no pisa lo que el usuario ya escribió).
function ac2AplicarDefaults(b, motivo){
  var f=_ac2Figuras[b.figura]; if(!f) return;
  var dims=(f.parciales||[]).map(function(L){ return 'dim_'+String(L).toLowerCase(); });
  var nExtremo=dims.length-1;   // índice del último lado
  if (motivo==='figura'){
    // Ángulos del catálogo (valores reales de la figura).
    (f.angulos||[]).forEach(function(av,i){ var k='ang'+(i+1); if(i<4 && (b[k]==null||b[k]==='')) b[k]=Number(av); });
    // Lados intermedios (ni el primero ni el último).
    dims.forEach(function(k,idx){ if(idx>0 && idx<nExtremo && (b[k]==null||b[k]==='')) b[k]=AC2_LARGO_INTERMEDIO; });
    // Si ya hay diámetro, aprovecha para llenar los extremos también.
    if (b.diam!=null) ac2RellenarExtremos(b, dims, nExtremo);
  } else if (motivo==='diam'){
    if (b.figura && b.diam!=null) ac2RellenarExtremos(b, dims, nExtremo);
  }
}
function ac2RellenarExtremos(b, dims, nExtremo){
  // 10 × φ(mm) convertido a cm = φ(mm) × 10 / 10 = φ. (φ10mm→10cm, φ16mm→16cm.)
  var v8=AC2_FACTOR_EXTREMO*Number(b.diam)/AC2_MM_A_CM;
  if (dims.length>=1 && (b[dims[0]]==null||b[dims[0]]==='')) b[dims[0]]=v8;                 // primer lado
  if (nExtremo>0 && (b[dims[nExtremo]]==null||b[dims[nExtremo]]==='')) b[dims[nExtremo]]=v8; // último lado
}

// LARGO = suma de las dims que la figura usa (el radio NO suma). null si falta alguna o no hay
// figura. Espeja _largo_desde_figura del backend (lotes.py). El backend recalcula el definitivo.
function ac2Largo(b){
  if (!b.figura || !_ac2Figuras[b.figura]) return null;
  var info=ac2DimsDeFigura(b.figura), total=0;
  for (var i=0;i<info.dims.length;i++){ var v=b[info.dims[i]]; if(v==null||isNaN(v)) return null; total+=Number(v); }
  return total;
}
// PESO = 7850·π·(φ/2000)²·(largo/100)·cant·mult. Espeja _peso_teorico del backend (sin el factor
// de obra, que el backend aplica al guardar). Preview en pantalla.
function ac2Peso(b){
  var largo=ac2Largo(b);
  if (b.diam==null || largo==null) return null;
  var pu=7850*Math.PI*(Number(b.diam)/2000)*(Number(b.diam)/2000)*(largo/100);
  return pu*((Number(b.cant)||0)*(Number(b.mult)||1));
}
// Texto de la celda de peso: el valor, o "—" con pista de qué falta (φ o dims).
function ac2PesoTxt(b){
  var p=ac2Peso(b);
  if (p!=null) return ac2Num(p,1);
  if (ac2Largo(b)!=null && b.diam==null) return '<span style="color:#e57373;" title="Elige el diámetro (φ) para calcular el peso">—</span>';
  return '';
}

// Validación de geometría contra el catálogo (espeja validar_geometria del backend, catalogo.py):
// la figura EXIGE valor en sus slots (dims parciales, N ángulos, radio) y VACÍO en el resto.
// Devuelve el SET de columnas a marcar en rojo (faltan las que exige, sobran las que no usa).
function ac2TieneVal(v){ return v!=null && v!=='' && !isNaN(v); }
function ac2Validar(b){
  var rojas={};
  if (!b.figura) return { ok:true, rojas:rojas };   // sin figura aún → no se valida
  var info=ac2DimsDeFigura(b.figura);
  // Dims A-I: usa → debe tener; no usa → debe estar vacío.
  AC2_DIMKEYS.forEach(function(k){
    var usa=info.dims.indexOf(k)!==-1, tiene=ac2TieneVal(b[k]);
    if ((usa&&!tiene)||(!usa&&tiene)) rojas[k]=1;
  });
  // Ángulos: los primeros N exigen valor; el resto vacío.
  for (var i=0;i<4;i++){ var ak='ang'+(i+1), usa=i<info.angs, tiene=ac2TieneVal(b[ak]);
    if ((usa&&!tiene)||(!usa&&tiene)) rojas[ak]=1; }
  // Radio.
  var uR=info.radio, tR=ac2TieneVal(b.radio);
  if ((uR&&!tR)||(!uR&&tR)) rojas['radio']=1;
  return { ok:Object.keys(rojas).length===0, rojas:rojas };
}

function ac2Esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function ac2Num(v,d){ if(v==null||v===''||isNaN(v)) return ''; return d? Number(v).toFixed(d): Math.round(Number(v)); }
// Render de la mini-figura desde la geometría REAL del catálogo, ESCALADA a las medidas que
// ingresó el usuario (dims {A:val,B:val,...} desde b.dim_a..i). Portado de _acMiniFigura del v1.
function ac2FigSvg(b){
  var t=AC2_TAM[AC2.tam];
  var f = _ac2Figuras[b.figura];
  var geo = f && f.geometria;
  if (geo && window.disenadorMotor && window.disenadorMotor.dibujarFigura) {
    var dims={};
    AC2_LADOS.forEach(function(L){ var v=b['dim_'+L.toLowerCase()]; if(v!=null && !isNaN(v)) dims[L]=Number(v); });
    // PARAMÉTRICO: el motor, si la geometría trae `puntos` dibujados, los usa tal cual e IGNORA
    // las medidas. Para escalar con las dims reales, si la figura tiene `tramos` (y no usa radio
    // ni etiquetas manuales) le pasamos una copia SIN `puntos` → el motor reconstruye desde
    // tramos escalando a cada lado. En figuras con radio/etiquetas manuales dejamos el dibujo
    // original (deuda 5N.27: los radios aún no tienen geometría real).
    var geoUse=geo;
    var tieneDims=Object.keys(dims).length>0;
    // Escalable = tiene tramos Y puntos dibujados (para tomar la orientación real), sin radio ni
    // etiquetas manuales (deuda 5N.27).
    var escalable=(tieneDims && geo.tramos && geo.tramos.length && geo.puntos && geo.puntos.length>=2
                   && !f.radio && !(geo.etiquetas&&geo.etiquetas.length) && !geo.etiquetas_manda);
    if (escalable){
      // PARAMÉTRICO SIN ROTAR: reconstruyo los PUNTOS conservando la DIRECCIÓN de cada segmento
      // original (de geo.puntos → mantiene la orientación de la figura dibujada) pero con la
      // LONGITUD nueva (dims). Reconstruir desde `tramos` puros rotaba la figura (siempre
      // arrancaba hacia la derecha). Así escala cada lado y no cambia la orientación.
      // LÍMITE A LADOS CHICOS: si un lado es enorme y otro diminuto, el motor escala todo al
      // viewport y el chico se pierde. Comprimimos el rango dando a cada lado un mínimo relativo
      // al lado más grande (AC2_MIN_LADO_REL). Se pierde algo de proporción realista (aceptado),
      // pero los lados chicos siguen siendo visibles.
      var largos=[];
      for (var mi=0; mi<geo.tramos.length && mi+1<geo.puntos.length; mi++){
        var dxm=geo.puntos[mi+1].x-geo.puntos[mi].x, dym=geo.puntos[mi+1].y-geo.puntos[mi].y;
        var l0=Math.sqrt(dxm*dxm+dym*dym)||1;
        var vm=dims[geo.tramos[mi].lado];
        largos.push((vm!=null && !isNaN(vm) && vm>0) ? Number(vm) : l0);
      }
      var maxLado=Math.max.apply(null, largos.concat([1]));
      var minLado=maxLado*AC2_MIN_LADO_REL;                          // piso visual por lado
      var op=geo.puntos, np=[{x:op[0].x, y:op[0].y}];
      for (var si=0; si<geo.tramos.length && si+1<op.length; si++){
        var dx=op[si+1].x-op[si].x, dy=op[si+1].y-op[si].y;
        var len0=Math.sqrt(dx*dx+dy*dy)||1;
        var lnew=Math.max(largos[si], minLado);                      // longitud nueva, no menor al piso visual
        var ux=dx/len0, uy=dy/len0;                                  // dirección unitaria original
        var last=np[np.length-1];
        np.push({ x:last.x+ux*lnew, y:last.y+uy*lnew });
      }
      geoUse={}; for(var kk in geo) geoUse[kk]=geo[kk];
      geoUse.puntos=np;                                              // puntos re-escalados, misma orientación
      // MOSTRAR EL VALOR en vez de la letra en cada lado.
      geoUse.tramos=geo.tramos.map(function(tr){
        var vv=dims[tr.lado]; var nt={}; for(var k2 in tr) nt[k2]=tr[k2];
        if (vv!=null) nt.lado=String(vv); return nt;
      });
    }
    try { return '<span style="display:inline-block; vertical-align:middle;">' +
      window.disenadorMotor.dibujarFigura(geoUse, dims, { width:t.w, height:t.h, pad:Math.round(Math.min(t.w,t.h)*0.22) }) + '</span>'; }
    catch(e){}
  }
  // Fallback si no hay geometría o el motor no cargó: caja con el tamaño (muestra el código).
  return '<span style="display:inline-block; width:'+t.w+'px; height:'+t.h+'px; border:1px dashed #cfd8dc; border-radius:3px; vertical-align:middle; text-align:center; line-height:'+t.h+'px; color:#bbb; font-size:9px;">'+ac2Esc(b.figura||'▱')+'</span>';
}

// Orden de marca para agrupar (las conocidas primero en su orden; el resto al final alfabético).
function ac2OrdMarca(m){ return (m in AC2_ORD_TIPO) ? AC2_ORD_TIPO[m] : 90; }
// Orden de piso según la plantilla de la obra (_ac2Pisos: S2,S1,P1..Pn,SM). Los que no están
// en la plantilla van al final. Respeta el orden lógico configurado, más el manual (ac2MoverGrupo).
function ac2OrdPiso(p){ var i=(_ac2PisosOrden.length?_ac2PisosOrden:_ac2Pisos).indexOf(p); return i<0?9999:i; }
var _ac2PisosOrden=[];   // orden manual de grupos de piso (flechas subir/bajar); vacío = usa _ac2Pisos

// AC2.orden ∈ 'creacion' | 'piso' | 'tipo'. Filtra por el subtab (o TODOS) y ordena/agrupa.
function ac2Visibles(){
  var arr = AC2.barras.filter(function(b){ return AC2.tipo==='TODOS' || b.marca===AC2.tipo; });
  if (AC2.orden==='creacion'){
    // Orden de CREACIÓN = el orden real en AC2.barras (por _id incremental).
    arr.sort(function(a,b){ return a._id-b._id; });
  } else if (AC2.orden==='piso'){
    arr.sort(function(a,b){ return (ac2OrdPiso(a.piso)-ac2OrdPiso(b.piso)) || (ac2OrdMarca(a.marca)-ac2OrdMarca(b.marca)) || (a._id-b._id); });
  } else { // 'tipo'
    arr.sort(function(a,b){ return (ac2OrdMarca(a.marca)-ac2OrdMarca(b.marca)) || (ac2OrdPiso(a.piso)-ac2OrdPiso(b.piso)) || (a._id-b._id); });
  }
  return arr;
}
// ¿Se agrupa la vista? (por piso o por tipología). En creación no se agrupa.
function ac2AgrupaPor(){ return (AC2.orden==='piso') ? 'piso' : (AC2.orden==='tipo' ? 'marca' : null); }
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
// input numérico editable en celda (clase .ac2cell = estilo Bar Manager). class ac2nav marca
// las celdas navegables con Tab/flechas tipo Excel (ac2NavKey). data-col/data-row para que
// ↑↓ vayan a la MISMA columna de la fila de arriba/abajo (robusto aunque las filas difieran).
function ac2Inp(id, campo, val, w, rojo){
  var wst = w ? ' style="width:'+w+'px;"' : '';
  return '<input type="number" value="'+(val==null?'':ac2Esc(val))+'" '+
    'class="ac2cell ac2nav'+(rojo?' rojo':'')+'" data-col="'+campo+'" data-row="'+id+'"'+wst+' '+
    'onchange="ac2SetBarra('+id+',\''+campo+'\',this.value)" onkeydown="ac2NavKey(event,this)"/>';
}
// celda deshabilitada (la figura no usa ese slot).
function ac2CeldaOff(){ return '<td style="'+AC2_TDS+' background:#fafafa;"></td>'; }

// Navegación tipo Excel entre celdas editables (.ac2nav) de la grilla:
//   Tab / →  → siguiente celda    ·  Shift+Tab / ←  → anterior
//   ↓ / Enter → misma columna, fila de abajo  ·  ↑ → fila de arriba
// Trabaja sobre el orden VISUAL de los inputs .ac2nav en el DOM y el nº de columnas por fila.
window.ac2NavKey=function(ev, el){
  var k=ev.key;
  var navKeys={'Tab':1,'ArrowRight':1,'ArrowLeft':1,'ArrowUp':1,'ArrowDown':1,'Enter':1};
  if (!navKeys[k]) return;
  // Datalist abierto (figura): ↑/↓ navegan la lista nativa; no interceptar.
  if ((k==='ArrowUp'||k==='ArrowDown') && el.getAttribute('list')) return;
  var grid=document.getElementById('ac2_grid'); if(!grid) return;
  var target=null;
  if (k==='ArrowUp' || k==='ArrowDown' || k==='Enter'){
    // ↑↓/Enter: ir a la MISMA columna (data-col) de la fila anterior/siguiente. Robusto
    // aunque las filas tengan distinto nº de celdas (dims según figura).
    var col=el.getAttribute('data-col');
    var filas=[].slice.call(grid.querySelectorAll('tr[id^="ac2row_"]'));
    var trAct=el.closest('tr'); var fi=filas.indexOf(trAct);
    var dir=(k==='ArrowUp')?-1:1;
    for (var r=fi+dir; r>=0 && r<filas.length; r+=dir){
      var cand=filas[r].querySelector('input.ac2nav[data-col="'+col+'"]');
      if (cand){ target=cand; break; }   // salta filas donde esa columna está deshabilitada
    }
  } else {
    // ←→/Tab: input anterior/siguiente en el orden visual del DOM.
    var inputs=[].slice.call(grid.querySelectorAll('input.ac2nav'));
    var i=inputs.indexOf(el); if(i<0) return;
    var ni=(k==='ArrowLeft' || (k==='Tab'&&ev.shiftKey))? i-1 : i+1;
    if (ni>=0 && ni<inputs.length) target=inputs[ni];
  }
  if (target){ ev.preventDefault(); target.focus(); if(target.select) target.select(); }
};

function ac2Fila(b){
  var mostrarTipo=(AC2.tipo==='TODOS');
  var info = b.figura ? ac2DimsDeFigura(b.figura) : {dims:[],angs:0,radio:false};
  var val = ac2Validar(b);                          // {ok, rojas:{campo:1}}
  var td='<td style="'+AC2_TDS+'">';
  var tdr='<td style="'+AC2_TDS+' text-align:right;">';
  // Celda de dato con input; el input se marca ROJO (clase) si el campo está inválido.
  var tdDato=function(campo,w){ return '<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,campo,b[campo],w,!!val.rojas[campo])+'</td>'; };
  var h='<tr id="ac2row_'+b._id+'"'+(!val.ok?' title="Geometría inválida para la figura"':'')+'>';
  // data-grp = valor del campo por el que se agrupa (piso o marca), para que el maestro del
  // header de grupo encuentre a sus hijos. En "creación" (sin agrupar) no hay maestro, da igual.
  if (AC2.masiva){ var gc=ac2AgrupaPor(); var grpVal=(gc==='piso')?(b.piso||''):b.marca;
    h+='<td style="'+AC2_TDS+' text-align:center;"><input type="checkbox" class="ac2sel" data-grp="'+ac2Esc(grpVal)+'" data-id="'+b._id+'"'+(AC2.seleccion[b._id]?' checked':'')+' onclick="ac2SelFila(this)"/></td>'; }
  // Piso: <select> con los pisos configurados de la obra. Si la barra trae un piso que no está
  // en la lista (ej. retomado de un lote), se agrega como opción para no perderlo.
  var pisosOps=_ac2Pisos.slice();
  if (b.piso && pisosOps.indexOf(b.piso)<0) pisosOps.unshift(b.piso);
  var opPiso='<option value=""'+(b.piso?'':' selected')+'>—</option>'+
    pisosOps.map(function(p){ return '<option'+(p===b.piso?' selected':'')+'>'+ac2Esc(p)+'</option>'; }).join('');
  h+='<td style="'+AC2_TDS+'"><select class="ac2cell ac2nav" data-col="piso" data-row="'+b._id+'" style="width:56px; text-align:left;" onchange="ac2SetBarra('+b._id+',\'piso\',this.value)" onkeydown="ac2NavKey(event,this)">'+opPiso+'</select></td>';
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
  // Largo (calculado en vivo) — solo lectura, id para actualización granular.
  h+='<td id="ac2largo_'+b._id+'" style="'+AC2_TDS+' text-align:right; color:#1565c0; font-weight:600;">'+ac2Num(ac2Largo(b))+'</td>';
  // Peso (calculado en vivo) — solo lectura. Si hay largo pero falta φ, muestra "—" (falta φ).
  h+='<td id="ac2peso_'+b._id+'" style="'+AC2_TDS+' padding-right:10px; text-align:right; color:#558B2F; font-weight:600;">'+ac2PesoTxt(b)+'</td>';
  // Figura (input+datalist del catálogo). Cambiarla re-renderiza SOLO la fila (cambian las dims).
  h+='<td style="'+AC2_TDS+' padding-left:14px; border-left:1px solid #eee;"><input type="text" list="ac2_figDatalist" value="'+ac2Esc(b.figura)+'" class="ac2cell ac2nav" data-col="figura" data-row="'+b._id+'" style="width:54px; text-align:left;" onchange="ac2SetBarra('+b._id+',\'figura\',this.value)" onkeydown="ac2NavKey(event,this)" placeholder="fig"/></td>';
  if (AC2.render) h+='<td id="ac2dib_'+b._id+'" style="'+AC2_TDS+'">'+ac2FigSvg(b)+'</td>';
  // Dims A-I: input si la figura usa ese lado (rojo si inválido), celda gris si no la usa.
  for (var i=0;i<9;i++){ var k=AC2_DIMKEYS[i];
    h+= (info.dims.indexOf(k)!==-1) ? tdDato(k,54) : ac2CeldaOff();
  }
  // Ángulos α1-α4: input si la figura usa ese ángulo. Ancho para 3 cifras (135) sin cortar.
  for (var j=0;j<4;j++){ var ak='ang'+(j+1);
    h+= (j<info.angs) ? tdDato(ak,52) : ac2CeldaOff();
  }
  // Radio.
  h+= info.radio ? tdDato('radio',52) : ac2CeldaOff();
  // Rev (revisada): solo marcable si la barra está COMPLETA y VÁLIDA (φ+figura+medidas ok).
  var lista=ac2BarraLista(b);
  h+='<td style="'+AC2_TDS+' text-align:center;"><input type="checkbox" class="ac2rev"'+(b.rev&&lista?' checked':'')+(lista?'':' disabled')+' onclick="ac2ToggleRev('+b._id+',this)" title="'+(lista?'Marcar/desmarcar revisada':'Completa la barra (φ, figura y sus medidas) para poder revisarla.')+'"/></td>';
  // Acciones por fila.
  h+='<td style="'+AC2_TDS+' white-space:nowrap;">'+
     '<span onclick="ac2CopiarTipologia('+b._id+')" title="Agregar barra '+ac2Esc(b.marca)+' debajo" style="color:#558B2F; cursor:pointer; font-weight:700; margin-right:6px;">＋</span>'+
     '<span onclick="ac2Duplicar('+b._id+')" title="Duplicar" style="color:#1565c0; cursor:pointer; margin-right:6px;">⎘</span>'+
     '<span onclick="ac2Quitar('+b._id+')" title="Quitar" style="color:#c62828; cursor:pointer;">✕</span></td></tr>';
  return h;
}

// Header de grupo. porPiso=true muestra flechas para reordenar el grupo (subir/bajar). El check
// maestro de grupo (masiva) se genera con data-grp = valor del grupo.
function ac2GrupoHdr(valor, cnt, porPiso){
  var cols = (AC2.masiva?1:0) + 1 + (AC2.tipo==='TODOS'?1:0) + 5 + (AC2.render?1:0) + 9 + 4 + 1 + 1 + 1;
  var flechas = porPiso
    ? '<span style="float:right; white-space:nowrap;">'+
      '<span onclick="ac2MoverGrupo(\''+ac2Esc(valor)+'\',-1)" title="Subir este piso" style="cursor:pointer; color:#558B2F; margin-left:6px;">▲</span>'+
      '<span onclick="ac2MoverGrupo(\''+ac2Esc(valor)+'\',1)" title="Bajar este piso" style="cursor:pointer; color:#558B2F; margin-left:4px;">▼</span></span>'
    : '';
  return '<tr style="background:#eef2f3;"><td colspan="'+cols+'" style="padding:3px 8px; border-top:1px solid #ddd; font-weight:700; color:#37474f;">'+
    (AC2.masiva?'<input type="checkbox" class="ac2grp" data-grp="'+ac2Esc(valor)+'" onclick="ac2SelGrupo(this)" style="vertical-align:middle; margin-right:6px;" title="Marcar/desmarcar todo el grupo"/>':'')+
    '▎'+ac2Esc(valor||'(sin '+(porPiso?'piso':'tipo')+')')+' · '+cnt+' barra'+(cnt>1?'s':'')+flechas+'</td></tr>';
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
  var grupoCampo=ac2AgrupaPor();   // 'piso' | 'marca' | null (creación = sin agrupar)
  var html='<table style="width:100%; min-width:1150px; font-size:11px; border-collapse:collapse; white-space:nowrap;"><thead>'+ac2Thead()+'</thead><tbody>';
  if (grupoCampo) {
    var porPiso=(grupoCampo==='piso'), actual=null;
    arr.forEach(function(b){
      var v=b[grupoCampo];
      if(v!==actual){ actual=v; html+=ac2GrupoHdr(v, arr.filter(function(x){return x[grupoCampo]===v;}).length, porPiso); }
      html+=ac2Fila(b);
    });
  } else {
    // Sin agrupar (orden por creación): separador SUTIL entre filas de distinto piso.
    var pisoAnt=null;
    arr.forEach(function(b){
      if (pisoAnt!==null && b.piso!==pisoAnt) html+='<tr class="ac2sep"><td colspan="99" style="height:4px; background:#f5f7f5; border-top:2px solid #e3ebe0; padding:0;"></td></tr>';
      pisoAnt=b.piso; html+=ac2Fila(b);
    });
  }
  html+='</tbody></table>';
  cont.innerHTML=html;
  ac2ActualizarContadores();                        // rollup + revisadas + inválidas (una sola fuente)
  if (AC2.masiva){ ac2SelSyncMaestros(); ac2SelResumen(); }   // refresca contador/maestros/macro desde el estado
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

// ── SECTOR + ESTRUCTURA (FILA 2): chips clickeables. Se BLOQUEAN al elegir; desbloqueo solo
//    si el lote no tiene barras. La estructura define las tipologías (subtabs). ──
function ac2Bloqueado(){ return AC2.barras.length>0 || AC2.loteEstado==='terminada'; }

function ac2PintarSectorEstructura(){
  var bloq=ac2Bloqueado();
  var chip=function(txt,activo,onclick){
    var base='font-size:12px; padding:4px 12px; border-radius:14px; font-weight:600; margin:0;';
    if (activo) return '<span style="'+base+' border:1px solid #1565C0; background:#1565C0; color:#fff;">'+ac2Esc(txt)+'</span>';
    if (bloq)   return '<span style="'+base+' border:1px dashed #cfd8dc; background:#fff; color:#cfd8dc; cursor:not-allowed;">'+ac2Esc(txt)+'</span>';
    return '<button onclick="'+onclick+'" style="'+base+' border:1px solid #90a4ae; background:#fff; color:#546e7a; cursor:pointer;">'+ac2Esc(txt)+'</button>';
  };
  var sc=document.getElementById('ac2_sectorChips');
  if (sc) sc.innerHTML=AC2_SECTORES.map(function(s){ return chip(s, AC2.sector===s, "ac2SetSector('"+s+"')"); }).join(' ');
  var ec=document.getElementById('ac2_estructChips');
  if (ec) ec.innerHTML=AC2_ESTRUCTURAS.map(function(e){ return chip(e==='GEN'?'GENERAL':e, AC2.estructura===e, "ac2SetEstructura('"+e+"')"); }).join(' ');
  var lk=document.getElementById('ac2_sectorLock');
  if (lk) lk.textContent = bloq ? '🔒 bloqueado (hay barras) — para cambiar, descarta/elimina el lote' : '';
}
window.ac2SetSector=function(s){ if(ac2Bloqueado()) return; AC2.sector=s; ac2PintarSectorEstructura(); ac2ActualizarBotonesCrear(); };
window.ac2SetEstructura=function(e){
  if(ac2Bloqueado()) return;
  AC2.estructura=e;
  // Las tipologías (subtabs) dependen de la estructura (en su orden funcional del catálogo).
  AC2_TIPOS=(AC2_TIPOS_MAP[e]||[]).map(function(t){return t.codigo;});
  AC2_ORD_TIPO={}; AC2_TIPOS.forEach(function(t,i){ AC2_ORD_TIPO[t]=i; });
  ac2PintarSectorEstructura(); ac2PintarSubtabs();
  // Entrar por defecto a la PRIMERA tipología (no a TODOS) → los botones de crear ya quedan
  // habilitados y el flujo es directo. Si la estructura no tuviera tipologías, cae a TODOS.
  ac2SetTipo(AC2_TIPOS.length ? AC2_TIPOS[0] : 'TODOS');
};

// Genera los botones de subtab de tipología según AC2_TIPOS + TODOS.
function ac2PintarSubtabs(){
  var cont=document.getElementById('ac2_subtabs'); if(!cont) return;
  var h='<span style="font-size:11px; color:#607d8b; font-weight:700; margin-right:8px;">Tipología:</span>';
  AC2_TIPOS.forEach(function(t){ h+='<button id="ac2t_'+ac2Esc(t)+'" onclick="ac2SetTipo(\''+t+'\')" class="ac2tab">'+ac2Esc(t)+'</button>'; });
  h+='<span style="width:1px; height:22px; background:#ddd; margin:0 6px;"></span>';
  h+='<button id="ac2t_TODOS" onclick="ac2SetTipo(\'TODOS\')" class="ac2tab">TODOS</button>';
  cont.innerHTML=h;
}

// Habilita ＋barra/＋barras M solo si hay obra + sector + estructura + un subtab (no TODOS).
function ac2ActualizarBotonesCrear(){
  var puede = AC2.proyecto && AC2.sector && AC2.estructura && AC2.tipo!=='TODOS' && AC2.loteEstado!=='terminada';
  ['ac2_barraBtn','ac2_barrasMBtn'].forEach(function(bid){
    var btn=document.getElementById(bid); if(!btn) return;
    btn.disabled=!puede; btn.style.opacity=puede?'1':'0.45'; btn.style.cursor=puede?'pointer':'not-allowed';
    btn.title=puede?'':(!AC2.sector||!AC2.estructura?'Elige Sector y Estructura primero.':'Entra a una tipología (no TODOS) para agregar barras.');
  });
}

window.ac2SetTipo=function(t){
  AC2.tipo=t;
  AC2_TIPOS.concat(['TODOS']).forEach(function(x){ var b=document.getElementById('ac2t_'+x); if(b) b.className='ac2tab'+(x===t?' on':''); });
  ac2ActualizarBotonesCrear();
  ac2Render();
};
window.ac2SetOrden=function(o){ AC2.orden=o; _ac2PisosOrden=[];   // reset del orden manual de grupos
  ['creacion','piso','tipo'].forEach(function(x){ var b=document.getElementById('ac2o_'+x); if(b){var on=(o===x); b.style.background=on?'#8BC34A':'#fff'; b.style.color=on?'#fff':'#558B2F';} });
  ac2Render(); };
// Sube/baja un grupo de PISO en el orden de la grilla (flechas del header). dir=-1 sube, +1 baja.
window.ac2MoverGrupo=function(piso, dir){
  // Construir el orden actual de pisos visibles (según el orden vigente).
  var base=_ac2PisosOrden.length?_ac2PisosOrden.slice():null;
  if(!base){ base=[]; ac2Visibles().forEach(function(b){ if(base.indexOf(b.piso)<0) base.push(b.piso); }); }
  var i=base.indexOf(piso); if(i<0) return;
  var j=i+dir; if(j<0||j>=base.length) return;
  var t=base[i]; base[i]=base[j]; base[j]=t;   // swap
  _ac2PisosOrden=base;
  ac2Render();
};
window.ac2ToggleMasiva=function(){ AC2.masiva=!AC2.masiva;
  var b=document.getElementById('ac2_masivaBtn'); b.style.background=AC2.masiva?'#2e7d32':'#fff'; b.style.color=AC2.masiva?'#fff':'#8BC34A'; b.style.borderColor=AC2.masiva?'#2e7d32':'#8BC34A';
  document.getElementById('ac2_masivaBar').style.display=AC2.masiva?'flex':'none';
  if (AC2.masiva) ac2SetColTipo('lados');   // poblar dropdowns de columna al abrir
  else ac2LimpiarSeleccion();               // al apagar masivas, limpiar selección
  ac2Render(); };
window.ac2SetTam=function(t){ AC2.tam=t;
  ['s','m','l','xl'].forEach(function(x){ var b=document.getElementById('ac2r_'+x); if(b){var on=(t===x); b.style.background=on?'#8BC34A':'#fff'; b.style.color=on?'#fff':'#607d8b';} });
  ac2Render(); };
window.ac2ToggleRev=function(id,el){
  // Revisión de a 1 (proceso real). Solo se puede marcar si la barra está completa y válida
  // (defensa: el checkbox ya está disabled si no lo está, pero por si acaso).
  var b=ac2BarraPorId(id); if(!b) return;
  if (el.checked && !ac2BarraLista(b)){ el.checked=false; return; }
  b.rev=el.checked;
  ac2ActualizarContadores();
};

// ── Edición de celda: muta el dato. Sin re-render (el input ya muestra el valor). Solo la
//    FIGURA re-renderiza su fila (cambian qué dims pide). Casting numérico donde aplica. ──
var AC2_CAMPOS_NUM={diam:1,cant:1,mult:1,radio:1,ang1:1,ang2:1,ang3:1,ang4:1,
  dim_a:1,dim_b:1,dim_c:1,dim_d:1,dim_e:1,dim_f:1,dim_g:1,dim_h:1,dim_i:1};
// Muta SOLO el dato de una barra (casting numérico + defaults por figura/diámetro), sin re-render.
// Lo usa la edición masiva en tándem para aplicar el mismo cambio a varias barras y re-render una vez.
function ac2SetBarraDato(id, campo, valor){
  var b=ac2BarraPorId(id); if(!b) return;
  if (campo in AC2_CAMPOS_NUM){ var s=String(valor).trim(); b[campo]=(s===''?null:Number(s)); }
  else b[campo]=valor;
  if (campo==='figura') ac2AplicarDefaults(b,'figura');
  else if (campo==='diam') ac2AplicarDefaults(b,'diam');
}
window.ac2SetBarra=function(id,campo,valor){
  var b=ac2BarraPorId(id); if(!b) return;
  // EDICIÓN MASIVA EN TÁNDEM (igual que Bar Manager): si el modo masivo está activo y la barra
  // editada está MARCADA, aplicar este mismo cambio (campo+valor) a TODAS las marcadas de una vez
  // y re-render completo. Se maneja aparte (no cae al flujo granular de una sola fila).
  if (AC2.masiva && AC2.seleccion[id]){
    var ids=ac2IdsSeleccionados();
    if (ids.length>1){
      ids.forEach(function(oid){ ac2SetBarraDato(oid, campo, valor); });
      ac2Render();   // re-pinta todo; los checks se restauran solos desde AC2.seleccion
      return;
    }
  }
  if (campo in AC2_CAMPOS_NUM){ var s=String(valor).trim(); b[campo]=(s===''?null:Number(s)); }
  else b[campo]=valor;
  // Valores por defecto (rellena solo celdas vacías): al elegir figura → ángulos+intermedios;
  // al elegir diámetro → lados extremos = 10×diam.
  if (campo==='figura') ac2AplicarDefaults(b,'figura');
  else if (campo==='diam') ac2AplicarDefaults(b,'diam');
  if (campo==='figura' || campo==='diam'){
    // Cambian QUÉ celdas existen (dims/ángulos según figura) o los defaults → re-render de fila.
    // (El foco vuelve a la celda editada si sigue existiendo — ac2ReRenderFila lo preserva.)
    ac2ReRenderFila(id);
  } else if (campo.indexOf('dim_')===0 || campo.indexOf('ang')===0 || campo==='radio'){
    // Editar una MEDIDA: NO re-render (perdería el foco/cursor). Actualiza granularmente el
    // dibujo, largo/peso y el marcado rojo de validación, sin recrear los inputs.
    ac2ActualizarGeom(id);
  } else if (campo==='marca'){
    var agrupa=((AC2.tipo==='TODOS' && AC2.orden==='tipo')||AC2.masiva); if(agrupa){ ac2Render(); return; }
  } else { ac2ActualizarLargoPeso(id); }                  // cant/mult → solo largo/peso granular
  ac2ActualizarContadores();                              // rollup (uds/kg/revisadas)
};

// Recalcula y pinta largo+peso de UNA fila (granular, sin re-render). No toca los inputs.
function ac2ActualizarLargoPeso(id){
  var b=ac2BarraPorId(id); if(!b) return;
  var l=document.getElementById('ac2largo_'+id); if(l) l.textContent=ac2Num(ac2Largo(b));
  var p=document.getElementById('ac2peso_'+id);  if(p) p.innerHTML=ac2PesoTxt(b);
}
// Al editar una MEDIDA (dim/áng/radio): actualiza el DIBUJO (escala), largo/peso, el marcado
// ROJO de validación de cada celda, y el estado del check Rev — TODO sin recrear los inputs
// (el foco/cursor se conserva → Tab y flechas siguen funcionando).
function ac2ActualizarGeom(id){
  var b=ac2BarraPorId(id); if(!b) return;
  ac2ActualizarLargoPeso(id);
  var dib=document.getElementById('ac2dib_'+id); if(dib) dib.innerHTML=ac2FigSvg(b);
  // Marcado rojo por celda según la validación en vivo.
  var val=ac2Validar(b);
  var tr=document.getElementById('ac2row_'+id);
  if (tr) tr.querySelectorAll('input.ac2nav[data-row="'+id+'"]').forEach(function(inp){
    inp.classList.toggle('rojo', !!val.rojas[inp.getAttribute('data-col')]);
  });
  // El check Rev solo se puede marcar si la barra está completa y válida (ver ac2Fila).
  ac2ActualizarRevHabilitado(id, b);
}
// Habilita/deshabilita el checkbox Rev de una fila según si la barra está lista para revisar.
function ac2BarraLista(b){ return b.diam!=null && b.figura && ac2Validar(b).ok; }
function ac2ActualizarRevHabilitado(id, b){
  b=b||ac2BarraPorId(id); if(!b) return;
  var chk=document.querySelector('#ac2row_'+id+' input.ac2rev'); if(!chk) return;
  var lista=ac2BarraLista(b);
  if (!lista && chk.checked){ chk.checked=false; b.rev=false; }   // si dejó de estar válida, se desmarca
  chk.disabled=!lista;
  chk.title=lista?'Marcar/desmarcar revisada':'Completa la barra (φ, figura y sus medidas) para poder revisarla.';
}

// Re-render GRANULAR: reemplaza SOLO el <tr> de esa barra (no toda la tabla). PRESERVA el foco:
// el onchange dispara este re-render y recrea los inputs → si no re-enfocamos, el usuario pierde
// el cursor (no puede seguir con Tab/flechas). Guardamos la celda enfocada (fila+col) y la
// re-enfocamos tras re-pintar. focoCol = data-col a re-enfocar (por si el foco ya se movió).
function ac2ReRenderFila(id, focoCol){
  var b=ac2BarraPorId(id); if(!b) return;
  // Si no se indicó, deducir la celda activa (la que tiene el foco ahora).
  if (focoCol===undefined){
    var act=document.activeElement;
    if (act && act.classList && act.classList.contains('ac2nav')) focoCol={ row:act.getAttribute('data-row'), col:act.getAttribute('data-col') };
  }
  var tr=document.getElementById('ac2row_'+id);
  if (tr) tr.outerHTML=ac2Fila(b);
  // Re-enfocar la celda que estaba activa (misma fila+columna), si sigue existiendo.
  if (focoCol && focoCol.row!=null){
    var sel='input.ac2nav[data-row="'+focoCol.row+'"][data-col="'+focoCol.col+'"]';
    var again=document.querySelector(sel);
    if (again){ again.focus(); if(again.select) again.select(); }
  }
}
// Refresca contador de revisadas + rollup sin reconstruir la tabla.
function ac2ActualizarContadores(){
  var arr=ac2Visibles();
  var rev=arr.filter(function(b){return b.rev;}).length;
  var uds=arr.reduce(function(s,b){return s+(Number(b.cant)||0);},0);
  var kg=arr.reduce(function(s,b){return s+(Number(ac2Peso(b))||0);},0);
  var inval=arr.filter(function(b){return !ac2Validar(b).ok;}).length;
  var rc=document.getElementById('ac2_revcount');
  if(rc){ rc.innerHTML = !arr.length ? '' :
    ('✓ '+rev+' de '+arr.length+' revisadas' + (inval?(' · <b style="color:#c62828;">⚠ '+inval+' con geometría inválida</b>'):'')); }
  var ro=document.getElementById('ac2_rollup'); if(ro) ro.innerHTML=arr.length?('<b style="color:#37474f;">'+arr.length+'</b> barras · <b style="color:#37474f;">'+ac2Num(uds)+'</b> uds · <b style="color:#558B2F;">'+ac2Num(kg,1)+'</b> kg'):'';
}

// ── Agregar / copiar / duplicar / quitar barras (cambios estructurales → re-render completo) ──
function ac2PuedeCrear(){
  if (!AC2.proyecto){ alert('Elige primero una obra.'); return false; }
  if (!AC2.sector || !AC2.estructura){ alert('Elige Sector y Estructura antes de agregar barras.'); return false; }
  if (AC2.tipo==='TODOS'){ alert('Para agregar barras, entra a una tipología (no TODOS).'); return false; }
  return true;
}
window.ac2AgregarBarra=function(){
  if (!ac2PuedeCrear()) return;
  // Nace en el piso MÁS BAJO configurado (ya poblado); el cubicador lo cambia si quiere.
  AC2.barras.push(ac2NuevaBarra({ piso:_ac2PisoMasBajo() }));
  ac2PintarSectorEstructura();   // al haber barras, sector/estructura se bloquean
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
// La SELECCIÓN vive en AC2.seleccion (estado JS), NO en el DOM → sobrevive a los re-renders de
// fila (antes se perdía y la edición masiva fallaba de forma inconsistente).
// Check MAESTRO del grupo: marca/desmarca todas las barras del grupo (en el estado). El grupo
// puede ser por TIPOLOGÍA o por PISO según la vista → comparamos contra el campo vigente.
window.ac2SelGrupo=function(el){
  var grp=el.getAttribute('data-grp'), on=el.checked;
  var gc=ac2AgrupaPor(), campo=(gc==='piso')?'piso':'marca';
  ac2Visibles().forEach(function(b){ if((b[campo]||'')===grp){ if(on) AC2.seleccion[b._id]=true; else delete AC2.seleccion[b._id]; } });
  document.querySelectorAll('.ac2sel[data-grp="'+grp+'"]').forEach(function(c){ c.checked=on; });
  el.indeterminate=false;
  ac2SelSyncMaestros(); ac2SelResumen();
};
// Check MACRO: marca/desmarca TODAS las barras visibles de una, sin importar el grupo/piso.
window.ac2SelTodo=function(el){
  var on=el.checked;
  ac2Visibles().forEach(function(b){ if(on) AC2.seleccion[b._id]=true; else delete AC2.seleccion[b._id]; });
  ac2Render();   // re-render: repinta filas y maestros de grupo desde el estado
};
// Al marcar/desmarcar UNA fila: actualiza el estado + sincroniza el maestro de su grupo.
window.ac2SelFila=function(el){
  if (el){ var id=Number(el.getAttribute('data-id')); if(el.checked) AC2.seleccion[id]=true; else delete AC2.seleccion[id]; }
  ac2SelSyncMaestros(); ac2SelResumen();
};
// Sincroniza los checkboxes maestros de grupo (checked / indeterminate) desde el estado.
function ac2SelSyncMaestros(){
  document.querySelectorAll('.ac2grp').forEach(function(m){
    var grp=m.getAttribute('data-grp');
    var hijos=[].slice.call(document.querySelectorAll('.ac2sel[data-grp="'+grp+'"]'));
    var marc=hijos.filter(function(c){return c.checked;}).length;
    m.checked=(marc>0 && marc===hijos.length);
    m.indeterminate=(marc>0 && marc<hijos.length);
  });
}
// Contador de seleccionadas (desde el estado) + estado del check MACRO (todas/algunas/ninguna).
function ac2SelResumen(){
  var s=document.getElementById('ac2_selcount');
  var nsel=ac2IdsSeleccionados().length;
  if (s) s.textContent = nsel? (nsel+' seleccionada'+(nsel>1?'s':'')) : 'ninguna seleccionada';
  var macro=document.getElementById('ac2_selTodo');
  if (macro){ var total=ac2Visibles().length;
    macro.checked=(nsel>0 && nsel===total);
    macro.indeterminate=(nsel>0 && nsel<total);
  }
}
// ── ACCIONES MASIVAS: operan sobre las barras MARCADAS (AC2.seleccion, estado JS) ──
function ac2IdsSeleccionados(){
  // Solo ids de barras que existen (limpia selección de barras ya borradas).
  return Object.keys(AC2.seleccion).map(Number).filter(function(id){ return !!ac2BarraPorId(id); });
}
// Limpia toda la selección (al descartar, retomar lote, cambiar de obra…).
function ac2LimpiarSeleccion(){ AC2.seleccion={}; }
// Columnas por tipo (mismo criterio que Bar Manager): lados A-I o ángulos α1-α4. R/φ/cant no aplican.
var AC2_COLS_LADOS=[['dim_a','A'],['dim_b','B'],['dim_c','C'],['dim_d','D'],['dim_e','E'],['dim_f','F'],['dim_g','G'],['dim_h','H'],['dim_i','I']];
var AC2_COLS_ANG=[['ang1','α1'],['ang2','α2'],['ang3','α3'],['ang4','α4']];
// Puebla los dropdowns de columna origen/destino con el grupo del tipo activo.
window.ac2SetColTipo=function(tipo){
  var cols=(tipo==='angulos')?AC2_COLS_ANG:AC2_COLS_LADOS;
  var opts=cols.map(function(c){ return '<option value="'+c[0]+'">'+c[1]+'</option>'; }).join('');
  var so=document.getElementById('ac2ColOrigen'), sd=document.getElementById('ac2ColDestino');
  if(so) so.innerHTML=opts; if(sd){ sd.innerHTML=opts; if(sd.options.length>1) sd.selectedIndex=1; }
  ac2ColFlecha();
};
window.ac2ColFlecha=function(){
  var op=document.getElementById('ac2ColOp'); if(!op) return;
  // (la flecha ya está en el texto de la opción; nada extra que hacer, hook por consistencia)
};
// Copiar/intercambiar una columna a otra (mismo tipo) en las barras MARCADAS. Igual que Bar Manager.
window.ac2OperarColumnas=function(){
  var ids=ac2IdsSeleccionados();
  if (!ids.length){ alert('Marca al menos una barra.'); return; }
  var op=(document.getElementById('ac2ColOp')||{}).value||'copiar';
  var origen=(document.getElementById('ac2ColOrigen')||{}).value;
  var destino=(document.getElementById('ac2ColDestino')||{}).value;
  if (!origen||!destino) return;
  if (origen===destino){ alert('La columna de origen y destino deben ser distintas.'); return; }
  ids.forEach(function(id){
    var b=ac2BarraPorId(id); if(!b) return;
    if (op==='intercambiar'){ var t=b[destino]; b[destino]=b[origen]; b[origen]=t; }
    else { b[destino]=b[origen]; }   // copiar: origen → destino
  });
  ac2Render();   // re-render (cambian dims → largo/peso/validación/dibujo de varias filas)
};
// Duplicar las barras marcadas en el mismo piso. Las copias se insertan JUNTAS tras la última
// original (no intercaladas) y quedan PRE-SELECCIONADAS para editarlas de una sin marcar nada.
window.ac2CopiarSeleccionadas=function(){
  var ids=ac2IdsSeleccionados();
  if (!ids.length){ alert('Marca al menos una barra.'); return; }
  var origen=AC2.barras.filter(function(b){ return ids.indexOf(b._id)>=0; });
  var copias=[], ultimoIdx=-1;
  origen.forEach(function(b){
    var copia=JSON.parse(JSON.stringify(b)); copia._id=_ac2Seq++; copia.rev=false; delete copia._guardada;
    copias.push(copia);
    ultimoIdx=Math.max(ultimoIdx, AC2.barras.indexOf(b));
  });
  Array.prototype.splice.apply(AC2.barras, [ultimoIdx+1,0].concat(copias));
  AC2.seleccion={}; copias.forEach(function(c){ AC2.seleccion[c._id]=true; });   // selección → copias
  ac2Render();
};
// Duplicar las marcadas moviéndolas un piso (dir=+1 sube, dir=-1 baja). _ac2Pisos va de más
// bajo (índice 0) a más alto, así que subir = índice+1, bajar = índice-1.
// ORDENADO: las copias se insertan TODAS JUNTAS después de la última original (no intercaladas),
// en el mismo orden en que estaban las originales, y quedan SELECCIONADAS (para encadenar +piso).
window.ac2DuplicarPiso=function(dir){
  var ids=ac2IdsSeleccionados();
  if (!ids.length){ alert('Marca al menos una barra.'); return; }
  if (!_ac2Pisos.length){ alert('No hay pisos configurados en la obra.\nÁbrelos en ⚙ Configuración de obra para poder duplicar por piso.'); return; }
  // Originales en su orden actual dentro de AC2.barras (para que las copias salgan ordenadas).
  var origen=AC2.barras.filter(function(b){ return ids.indexOf(b._id)>=0; });
  var copias=[], sinDestino=0, ultimoIdx=-1;
  origen.forEach(function(b){
    var i=_ac2Pisos.indexOf(b.piso);
    if (i<0){ sinDestino++; return; }                          // sin piso / fuera de plantilla
    var j=i+dir;
    if (j<0 || j>=_ac2Pisos.length){ sinDestino++; return; }   // ya en el tope / piso más bajo
    var copia=JSON.parse(JSON.stringify(b)); copia._id=_ac2Seq++; copia.rev=false; delete copia._guardada;
    copia.piso=_ac2Pisos[j];
    copias.push(copia);
    ultimoIdx=Math.max(ultimoIdx, AC2.barras.indexOf(b));      // insertaremos tras la última original
  });
  if (!copias.length){ alert('Ninguna barra pudo moverse '+(dir>0?'un piso arriba':'un piso abajo')+'.\n(Ya están en el '+(dir>0?'piso más alto':'piso más bajo')+' o no tienen piso asignado.)'); return; }
  // Insertar el bloque de copias junto, tras la última original.
  var args=[ultimoIdx+1,0].concat(copias);
  Array.prototype.splice.apply(AC2.barras, args);
  // La selección pasa a las copias (encadenar: duplicar +piso otra vez sube otro nivel).
  AC2.seleccion={}; copias.forEach(function(c){ AC2.seleccion[c._id]=true; });
  if (sinDestino) alert(copias.length+' barra(s) duplicada(s). '+sinDestino+' no se movieron (tope de pisos o sin piso).');
  ac2Render();
};
// Borrar las barras marcadas (con confirmación).
window.ac2BorrarSeleccionadas=function(){
  var ids=ac2IdsSeleccionados();
  if (!ids.length){ alert('Marca al menos una barra.'); return; }
  if (!confirm('Borrar '+ids.length+' barra(s) seleccionada(s)?\n(Las ya guardadas en el lote no se tocan hasta guardar.)')) return;
  AC2.barras=AC2.barras.filter(function(b){ return ids.indexOf(b._id)<0; });
  ids.forEach(function(id){ delete AC2.seleccion[id]; });
  ac2Render();
};
// ── Estado visual del badge/bandera según el estado del lote (sin número inventado) ──
function ac2PintarEstado(){
  var b=document.getElementById('ac2_bandera'), badge=document.getElementById('ac2_estadoBadge');
  var terminado=(AC2.loteEstado==='terminada');
  var lote=AC2.loteId?('Lote #'+AC2.loteId+' · '):'';
  if (b){ b.textContent=terminado?'🏁':'🚩';
    b.style.background=terminado?'#e8f5e9':'#ffebee'; b.style.color=terminado?'#2e7d32':'#c62828'; b.style.borderColor=terminado?'#a5d6a7':'#ef9a9a'; }
  if (badge){
    if (terminado){ badge.textContent=lote+'🔒 Terminado'; badge.style.background='#e8f5e9'; badge.style.color='#2e7d32'; badge.style.borderColor='#a5d6a7'; }
    else if (AC2.loteId){ badge.textContent=lote+'En edición'; badge.style.background='#fff3e0'; badge.style.color='#e65100'; badge.style.borderColor='#ffb74d'; }
    else { badge.textContent='Nuevo lote · sin barras'; badge.style.background='#eceff1'; badge.style.color='#607d8b'; badge.style.borderColor='#cfd8dc'; }
  }
}

// POST a un endpoint SIN el prefijo /api/v1 (los /lotes van en raíz). Devuelve {response,data}.
async function _ac2Post(url, body){
  var tok=localStorage.getItem('armahub_token');
  var res=await fetch(url, { method:'POST',
    headers: Object.assign({'Content-Type':'application/json'}, tok?{Authorization:'Bearer '+tok}:{}),
    body: JSON.stringify(body||{}) });
  var data=null; try{ data=await res.json(); }catch(e){}
  return { ok:res.ok, status:res.status, data:data };
}
// GET a un endpoint SIN el prefijo /api/v1 (los /lotes van en raíz). Devuelve el JSON o null.
async function _ac2Get(url){
  var tok=localStorage.getItem('armahub_token');
  var res=await fetch(url, { headers: tok?{Authorization:'Bearer '+tok}:{} });
  if (!res.ok) return null;
  try{ return await res.json(); }catch(e){ return null; }
}

// Barras COMPLETAS (con figura y φ) y NO guardadas aún, listas para guardar. Omite las que
// están a medio llenar o las ya guardadas (para no duplicarlas al re-guardar).
function ac2BarrasListas(){
  return AC2.barras.filter(function(b){ return !b._guardada && b.diam!=null && b.figura && ac2Validar(b).ok; });
}
// Mapea una barra del estado al payload del backend (mismo shape; solo limpia nulls/estampa contexto).
function ac2Payload(b){
  var it={ sector:AC2.sector||null, ciclo:AC2.ciclo||null, piso:(b.piso||null), eje:AC2.eje||null,
           diam:Number(b.diam), figura:b.figura||null, marca:b.marca||null,
           cant:Number(b.cant)||1, mult:Number(b.mult)||1, radio:(b.radio!=null?Number(b.radio):null),
           revisada: !!b.rev };
  AC2_DIMKEYS.forEach(function(k){ it[k]=(b[k]!=null?Number(b[k]):null); });
  ['ang1','ang2','ang3','ang4'].forEach(function(a){ it[a]=(b[a]!=null?Number(b[a]):null); });
  return it;
}

// 💾 GUARDAR AVANCE: crea el lote (si no existe) y persiste las barras COMPLETAS y válidas. Las
// incompletas NO se pierden: quedan en el formulario para seguir completándolas y guardarlas
// después. (El backend solo acepta barras con geometría válida; guardar avance = fijar lo que ya
// está listo, sin exigir terminar todo.)
window.ac2Guardar=async function(){
  if (!AC2.proyecto){ alert('Elige primero una obra.'); return; }
  if (AC2.loteEstado==='terminada'){ alert('El lote está terminado; se edita desde Bar Manager.'); return; }
  var listas=ac2BarrasListas();
  var pendientes=AC2.barras.filter(function(b){ return !b._guardada; }).length - listas.length;
  if (!listas.length){
    alert('Aún no hay ninguna barra COMPLETA para guardar.\n\nGuardar fija en el lote las barras que ya tienen φ, figura y sus medidas válidas. Las que están a medio llenar (celdas en rojo/vacías) se quedan en pantalla para que las completes; guarda de nuevo cuando estén listas.');
    return;
  }
  try{
    // 1) Crear lote si aún no existe.
    if (!AC2.loteId){
      var r=await _ac2Post('/lotes', { id_proyecto:AC2.proyecto });
      if (!r.ok || !r.data || !r.data.lote_id){ alert('No se pudo crear el lote'+(r.data&&r.data.detail?': '+(r.data.detail.msg||r.data.detail):'')+'.'); return; }
      AC2.loteId=r.data.lote_id; AC2.loteEstado='borrador';
    }
    // 2) Agregar las barras (transaccional en el backend).
    var rb=await _ac2Post('/lotes/'+AC2.loteId+'/barras', { barras: listas.map(ac2Payload) });
    if (!rb.ok){
      var d=rb.data&&rb.data.detail;
      alert('No se guardaron las barras'+(d?': '+(d.msg||JSON.stringify(d)):' (error '+rb.status+')')+'.');
      return;
    }
    var n=(rb.data&&rb.data.creadas)||listas.length;
    // Las barras guardadas PERMANECEN en la grilla (marcadas _guardada) para poder revisarlas
    // ahí (el check "revisada" es por fila) y terminar el lote. NO se vacían.
    listas.forEach(function(b){ b._guardada=true; });
    ac2PintarEstado(); ac2Render(); ac2CargarLotes();
    var msg='✅ '+n+' barra(s) guardadas en el lote #'+AC2.loteId+'.';
    if (pendientes>0) msg+='\n\nQuedan '+pendientes+' barra(s) sin completar en el formulario — complétalas y vuelve a guardar.';
    else msg+='\nMarca "Rev" en cada barra y luego 🏁 Terminar.';
    alert(msg);
  }catch(e){ alert('Error de red al guardar. Reintenta.'); }
};

// 🏁 TERMINAR: cierra el lote. El backend exige que TODAS sus barras estén revisadas (5N.19).
window.ac2ToggleTerminado=async function(){
  if (!AC2.loteId){ alert('Primero guarda barras en el lote (💾) antes de terminarlo.'); return; }
  if (AC2.loteEstado==='terminada'){ alert('El lote ya está terminado.'); return; }
  if (!confirm('Terminar el lote #'+AC2.loteId+' lo cierra: sus barras se editarán solo desde Bar Manager.\n\n¿Continuar?')) return;
  var r=await _ac2Post('/lotes/'+AC2.loteId+'/terminar', {});
  if (!r.ok){
    var d=r.data&&r.data.detail;
    alert('No se pudo terminar'+(d?': '+(d.msg||JSON.stringify(d)):'')+'.');   // 409 si faltan revisadas / lote vacío
    return;
  }
  AC2.loteEstado='terminada';
  ac2PintarEstado(); ac2CargarLotes();
  alert('🏁 Lote #'+AC2.loteId+' terminado.');
};
window.ac2TogglePisos=function(){
  var m=document.getElementById('ac2_pisosMenu'); if(!m) return;
  m.style.display=(m.style.display==='none')?'block':'none';
};
// ＋ barras M: una barra por cada piso seleccionado, con SU piso y la tipología activa.
// Los pisos vienen de la CONFIG de pisos de la obra (tarea aparte, aún no disponible).
window.ac2AgregarBarrasMulti=function(){
  if (!ac2PuedeCrear()) return;
  var pisos=[].slice.call(document.querySelectorAll('.ac2piso:checked')).map(function(c){return c.value;});
  if(!pisos.length){ alert('Aún no hay pisos configurados para esta obra.\nLa configuración de pisos es una tarea pendiente.'); return; }
  pisos.forEach(function(p){ AC2.barras.push(ac2NuevaBarra({ piso:p })); });
  ac2PintarSectorEstructura();
  ac2Render();
};
// ✕ DESCARTAR: limpia las barras del formulario NO guardadas (no toca el lote ya guardado).
window.ac2Descartar=function(){
  if (!AC2.barras.length){ return; }
  if (confirm('Se quitarán del formulario las '+AC2.barras.length+' barra(s) que aún NO guardaste.\n(Las ya guardadas en el lote no se tocan.)\n\n¿Continuar?')){
    AC2.barras=[]; ac2LimpiarSeleccion(); ac2Render();
  }
};

// ＋ Crear Eje: fija el eje escrito para la tanda (si no existe en la obra, igual queda como el
// eje del lote — nace al guardar la primera barra en él). Simplemente confirma AC2.eje.
window.ac2CrearEje=function(){
  var txt=(_ac2CbEje?_ac2CbEje.getTexto().trim():'') || AC2.eje;
  if (!txt){ alert('Escribe primero el nombre del eje/losa.'); return; }
  AC2.eje=txt;
  var existe=_ac2EjesObra.some(function(e){ return String(e.id).toLowerCase()===txt.toLowerCase(); });
  ac2Render();   // refresca el contexto mostrado
  alert(existe ? ('Eje "'+txt+'" seleccionado para esta tanda.')
               : ('Eje NUEVO "'+txt+'" fijado para esta tanda. Se creará al guardar la primera barra.'));
};

// Carga TODOS los lotes de la obra en el repositorio (GET /lotes?proyecto=X, con n_barras/kg
// reales). Permite ver que los lotes guardados SIGUEN existiendo entre sesiones y (a futuro)
// retomarlos. Los datos viven en BD; esta lista los muestra aunque recargues la página.
async function ac2CargarLotes(){
  var tb=document.getElementById('ac2_lotesBody'); if(!tb) return;
  if (!AC2.proyecto){ tb.innerHTML='<tr><td colspan="7" style="padding:10px 8px; color:#90a4ae; font-style:italic; text-align:center;">Elige una obra para ver sus lotes.</td></tr>'; return; }
  var lotes=[];
  try { var d=await _ac2Get('/lotes?proyecto='+encodeURIComponent(AC2.proyecto)); lotes=(d&&d.lotes)||[]; }
  catch(e){ lotes=[]; }
  if (!lotes.length){ tb.innerHTML='<tr><td colspan="7" style="padding:10px 8px; color:#90a4ae; font-style:italic; text-align:center;">Esta obra aún no tiene lotes.</td></tr>'; return; }
  tb.innerHTML=lotes.map(function(l){
    var esta=(l.id===AC2.loteId);
    var estado = l.estado==='terminada'
      ? '<span style="background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; padding:1px 8px; border-radius:8px;">🏁 Terminado</span>'
      : '<span style="background:#fff3e0; color:#e65100; border:1px solid #ffb74d; padding:1px 8px; border-radius:8px;">🚩 En edición</span>';
    var fecha=(l.creado_fecha||'').slice(0,10);
    // Fila COMPLETA como hiperlink: hover la resalta, click retoma el lote.
    return '<tr class="ac2loterow" onclick="ac2RetomarLote('+l.id+')" title="Abrir este lote para verlo/seguir editándolo" style="border-top:1px solid #f0f0f0; cursor:pointer;'+(esta?' background:#f1f8e9;':'')+'">'+
      '<td style="padding:6px 8px; font-weight:600; color:#558B2F;">#'+l.id+(esta?' •':'')+'</td>'+
      '<td style="padding:6px 8px;">'+ac2Esc(l.sector||'—')+' · '+ac2Esc(l.ciclo||'—')+' · '+ac2Esc(l.eje||'—')+'</td>'+
      '<td style="padding:6px 8px;">'+estado+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+(l.n_barras||0)+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+ac2Num(l.kg,1)+'</td>'+
      '<td style="padding:6px 8px; color:#888;">'+ac2Esc(fecha)+'</td>'+
      '<td style="padding:6px 8px; text-align:right; color:#558B2F; font-size:11px;">'+(l.estado==='terminada'?'🔒 ver':'✎ abrir')+'</td></tr>';
  }).join('');
}

// RETOMAR un lote: carga sus barras (GET /lotes/{id}) y reconstruye el formulario. Un lote
// TERMINADO se abre en solo-lectura (sus barras se corrigen en Bar Manager). Uno en borrador
// se puede seguir editando. Advierte si hay cambios sin guardar en el form actual.
window.ac2RetomarLote=async function(id){
  var pend=AC2.barras.filter(function(b){return !b._guardada;}).length;
  if (pend && !confirm('Tienes '+pend+' barra(s) sin guardar en el formulario. Si abres otro lote se descartarán.\n\n¿Continuar?')) return;
  var d=await _ac2Get('/lotes/'+id);
  if (!d || !d.lote){ alert('No se pudo abrir el lote.'); return; }
  var L=d.lote, bs=d.barras||[];
  AC2.loteId=L.id; AC2.loteEstado=L.estado;
  // Contexto del lote (de su primera barra): sector, estructura (se infiere de la marca), ciclo, eje.
  var b0=bs[0]||{};
  AC2.sector=b0.sector||''; AC2.ciclo=b0.ciclo||''; AC2.eje=b0.eje||'';
  AC2.estructura=ac2EstructuraDeMarca(b0.marca)||AC2.estructura;
  // Reconstruir las barras (todas ya guardadas → _guardada=true).
  _ac2Seq=1; ac2LimpiarSeleccion();
  AC2.barras=bs.map(function(x){
    var nb=ac2NuevaBarra({ piso:x.piso||'', marca:x.marca||'', diam:x.diam, cant:x.cant, mult:x.mult,
      figura:x.figura||'', radio:x.radio, rev:!!x.revisada });
    AC2_DIMKEYS.forEach(function(k){ nb[k]=x[k]; });
    ['ang1','ang2','ang3','ang4'].forEach(function(a){ nb[a]=x[a]; });
    nb._guardada=true;
    return nb;
  });
  // Sincronizar tipologías de la estructura + reflejar contexto en los comboboxes/chips.
  if (AC2.estructura){ AC2_TIPOS=(AC2_TIPOS_MAP[AC2.estructura]||[]).map(function(t){return t.codigo;}); AC2_ORD_TIPO={}; AC2_TIPOS.forEach(function(t,i){ AC2_ORD_TIPO[t]=i; }); }
  if (_ac2CbCiclo) _ac2CbCiclo.setValor({id:AC2.ciclo,label:AC2.ciclo});
  if (_ac2CbEje)   _ac2CbEje.setValor({id:AC2.eje,label:AC2.eje});
  AC2.tipo='TODOS';
  ac2PintarSectorEstructura(); ac2PintarSubtabs(); ac2PintarEstado();
  _ac2CargarPisos();   // pisos de la obra para el <select> de la grilla
  ac2SetTipo('TODOS'); ac2CargarLotes();
  if (L.estado==='terminada') alert('Lote #'+L.id+' TERMINADO — solo lectura. Para corregir una barra, usa Bar Manager.');
};
// Deduce la estructura a partir de un código de marca/tipología (busca en el mapa).
function ac2EstructuraDeMarca(m){
  if (!m) return '';
  for (var es in AC2_TIPOS_MAP){ if (AC2_TIPOS_MAP[es].some(function(t){return t.codigo===m;})) return es; }
  return '';
}

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
        // Al cambiar de obra: se descarta la tanda en curso (ciclo/eje/lote/barras son de la
        // obra anterior). El lote guardado no se pierde (vive en BD); solo se limpia el form.
        AC2.ciclo=''; AC2.eje=''; AC2.sector=''; AC2.estructura='';
        AC2.loteId=null; AC2.loteEstado=''; AC2.barras=[]; AC2.tipo='TODOS'; ac2LimpiarSeleccion();
        if (_ac2CbCiclo) _ac2CbCiclo.limpiar();
        if (_ac2CbEje)   _ac2CbEje.limpiar();
        _ac2CiclosObra=[]; _ac2EjesObra=[];
        ac2PintarEstado(); ac2PintarSectorEstructura(); ac2PintarSubtabs();
        ac2ActualizarBotonesCrear(); ac2Render(); ac2CargarLotes();
        _ac2Pisos=[]; ac2PintarMenuPisos();
        if (AC2.proyecto){ _ac2CargarContexto(AC2.proyecto); _ac2CargarPisos(); }
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

// Pisos disponibles de la obra (GET /proyectos/{id}/pisos-combinados): plantilla ∪ existentes,
// ordenados (subterráneos → P1..Pn → SM). Alimenta el <select> de piso de la grilla y el menú
// "＋barras M". Se llama al elegir obra y tras guardar la config.
async function _ac2CargarPisos(){
  _ac2Pisos=[];
  if (!AC2.proyecto) { ac2PintarMenuPisos(); return; }
  try { var d=await _ac2Get('/proyectos/'+encodeURIComponent(AC2.proyecto)+'/pisos-combinados');
        _ac2Pisos=((d&&d.pisos)||[]).map(function(p){ return p.valor; }); } catch(e){ _ac2Pisos=[]; }
  ac2PintarMenuPisos();
}
// Piso por defecto = el MÁS BAJO configurado (primero de la lista ya ordenada: S2 antes que P1).
function _ac2PisoMasBajo(){ return _ac2Pisos.length ? _ac2Pisos[0] : ''; }
// Puebla el menú "＋barras M" con checkboxes de los pisos reales de la obra.
function ac2PintarMenuPisos(){
  var cont=document.getElementById('ac2_pisosLista'); if(!cont) return;
  if (!_ac2Pisos.length){ cont.innerHTML='<span style="color:#90a4ae; font-style:italic;">No hay pisos configurados. Ábrelos en ⚙ Configuración de obra.</span>'; return; }
  // Check MAESTRO (marca/desmarca todos) arriba, separado de la lista de pisos.
  var maestro='<label style="display:block; font-size:12px; font-weight:700; padding:2px 0; cursor:pointer; color:#546e7a;"><input type="checkbox" id="ac2_pisoAll" onclick="ac2PisosTodos(this)"/> Todos</label>'+
    '<div style="border-top:1px solid #eee; margin:4px 0;"></div>';
  cont.innerHTML=maestro+_ac2Pisos.map(function(p){
    return '<label style="display:block; font-size:12px; padding:2px 0; cursor:pointer;"><input type="checkbox" class="ac2piso" value="'+ac2Esc(p)+'" onclick="ac2PisosSync()"/> '+ac2Esc(p)+'</label>';
  }).join('');
}
// Check maestro: marca/desmarca todos los pisos.
window.ac2PisosTodos=function(el){
  document.querySelectorAll('.ac2piso').forEach(function(c){ c.checked=el.checked; });
  el.indeterminate=false;
};
// Al marcar un piso individual: sincroniza el maestro (todos / ninguno / indeterminado).
window.ac2PisosSync=function(){
  var todos=[].slice.call(document.querySelectorAll('.ac2piso'));
  var marc=todos.filter(function(c){return c.checked;}).length;
  var all=document.getElementById('ac2_pisoAll'); if(!all) return;
  all.checked=(marc>0 && marc===todos.length);
  all.indeterminate=(marc>0 && marc<todos.length);
};

// Tipologías reales por estructura (GET /tipologias, con figuras embebidas). La API ordena por
// código (ALFABÉTICO), pero el orden CORRECTO es el funcional del catálogo (MH,MV,TR,EC,TC,CB…),
// que está en el fallback AC2_TIPOS_MAP. Estrategia: conservar el ORDEN del fallback y solo
// enriquecer cada tipología con {nombre, figuras} de la API. Códigos de la API que no estén en
// el fallback se agregan al final (por si el catálogo creció).
async function _ac2CargarTipologias(){
  var tips=[];
  try { var d=await apiGet('/tipologias'); tips=(d && d.tipologias)||[]; } catch(e){ tips=[]; }
  if (!tips.length) return;   // deja el fallback (orden correcto)
  // Index por estructura+código para buscar rápido lo que trajo la API.
  var api={}; tips.forEach(function(t){ var es=t.estructura||'GEN'; api[es+'|'+t.codigo]={nombre:t.nombre, figuras:t.figuras||[]}; });
  var map={};
  // 1) Recorrer el fallback EN SU ORDEN, enriqueciendo con la API.
  Object.keys(AC2_TIPOS_MAP).forEach(function(es){
    map[es]=AC2_TIPOS_MAP[es].map(function(t){
      var extra=api[es+'|'+t.codigo]; return { codigo:t.codigo, nombre:(extra&&extra.nombre)||t.nombre, figuras:(extra&&extra.figuras)||[] };
    });
  });
  // 2) Códigos de la API que NO estaban en el fallback → al final de su estructura.
  tips.forEach(function(t){ var es=t.estructura||'GEN'; map[es]=map[es]||[];
    if (!map[es].some(function(x){return x.codigo===t.codigo;})) map[es].push({codigo:t.codigo, nombre:t.nombre, figuras:t.figuras||[]});
  });
  AC2_TIPOS_MAP=map;
}

// Loader del tab (registrado en shell.js tabLoaders['agregar2']): se llama al ACTIVAR el
// tab (clic o restauración tras F5). Refresca la lista de obras real. Idempotente.
async function loadAgregarCubicacion2(){
  if(!document.getElementById('ac2_grid')) return;
  _ac2InitComboboxes();
  await _ac2CargarFiguras();
  await _ac2CargarTipologias();
  await _ac2CargarObras();
  ac2PintarSectorEstructura(); ac2PintarSubtabs();
  ac2SetTipo(AC2.tipo || 'TODOS');   // re-sincroniza subtabs + re-pinta el grid al (re)entrar
}
window.loadAgregarCubicacion2 = loadAgregarCubicacion2;

// ═════════════════════════════════════════════════════════════════════════════
// PANEL "⚙ Configuración de obra" (5N.26): modal con pisos/ciclos (plantilla + derivados),
// factor de peso y valores por defecto. GET/PUT /proyectos/{id}/config. No sale del creador.
// La config es PLANTILLA de opciones (no compite con lo derivado de barras). Los pisos/ciclos
// que YA tienen barras se muestran bloqueados (no borrables: para eso se limpia la data).
// ═════════════════════════════════════════════════════════════════════════════
var AC2_CFG = { pisos:[], ciclos:[], factor_peso:0, factor_extremo:10, largo_intermedio:100, existP:{}, existC:{} };

window.ac2AbrirConfig=async function(){
  if (!AC2.proyecto){ alert('Elige primero una obra.'); return; }
  document.getElementById('ac2_cfgObra').textContent='Obra '+ac2Esc(AC2.proyecto);
  document.getElementById('ac2_cfgModal').style.display='block';
  document.getElementById('ac2_cfgBody').innerHTML='<div style="color:#90a4ae; text-align:center; padding:20px;">Cargando…</div>';
  var d=await _ac2Get('/proyectos/'+encodeURIComponent(AC2.proyecto)+'/config');
  if (!d){ document.getElementById('ac2_cfgBody').innerHTML='<div style="color:#c62828; text-align:center; padding:20px;">No se pudo cargar la configuración.</div>'; return; }
  // Pisos/ciclos a mostrar = plantilla ∪ existentes. Marcar cuáles tienen barras (no borrables).
  AC2_CFG.existP={}; (d.pisos_existentes||[]).forEach(function(x){ AC2_CFG.existP[x.valor]=!!x.tiene_barras; });
  AC2_CFG.existC={}; (d.ciclos_existentes||[]).forEach(function(x){ AC2_CFG.existC[x.valor]=!!x.tiene_barras; });
  // Lista combinada: existentes primero (en su orden), luego los de plantilla que no estén.
  AC2_CFG.pisos = _ac2CfgUnir((d.pisos_existentes||[]).map(function(x){return x.valor;}), d.pisos_plantilla||[]);
  AC2_CFG.ciclos= _ac2CfgUnir((d.ciclos_existentes||[]).map(function(x){return x.valor;}), d.ciclos_plantilla||[]);
  // Si la obra está LIMPIA (sin pisos existentes ni plantilla) → default.
  if (!AC2_CFG.pisos.length) AC2_CFG.pisos=['S2','S1','P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','SM'];
  AC2_CFG.factor_peso=Number(d.factor_peso)||0;
  AC2_CFG.factor_extremo=Number(d.factor_extremo)||10;
  AC2_CFG.largo_intermedio=Number(d.largo_intermedio)||100;
  ac2CfgRender();
};
function _ac2CfgUnir(a,b){ var out=a.slice(); b.forEach(function(v){ if(out.indexOf(v)<0) out.push(v); }); return out; }
window.ac2CerrarConfig=function(){ document.getElementById('ac2_cfgModal').style.display='none'; };

function ac2CfgRender(){
  var body=document.getElementById('ac2_cfgBody'); if(!body) return;
  body.innerHTML =
    ac2CfgSeccionLista('Pisos', 'piso', AC2_CFG.pisos, AC2_CFG.existP,
      'Los pisos disponibles para elegir al crear barras. Los que ya tienen barras no se pueden quitar.') +
    ac2CfgSeccionLista('Ciclos', 'ciclo', AC2_CFG.ciclos, AC2_CFG.existC,
      'Ciclos de la obra. Deja listos los que uses.') +
    '<div style="margin:16px 0 8px; border-top:1px solid #eee; padding-top:12px;">'+
      '<div style="font-weight:700; color:#37474f; font-size:13px; margin-bottom:8px;">Factores</div>'+
      ac2CfgCampoNum('Factor de peso (%)', 'factor_peso', AC2_CFG.factor_peso, 'Se suma al peso teórico. 0 = sin ajuste.')+
      ac2CfgCampoNum('Largo por defecto de extremos (× φ)', 'factor_extremo', AC2_CFG.factor_extremo, 'Los lados extremos nacen con este factor × diámetro (en cm).')+
      ac2CfgCampoNum('Largo por defecto de lados intermedios (cm)', 'largo_intermedio', AC2_CFG.largo_intermedio, '')+
    '</div>'+
    // Restricciones: solo placeholder (diseño futuro, 5N.29).
    '<div style="margin:16px 0 0; border-top:1px solid #eee; padding-top:12px;">'+
      '<div style="font-weight:700; color:#37474f; font-size:13px; margin-bottom:4px;">Restricciones <span style="font-weight:400; color:#b0bec5; font-size:11px;">(próximamente)</span></div>'+
      '<div style="font-size:11px; color:#90a4ae; font-style:italic;">Normativa · Fabricación · Particulares de barras — generarán bloqueos en la grilla. En diseño.</div>'+
    '</div>';
}

// Sección de lista editable (pisos/ciclos): chips con los valores; los que tienen barras van
// bloqueados (🔒, no se pueden quitar); botón para agregar uno nuevo.
function ac2CfgSeccionLista(titulo, tipo, lista, exist, ayuda){
  var chips=lista.map(function(v){
    var bloq=!!exist[v];
    return '<span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; padding:3px 8px; margin:2px; border-radius:12px; border:1px solid #cfd8dc; background:'+(bloq?'#eceff1':'#f1f8e9')+'; color:#37474f;">'+
      ac2Esc(v)+ (bloq?' <span title="Tiene barras — no se puede quitar">🔒</span>'
        : ' <span onclick="ac2CfgQuitar(\''+tipo+'\',\''+ac2Esc(v)+'\')" title="Quitar" style="cursor:pointer; color:#c62828; font-weight:700;">✕</span>')+'</span>';
  }).join(' ');
  return '<div style="margin-bottom:12px;">'+
    '<div style="font-weight:700; color:#37474f; font-size:13px;">'+titulo+'</div>'+
    (ayuda?'<div style="font-size:10.5px; color:#90a4ae; margin:2px 0 6px;">'+ayuda+'</div>':'')+
    '<div style="margin-bottom:6px;">'+(chips||'<span style="color:#b0bec5; font-size:11px; font-style:italic;">— ninguno —</span>')+'</div>'+
    '<input id="ac2cfg_new_'+tipo+'" type="text" placeholder="agregar '+tipo+'…" style="font-size:12px; padding:3px 8px; border:1px solid #cfd8dc; border-radius:4px; width:140px;" onkeydown="if(event.key===\'Enter\'){ac2CfgAgregar(\''+tipo+'\');event.preventDefault();}"/>'+
    '<button onclick="ac2CfgAgregar(\''+tipo+'\')" style="font-size:11px; padding:4px 10px; margin-left:4px; background:#8BC34A; color:#fff; border:none; border-radius:4px; cursor:pointer;">＋ agregar</button>'+
    '</div>';
}
function ac2CfgCampoNum(label, campo, val, ayuda){
  return '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">'+
    '<label style="font-size:12px; color:#546e7a; min-width:260px;">'+label+'</label>'+
    '<input id="ac2cfg_'+campo+'" type="number" value="'+ac2Esc(val)+'" style="font-size:12px; width:90px; padding:2px 6px; border:1px solid #cfd8dc; border-radius:4px; text-align:right;"/>'+
    (ayuda?'<span style="font-size:10.5px; color:#b0bec5;">'+ayuda+'</span>':'')+'</div>';
}

window.ac2CfgAgregar=function(tipo){
  var inp=document.getElementById('ac2cfg_new_'+tipo); if(!inp) return;
  var v=(inp.value||'').trim(); if(!v) return;
  var lista=(tipo==='piso')?AC2_CFG.pisos:AC2_CFG.ciclos;
  if (lista.indexOf(v)<0) lista.push(v);
  inp.value=''; ac2CfgRender();
  var again=document.getElementById('ac2cfg_new_'+tipo); if(again) again.focus();
};
window.ac2CfgQuitar=function(tipo, v){
  var exist=(tipo==='piso')?AC2_CFG.existP:AC2_CFG.existC;
  if (exist[v]){ alert('"'+v+'" tiene barras; no se puede quitar. Para eliminarlo, primero limpia sus barras.'); return; }
  var lista=(tipo==='piso')?AC2_CFG.pisos:AC2_CFG.ciclos;
  var i=lista.indexOf(v); if(i>=0) lista.splice(i,1);
  ac2CfgRender();
};

window.ac2GuardarConfig=async function(){
  // Leer los factores de sus inputs (las listas ya están en AC2_CFG).
  var fp=parseFloat(document.getElementById('ac2cfg_factor_peso').value); if(isNaN(fp)) fp=0;
  var fe=parseFloat(document.getElementById('ac2cfg_factor_extremo').value); if(isNaN(fe)) fe=10;
  var li=parseFloat(document.getElementById('ac2cfg_largo_intermedio').value); if(isNaN(li)) li=100;
  var body={ pisos_plantilla:AC2_CFG.pisos, ciclos_plantilla:AC2_CFG.ciclos,
             factor_peso:fp, factor_extremo:fe, largo_intermedio:li };
  var r=await _ac2Put('/proyectos/'+encodeURIComponent(AC2.proyecto)+'/config', body);
  if (!r || !r.ok){ alert('No se pudo guardar la configuración.'); return; }
  // Reflejar en el creador: factores por defecto vigentes + pisos combinados para la grilla.
  AC2_FACTOR_EXTREMO=fe; AC2_LARGO_INTERMEDIO=li; AC2_CFG.factor_peso=fp;
  await _ac2CargarPisos();
  ac2CerrarConfig();
  alert('✅ Configuración de la obra guardada.');
};

// PUT sin prefijo /api/v1 (config va en raíz también, coherente con el resto).
async function _ac2Put(url, body){
  var tok=localStorage.getItem('armahub_token');
  var res=await fetch(url, { method:'PUT',
    headers: Object.assign({'Content-Type':'application/json'}, tok?{Authorization:'Bearer '+tok}:{}),
    body: JSON.stringify(body||{}) });
  var data=null; try{ data=await res.json(); }catch(e){}
  return res.ok ? Object.assign({ok:true}, data) : { ok:false, status:res.status, data:data };
}

// Init al cargar el módulo (el markup ya está en el DOM por el {% include %}). El loader
// del tab vuelve a correr al activarlo; ambas rutas son idempotentes.
function _ac2Init(){ if(document.getElementById('ac2_grid')){ _ac2InitComboboxes(); ac2PintarSectorEstructura(); ac2PintarSubtabs(); ac2SetTipo('TODOS'); _ac2CargarObras(); } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _ac2Init);
else _ac2Init();
