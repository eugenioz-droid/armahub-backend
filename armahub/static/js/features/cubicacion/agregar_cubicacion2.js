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
  render:true, tam:'m', tipo:'TODOS', orden:'piso', masiva:false, terminado:false, verMult:false,
  seleccion:{},    // { _id: true } — barras marcadas en modo masivo. Estado JS (NO en el DOM):
                   // así sobrevive a los re-renders de fila (antes se perdía → bug masivo).
  // Contexto real (vive en JS, no en el DOM):
  proyecto:null,   // id de la obra elegida (GET /filters → proyectos[].id)
  ciclo:'',        // ciclo elegido/escrito (texto libre)
  eje:'',          // eje/losa elegido/escrito (texto libre)
  sector:'',       // sector constructivo elegido (FUND/ELEV/VCIELO/LCIELO)
  estructura:'',   // estructura elegida (MURO/LOSA/VIGA/COLUMNA/FUNDACION/GENERAL)
  loteId:null,     // id GLOBAL del lote (para la API). null = aún no creado.
  loteNum:null,    // correlativo del lote DENTRO de la obra (lo que ve el usuario: #1, #2…)
  loteEstado:'',   // '' | 'borrador' | 'terminada'
  plano:'',        // M1.10: plano del despiece (edificio = un plano por lote/despiece)
  creando:false,   // flujo por etapas: true tras "Crear despiece" (etapa 2) hasta crear el lote o volver
  ctxFijado:false, // ciclo+eje confirmados con "Fijar" → habilita elegir Sector/Estructura (etapa 3)
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
// Estructuras VÁLIDAS por sector (regla del negocio): ELEV=vertical (muro/columna), LCIELO=losa,
// VCIELO=viga, FUND=fundación. GEN (GENERAL) sirve para todos. Evita combinaciones inconsistentes
// (ej. ELEV+Losa). Si un sector no está en el mapa, se permiten todas (fallback seguro).
var AC2_ESTRUCT_POR_SECTOR={
  ELEV:   ['MURO','COLUMNA','GEN'],
  LCIELO: ['LOSA','GEN'],
  VCIELO: ['VIGA','GEN'],
  FUND:   ['FUNDACION','GEN']
};
// ¿La estructura `e` es válida para el sector `s`? Sin sector elegido → todas (aún no filtra).
function ac2EstructValida(e, s){ if(!s) return true; var v=AC2_ESTRUCT_POR_SECTOR[s]; return !v || v.indexOf(e)>=0; }
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
// Resalte de color por diámetro para detectar de un vistazo un φ equivocado (p.ej. 18 donde iba 16).
// Rampa MONOCROMÁTICA azul-acero, de claro (φ fino) a oscuro (φ grueso): sobria, sin ruido cromático;
// los vecinos (16 vs 18, etc.) se distinguen por INTENSIDAD. El color va en la CELDA del φ (fondo), no
// en la fila, así no choca con el azul de "fila seleccionada" (celeste #e3f2fd, distinto del acero), el
// rosado de "inválida" ni el verde de "lote activo". Mapa fijo: mismo φ = mismo color, siempre.
var AC2_DIAM_COLOR={
  8:'#eceff1', 10:'#cfd8dc', 12:'#b0bec5', 16:'#90a4ae', 18:'#78909c',
  22:'#607d8b', 25:'#546e7a', 28:'#455a64', 32:'#37474f', 36:'#263238'
};
function ac2DiamColor(d){ return AC2_DIAM_COLOR[Number(d)] || ''; }
// Los tonos más oscuros (φ grueso) necesitan texto claro para leerse; los claros, texto oscuro.
var AC2_DIAM_TXT_CLARO={22:1, 25:1, 28:1, 32:1, 36:1};
function ac2DiamTexto(d){ return AC2_DIAM_TXT_CLARO[Number(d)] ? '#fff' : '#37474f'; }
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
            diam:null, cant:1, mult:1, figura:'', suf_tipo:'',
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
    // LIMPIEZA: al cambiar de figura, borrar los slots que la NUEVA figura NO usa. Si no, quedan
    // valores "pegados" de la figura anterior y ac2Validar los marca como inválidos ("sobran").
    // Ej: de 3 lados (a,b,c) a 2 (a,b) → borra dim_c; de 2 ángulos a 0 → borra ang1/ang2.
    var _nAng=(f.angulos||[]).length;
    AC2_DIMKEYS.forEach(function(k){ if(dims.indexOf(k)===-1) b[k]=null; });   // dims que no usa
    for (var _ia=0; _ia<4; _ia++){ if(_ia>=_nAng) b['ang'+(_ia+1)]=null; }     // ángulos sobrantes
    if (!f.radio) b.radio=null;                                                // radio si no aplica
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
// Cantidad TOTAL = cant × mult (solo para mostrar; el peso YA incluye este factor). Coincide con
// cant_total del backend (lotes.py) y del importador (CANT del CSV = total).
function ac2CantTotal(b){ return ac2Num((Number(b.cant)||0)*(Number(b.mult)||1)); }
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
    // Escalable = tiene tramos Y puntos dibujados (para tomar la orientación real), sin radio y sin
    // que las etiquetas SEAN los parámetros (etiquetas_manda). Antes se excluía escalable si había
    // CUALQUIER etiqueta, aunque fuera decorativa → figuras simples (ej. 101A recreada con una
    // etiqueta residual) mostraban la LETRA en vez del VALOR. Ahora solo las etiqueta-manda o con
    // radio caen al dibujo original (deuda 5N.27).
    var escalable=(tieneDims && geo.tramos && geo.tramos.length && geo.puntos && geo.puntos.length>=2
                   && !f.radio && !geo.etiquetas_manda);
    if (escalable){
      // PARAMÉTRICO SIN ROTAR: reconstruyo los PUNTOS conservando la DIRECCIÓN de cada segmento
      // original (de geo.puntos → mantiene la orientación de la figura dibujada) pero con la
      // LONGITUD nueva (dims). Reconstruir desde `tramos` puros rotaba la figura (siempre
      // arrancaba hacia la derecha). Así escala cada lado y no cambia la orientación.
      // LÍMITE A LADOS CHICOS: si un lado es enorme y otro diminuto, el motor escala todo al
      // viewport y el chico se pierde. Comprimimos el rango dando a cada lado un mínimo relativo
      // al lado más grande (AC2_MIN_LADO_REL). Se pierde algo de proporción realista (aceptado),
      // pero los lados chicos siguen siendo visibles.
      // todoCm: ¿TODOS los lados traen medida real? `escalable` NO sirve como interruptor
      // del grosor del trazo — se prende con UNA sola dim, y un lado sin medida conserva su
      // largo de GRILLA, con lo que la escala deja de ser px/cm y el φ daría un grosor
      // arbitrario (medido: dims vacías + φ32 daba 7.2 px donde tocaba el nominal 3.4).
      var largos=[], todoCm=true;
      for (var mi=0; mi<geo.tramos.length && mi+1<geo.puntos.length; mi++){
        var dxm=geo.puntos[mi+1].x-geo.puntos[mi].x, dym=geo.puntos[mi+1].y-geo.puntos[mi].y;
        var l0=Math.sqrt(dxm*dxm+dym*dym)||1;
        var vm=dims[geo.tramos[mi].lado];
        if (vm!=null && !isNaN(vm) && vm>0) { largos.push(Number(vm)); }
        else { largos.push(l0); todoCm=false; }   // cayó a grilla → ya no es px/cm
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
      geoUse.etiquetas=[];                                           // sin etiquetas decorativas sobre el valor
      // MOSTRAR EL VALOR en vez de la letra en cada lado.
      geoUse.tramos=geo.tramos.map(function(tr){
        var vv=dims[tr.lado]; var nt={}; for(var k2 in tr) nt[k2]=tr[k2];
        if (vv!=null) nt.lado=String(vv); return nt;
      });
    }
    try { return '<span style="display:inline-block; vertical-align:middle;">' +
      // Trazo = φ real solo si los puntos se reconstruyeron en cm (escalable); si no, el motor
      // cae al nominal (`scale` no sería px/cm). φ en mm, como lo guarda la barra.
      window.disenadorMotor.dibujarFigura(geoUse, dims, { width:t.w, height:t.h, pad:Math.round(Math.min(t.w,t.h)*0.22),
        diam_mm:b.diam, metrico:(escalable && todoCm) }) + '</span>'; }
    catch(e){}
  }
  // Fallback: la figura NO tiene geometría dibujada en el catálogo (o el motor no cargó). Antes
  // mostraba el código crudo (parecía "letras" = un error). Ahora muestra "sin dibujo" + el código
  // en chico, con tooltip, para que se entienda que hay que dibujarla en el Diseñador (Catálogo).
  var falta = b.figura ? ('sin dibujo · '+ac2Esc(b.figura)) : '▱';
  return '<span title="'+(b.figura?('La figura '+ac2Esc(b.figura)+' no tiene dibujo en el catálogo. Dibújala en el Diseñador (tab Catálogo).'):'')+'" style="display:inline-block; width:'+t.w+'px; height:'+t.h+'px; border:1px dashed #cfd8dc; border-radius:3px; vertical-align:middle; text-align:center; line-height:1.1; color:#b0bec5; font-size:8px; padding:2px; box-sizing:border-box; overflow:hidden;">'+falta+'</span>';
}

// Orden de marca para agrupar (las conocidas primero en su orden; el resto al final alfabético).
function ac2OrdMarca(m){ return (m in AC2_ORD_TIPO) ? AC2_ORD_TIPO[m] : 90; }
// Orden de piso según la plantilla de la obra (_ac2Pisos: S2,S1,P1..Pn,SM). Los que no están
// en la plantilla van al final. Respeta el orden lógico configurado, más el manual (ac2MoverGrupo).
// Orden de un piso: índice en el orden manual (flechas) o en _ac2Pisos, aplicando la dirección
// GLOBAL asc/desc (_ac2PisoDir). Los no encontrados van siempre al final.
function ac2OrdPiso(p){
  var base=(_ac2PisosOrden.length?_ac2PisosOrden:_ac2Pisos);
  var i=base.indexOf(p); if(i<0) return 999999;
  return _ac2PisoDir<0 ? (base.length-1-i) : i;   // desc = invierte el índice
}
var _ac2PisosOrden=[];   // orden manual de grupos de piso (flechas subir/bajar); vacío = usa _ac2Pisos
var _ac2PisoDir=1;       // dirección global del orden por piso: 1 = ascendente, -1 = descendente

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
  // Solo en modo masivo, el check MACRO al inicio: marca/desmarca TODAS las barras visibles.
  // Borde derecho para separarlo VISUALMENTE de la columna Piso (antes se confundían).
  if (AC2.masiva) h+='<th style="padding:3px 6px; text-align:center; width:22px; border-right:1px solid #e0e0e0;"><input type="checkbox" id="ac2_selTodo" onclick="ac2SelTodo(this)" title="Marcar/desmarcar todas"/></th>';
  // Header Piso: al ordenar por piso, iconos ▲/▼ para ordenar TODOS los pisos asc/descendente.
  // Iconos ▲/▼ SIEMPRE visibles en el header de Piso (en las 3 vistas). Al presionarlos se ordena
  // por piso asc/descendente (si estabas en Creación o Tipología, cambia a orden por piso). Se
  // resaltan según la dirección activa solo cuando la vista ya es por piso.
  var pisoActivo=(AC2.orden==='piso');
  var ordPiso='<span style="margin-left:6px; white-space:nowrap;">'+
    '<span onclick="ac2OrdenarPisos(1)" title="Ordenar por piso, ascendente" style="cursor:pointer; font-size:10px; color:'+((pisoActivo&&_ac2PisoDir>0)?'#8BC34A':'#b0bec5')+';">▲</span>'+
    '<span onclick="ac2OrdenarPisos(-1)" title="Ordenar por piso, descendente" style="cursor:pointer; font-size:10px; margin-left:2px; color:'+((pisoActivo&&_ac2PisoDir<0)?'#8BC34A':'#b0bec5')+';">▼</span></span>';
  h+='<th style="text-align:left; padding:3px 6px 3px '+(AC2.masiva?'12px':'6px')+';">Piso'+ordPiso+'</th>';
  if (mostrarTipo){
    h+='<th style="text-align:left; padding:3px 6px;">Tipología</th>';
    // Sufijo: texto libre que se CONCATENA a la tipología SOLO al exportar a aSa (no cambia la
    // tipología interna → dashboards sin inconsistencias). Va a la derecha de Tipología.
    h+='<th style="text-align:left; padding:3px 6px;" title="Sufijo que se concatena a la tipología SOLO al exportar (no altera la tipología del sistema)">Sufijo</th>';
  }
  // Cant (unitaria) · Mult · Cant.T (= cant×mult, solo lectura) · Largo · Peso Tot.
  h+='<th style="text-align:right; padding:3px 6px;">φ</th><th style="text-align:right; padding:3px 6px;">Cant</th>';
  if (AC2.verMult) h+='<th style="text-align:right; padding:3px 6px;" title="Multiplicador (doble/triple malla)">Mult</th>';
  h+='<th style="text-align:right; padding:3px 6px;" title="Cantidad total = Cant × Mult">Cant.T</th>';
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
function ac2Inp(id, campo, val, w, rojo, bloq){
  var wst = w ? ' style="width:'+w+'px;"' : '';
  // lote eliminado (histórico) o barra de una estructura del modelador → inputs bloqueados
  var ro = (ac2SoloLectura() || bloq) ? ' disabled' : '';
  return '<input type="number" value="'+(val==null?'':ac2Esc(val))+'" '+
    'class="ac2cell ac2nav'+(rojo?' rojo':'')+'" data-col="'+campo+'" data-row="'+id+'"'+wst+ro+' '+
    'onchange="ac2SetBarra('+id+',\''+campo+'\',this.value)" onkeydown="ac2NavKey(event,this)"/>';
}
// celda deshabilitada (la figura no usa ese slot).
function ac2CeldaOff(){ return '<td style="'+AC2_TDS+' background:#fafafa;"></td>'; }

// Navegación tipo Excel entre celdas editables (.ac2nav) de la grilla:
//   Tab / → / Enter  → siguiente celda a la DERECHA   ·  Shift+Tab / ←  → anterior
//   ↓ → misma columna, fila de abajo  ·  ↑ → fila de arriba
// Trabaja sobre el orden VISUAL de los inputs .ac2nav en el DOM y el nº de columnas por fila.
window.ac2NavKey=function(ev, el){
  var k=ev.key;
  var navKeys={'Tab':1,'ArrowRight':1,'ArrowLeft':1,'ArrowUp':1,'ArrowDown':1,'Enter':1};
  if (!navKeys[k]) return;
  // Datalist abierto (figura): ↑/↓ navegan la lista nativa; no interceptar.
  if ((k==='ArrowUp'||k==='ArrowDown') && el.getAttribute('list')) return;
  var grid=document.getElementById('ac2_grid'); if(!grid) return;
  var NAV='input.ac2nav, select.ac2nav';   // celdas navegables (inputs Y selects: piso/φ/marca)
  var target=null;
  if (k==='ArrowUp' || k==='ArrowDown'){
    // ↑↓: ir a la MISMA columna (data-col) de la fila anterior/siguiente. Robusto aunque las
    // filas tengan distinto nº de celdas (dims según figura).
    var col=el.getAttribute('data-col');
    var filas=[].slice.call(grid.querySelectorAll('tr[id^="ac2row_"]'));
    var trAct=el.closest('tr'); var fi=filas.indexOf(trAct);
    var dir=(k==='ArrowUp')?-1:1;
    for (var r=fi+dir; r>=0 && r<filas.length; r+=dir){
      var cand=filas[r].querySelector('input.ac2nav[data-col="'+col+'"], select.ac2nav[data-col="'+col+'"]');
      if (cand){ target=cand; break; }   // salta filas donde esa columna está deshabilitada
    }
  } else {
    // ←→/Tab/ENTER: celda anterior/siguiente en el orden visual del DOM (inputs y selects). Enter
    // avanza a la DERECHA igual que Tab (pedido del usuario). Shift+Tab/← retroceden.
    var inputs=[].slice.call(grid.querySelectorAll(NAV));
    var i=inputs.indexOf(el); if(i<0) return;
    var atras=(k==='ArrowLeft' || (k==='Tab'&&ev.shiftKey));
    var ni=atras? i-1 : i+1;
    if (ni>=0 && ni<inputs.length) target=inputs[ni];
    // Enter/Tab en la última celda: prevenir el default (submit/blur) para no perder el foco.
    if (!target && (k==='Enter'||k==='Tab')){ ev.preventDefault(); return; }
  }
  if (target){ ev.preventDefault(); target.focus(); if(target.select) target.select(); }
};

// FONDO + TÍTULO de una fila de la grilla — UNA sola escala de prioridades, en un solo lugar.
// La fila la pintan TRES caminos distintos (render completo ac2Fila, edición de una medida
// ac2ActualizarGeom y marcado masivo ac2PintarFilaSel); mientras cada uno traía su propia lista
// de colores, uno se quedaba atrás y el fondo terminaba MINTIENDO (el rosado "pegado" tras
// corregir una barra ya costó un fix). Con esta función los tres dicen lo mismo por construcción.
// Prioridad: el ERROR manda sobre el foco del usuario, el foco sobre el ORIGEN de la barra, y el
// origen sobre "ya está guardada" — una barra inválida tiene que verse aunque venga del
// Enfierrador y ya esté en la BD. Devuelve el título en CRUDO: quien lo meta en un atributo HTML
// es el que lo escapa (asignado a tr.title no se escapa nada).
function ac2EstiloFila(b, val){
  val = val || ac2Validar(b);
  if (b.figura && !val.ok)
    return { bg:'#fff5f5', tit:'Geometría inválida: revisa las celdas en rojo (faltan o sobran medidas para la figura '+(b.figura||'')+')' };
  if (AC2.masiva && AC2.seleccion[b._id])
    return { bg:'#e3f2fd', tit:'' };
  if (ac2BarraDeEstructura(b))
    return { bg:'#e1f5fe', tit:'Barra generada por el Enfierrador (estructura #'+b._instanciaId+'): se modifica reabriendo su estructura con 🧱.' };
  // "Guardada" va SIN título: en un despiece retomado lo están casi todas, y un tooltip que
  // salta en cada fila es ruido. Lo explica la leyenda fija del pie de la grilla.
  if (b._guardada)
    return { bg:'#f1f8e9', tit:'' };
  return { bg:'', tit:'' };
}

function ac2Fila(b){
  var mostrarTipo=(AC2.tipo==='TODOS');
  var info = b.figura ? ac2DimsDeFigura(b.figura) : {dims:[],angs:0,radio:false};
  var val = ac2Validar(b);                          // {ok, rojas:{campo:1}}
  var td='<td style="'+AC2_TDS+'">';
  var tdr='<td style="'+AC2_TDS+' text-align:right;">';
  // Celda de dato con input; el input se marca ROJO (clase) si el campo está inválido.
  var bloq = ac2BarraDeEstructura(b);   // barra nacida del Enfierrador: solo lectura
  var dis = bloq ? ' disabled' : '';
  var tdDato=function(campo,w){ return '<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,campo,b[campo],w,!!val.rojas[campo],bloq)+'</td>'; };
  // Fondo/título de la fila: la escala completa vive en ac2EstiloFila (rosado inválida > celeste
  // seleccionada > azul Enfierrador > verde guardada > blanco). Se reusa la validación ya
  // calculada arriba para no validar la misma barra dos veces por fila.
  var est = ac2EstiloFila(b, val);
  var trStyle = est.bg ? ' style="background:'+est.bg+';"' : '';
  var trTitle = est.tit ? ' title="'+ac2Esc(est.tit)+'"' : '';
  var h='<tr id="ac2row_'+b._id+'"'+trStyle+trTitle+'>';
  // data-grp = valor del campo por el que se agrupa (piso o marca), para que el maestro del
  // header de grupo encuentre a sus hijos. En "creación" (sin agrupar) no hay maestro, da igual.
  if (AC2.masiva){ var gc=ac2AgrupaPor(); var grpVal=(gc==='piso')?(b.piso||''):b.marca;
    h+='<td style="'+AC2_TDS+' text-align:center; border-right:1px solid #e0e0e0;"><input type="checkbox" class="ac2sel" data-grp="'+ac2Esc(grpVal)+'" data-id="'+b._id+'"'+(AC2.seleccion[b._id]?' checked':'')+' onclick="ac2SelFila(this)"/></td>'; }
  // Piso: <select> con los pisos configurados de la obra. Si la barra trae un piso que no está
  // en la lista (ej. retomado de un lote), se agrega como opción para no perderlo.
  var pisosOps=_ac2Pisos.slice();
  if (b.piso && pisosOps.indexOf(b.piso)<0) pisosOps.unshift(b.piso);
  var opPiso='<option value=""'+(b.piso?'':' selected')+'>—</option>'+
    pisosOps.map(function(p){ return '<option'+(p===b.piso?' selected':'')+'>'+ac2Esc(p)+'</option>'; }).join('');
  // Piso OBLIGATORIO: si la barra ya tiene figura pero le falta el piso, se resalta en rojo (igual
  // que las medidas faltantes) para que el cubicador vea que debe elegirlo antes de guardar/revisar.
  var _pisoFalta = (b.figura && !ac2TienePiso(b));
  h+='<td style="'+AC2_TDS+(AC2.masiva?' padding-left:12px;':'')+'"><select'+dis+' class="ac2cell ac2nav'+(_pisoFalta?' rojo':'')+'" data-col="piso" data-row="'+b._id+'" style="width:56px; text-align:left;'+(_pisoFalta?' background:#ffebee;':'')+'" onchange="ac2SetBarra('+b._id+',\'piso\',this.value)" onkeydown="ac2NavKey(event,this)">'+opPiso+'</select></td>';
  // Tipología (marca) — select solo en TODOS; en un subtab está implícita. Opción vacía para
  // barras nuevas sin tipología aún (en TODOS nacen sin marca; el cubicador la elige acá).
  if (mostrarTipo){
    var op='<option value=""'+(b.marca?'':' selected')+'>— tipo —</option>'+
      AC2_TIPOS.map(function(m){return '<option'+(m===b.marca?' selected':'')+'>'+m+'</option>';}).join('');
    h+='<td style="'+AC2_TDS+'"><select'+dis+' class="ac2cell ac2nav" data-col="marca" data-row="'+b._id+'" onchange="ac2SetBarra('+b._id+',\'marca\',this.value)" onkeydown="ac2NavKey(event,this)" style="font-size:11px; padding:1px 2px;">'+op+'</select></td>';
    // Sufijo de tipología: texto libre. Se concatena a la tipología SOLO al exportar (aSa); NO
    // altera b.marca. Estado en b.suf_tipo. Input directo (no re-render).
    h+='<td style="'+AC2_TDS+'"><input type="text"'+dis+' value="'+ac2Esc(b.suf_tipo||'')+'" maxlength="20" class="ac2cell ac2nav" data-col="suf_tipo" data-row="'+b._id+'" style="width:56px; font-size:11px; padding:1px 3px;" onchange="ac2SetBarra('+b._id+',\'suf_tipo\',this.value)" onkeydown="ac2NavKey(event,this)" placeholder="—" title="Se concatena a la tipología solo al exportar"/></td>';
  }
  // φ (diámetro) — select de lista fija, navegable con teclado. Cada <option> lleva SU color (así el
  // desplegable ayuda a elegir, no toma el del actual). El estilado de <option> depende del navegador;
  // si lo ignora, cae a blanco (fallback limpio). La celda cerrada sí muestra el color del φ actual.
  var opd='<option value="" style="background:#fff; color:#37474f;"></option>'+
    AC2_DIAMS.map(function(d){ var c=ac2DiamColor(d);
      return '<option'+(Number(b.diam)===d?' selected':'')+' style="background:'+(c||'#fff')+'; color:'+ac2DiamTexto(d)+';">'+d+'</option>'; }).join('');
  var _dcol=ac2DiamColor(b.diam);
  h+='<td style="'+AC2_TDS+' text-align:right;"><select'+dis+' class="ac2cell ac2nav" data-col="diam" data-row="'+b._id+'" onchange="ac2SetBarra('+b._id+',\'diam\',this.value)" onkeydown="ac2NavKey(event,this)" style="font-size:11px; padding:1px 2px;'+(_dcol?' background:'+_dcol+'; color:'+ac2DiamTexto(b.diam)+'; font-weight:600;':'')+'">'+opd+'</select></td>';
  // Cant (unitaria) · Mult (multiplicador) · Cant.T (= cant×mult, SOLO LECTURA — no re-multiplica
  // el peso, que ya usa cant×mult; solo informa el total).
  // 56px (= .ac2cell, como las dims): con 40 una cantidad de 3+ cifras se CORTABA.
  h+='<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,'cant',b.cant,56,false,bloq)+'</td>';
  if (AC2.verMult) h+='<td style="'+AC2_TDS+' text-align:right;">'+ac2Inp(b._id,'mult',b.mult,56,false,bloq)+'</td>';
  h+='<td id="ac2cantt_'+b._id+'" style="'+AC2_TDS+' text-align:right; color:#607d8b; font-weight:600;">'+ac2CantTotal(b)+'</td>';
  // Largo (calculado en vivo) — solo lectura, id para actualización granular.
  h+='<td id="ac2largo_'+b._id+'" style="'+AC2_TDS+' text-align:right; color:#1565c0; font-weight:600;">'+ac2Num(ac2Largo(b))+'</td>';
  // Peso (calculado en vivo) — solo lectura. Si hay largo pero falta φ, muestra "—" (falta φ).
  h+='<td id="ac2peso_'+b._id+'" style="'+AC2_TDS+' padding-right:10px; text-align:right; color:#558B2F; font-weight:600;">'+ac2PesoTxt(b)+'</td>';
  // Figura (input+datalist del catálogo). Cambiarla re-renderiza SOLO la fila (cambian las dims).
  h+='<td style="'+AC2_TDS+' padding-left:14px; border-left:1px solid #eee;"><input type="text"'+dis+' list="ac2_figDatalist" value="'+ac2Esc(b.figura)+'" class="ac2cell ac2nav" data-col="figura" data-row="'+b._id+'" style="width:54px; text-align:left;" onchange="ac2SetBarra('+b._id+',\'figura\',this.value)" onkeydown="ac2NavKey(event,this)" placeholder="fig"/></td>';
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
  // Acciones por fila. Una barra de estructura no se agrega, ni se duplica, ni se
  // quita suelta: su única acción es REABRIR la estructura que la generó.
  if (bloq){
    h+='<td style="'+AC2_TDS+' white-space:nowrap;">'+
       '<span onclick="ac2AbrirEditor3D('+b._instanciaId+')" title="Abrir la estructura que generó esta barra" style="cursor:pointer; margin-right:6px;">🧱</span>'+
       '<span title="Barra generada por el Enfierrador: se modifica reabriendo su estructura" style="color:#90a4ae;">🔒</span></td></tr>';
  } else {
    h+='<td style="'+AC2_TDS+' white-space:nowrap;">'+
       '<span onclick="ac2CopiarTipologia('+b._id+')" title="Agregar barra '+ac2Esc(b.marca)+' debajo" style="color:#558B2F; cursor:pointer; font-weight:700; margin-right:6px;">＋</span>'+
       '<span onclick="ac2Duplicar('+b._id+')" title="Duplicar" style="color:#1565c0; cursor:pointer; margin-right:6px;">⎘</span>'+
       '<span onclick="ac2Quitar('+b._id+')" title="Quitar" style="color:#c62828; cursor:pointer;">✕</span></td></tr>';
  }
  return h;
}

// Header de grupo. porPiso=true muestra flechas para reordenar el grupo (subir/bajar). El check
// maestro de grupo (masiva) se genera con data-grp = valor del grupo.
function ac2GrupoHdr(valor, cnt, porPiso){
  // Columnas: [masiva] + Piso + [Tipología + Sufijo] + φ,Cant,[Mult],Cant.T,Largo,PesoTot,Figura(6+mult)
  //           + [Dibujo] + 9 lados + 4 áng + R + Rev + acciones.
  var cols = (AC2.masiva?1:0) + 1 + (AC2.tipo==='TODOS'?2:0) + 6 + (AC2.verMult?1:0) + (AC2.render?1:0) + 9 + 4 + 1 + 1 + 1;
  // Flechas para reordenar el PISO completo (solo en modo agrupado-por-piso). Botones claros con
  // texto "mover piso" para que se entienda que actúan sobre el grupo, no sobre una fila.
  var b=function(dir,fl,tit){ return '<button onclick="ac2MoverGrupo(\''+ac2Esc(valor)+'\','+dir+')" title="'+tit+'" '+
    'style="font-size:11px; line-height:1; padding:2px 6px; margin-left:4px; background:#fff; color:#558B2F; border:1px solid #8BC34A; border-radius:3px; cursor:pointer;">'+fl+'</button>'; };
  var flechas = porPiso
    ? '<span style="float:right; white-space:nowrap; font-weight:400;"><span style="font-size:10px; color:#78909c; margin-right:2px;">mover piso</span>'+
      b(-1,'▲','Subir este piso')+b(1,'▼','Bajar este piso')+'</span>'
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
  // Lote ELIMINADO (histórico): grilla en gris y TODOS los controles bloqueados (solo consulta).
  if (ac2SoloLectura()){
    cont.style.opacity='0.75';
    cont.querySelectorAll('input,select,button').forEach(function(el){ el.disabled=true; });
  } else { cont.style.opacity=''; }
  ac2ActualizarContadores();                        // rollup + revisadas + inválidas (una sola fuente)
  if (AC2.masiva){ ac2SelSyncMaestros(); ac2SelResumen(); }   // refresca contador/maestros/macro desde el estado
  // El elemento ac2_ctx fue removido del layout: solo actualizarlo si existe (antes esta línea
  // hacía innerHTML sobre null → TypeError que ABORTABA ac2Render a la mitad y dejaba la UI y la
  // validación inconsistentes: la X no limpiaba, botones colgados, barras no se revalidaban).
  var cx=document.getElementById('ac2_ctx'); if(cx) cx.innerHTML=ac2CtxText();
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
// Sector/Estructura NO se pueden tocar hasta CREAR el lote (antes se podían elegir sueltos, sin
// contexto). Y quedan bloqueados si ya hay barras o el lote está terminado (no se puede cambiar
// el sector de un lote con barras → rompería el modelo).
// Sector/Estructura se BLOQUEAN cuando el despiece ya tiene barras (para no cambiar su ubicación con
// data dentro) o está terminado/eliminado. En el FLUJO NUEVO se pueden elegir ANTES de que exista el
// lote (etapa 3: ciclo+eje listos, sin lote) → justamente al elegirlos se crea el lote. Por eso ya no
// se bloquea por "no hay lote"; solo por barras presentes o estado cerrado.
function ac2Bloqueado(){ return (AC2.barras.length>0) || AC2.loteEstado==='terminada' || AC2.loteEstado==='eliminado'; }
// Solo-lectura DURA: un lote eliminado es histórico congelado; no se edita nada de su grilla.
function ac2SoloLectura(){ return AC2.loteEstado==='eliminado'; }
// BARRA DE UNA ESTRUCTURA DEL MODELADOR: se ve, no se toca. Es el resultado de una
// receta — editarla suelta dejaría la estructura diciendo una cosa y el despiece otra,
// y la próxima regeneración pisaría el cambio sin avisar. Se modifica REABRIENDO la
// estructura en el Enfierrador (el botón 🧱 de la fila). El backend hace lo mismo:
// DELETE /lotes/{id}/barras/{id} responde 409 para estas barras.
// NO cubre el check de REVISADA: esa marca es del cubicador y el sync la conserva.
// EL DATO DE RAÍZ ES EL VÍNCULO A LA INSTANCIA (_instanciaId), no la etiqueta _origen: en la
// misma columna conviven 'template' (las históricas) y 'enfierrador' (las nuevas), y mañana
// puede aparecer otra etiqueta. Mirar el origen dejaba fuera del candado a barras que SÍ
// pertenecen a una estructura — el candado tiene que seguir al vínculo, que es el que hace
// que la próxima regeneración las pise.
function ac2BarraDeEstructura(b){ return !!(b && b._instanciaId!=null); }
// Reconcilia el TEXTO visible de los comboboxes de ciclo/eje hacia el estado. Necesario porque el
// combobox solo copia su texto a AC2 en el blur (con delay); si el usuario hace clic en un botón
// antes del blur, el texto se perdía (causa de lotes guardados sin ciclo/eje). Llamar SIEMPRE
// antes de crear el lote o guardar.
function _ac2LeerContexto(){
  if (_ac2CbCiclo){ var c=_ac2CbCiclo.getTexto(); if(c!=null) AC2.ciclo=String(c).trim(); }
  if (_ac2CbEje){   var e=_ac2CbEje.getTexto();   if(e!=null) AC2.eje=String(e).trim(); }
}

function ac2PintarSectorEstructura(){
  var bloq=ac2Bloqueado();
  var chip=function(txt,activo,onclick){
    var base='font-size:12px; padding:4px 12px; border-radius:14px; font-weight:600; margin:0;';
    if (activo) return '<span style="'+base+' border:1px solid #1565C0; background:#1565C0; color:#fff;">'+ac2Esc(txt)+'</span>';
    if (bloq)   return '<span style="'+base+' border:1px dashed #cfd8dc; background:#fff; color:#cfd8dc; cursor:not-allowed;">'+ac2Esc(txt)+'</span>';
    return '<button onclick="'+onclick+'" style="'+base+' border:1px solid #90a4ae; background:#fff; color:#546e7a; cursor:pointer;">'+ac2Esc(txt)+'</button>';
  };
  // Chip DESHABILITADO (no aplica): gris tenue, no clickeable (distinto del "bloqueado por barras").
  var chipOff=function(txt,tit){ var base='font-size:12px; padding:4px 12px; border-radius:14px; font-weight:600; margin:0;';
    return '<span title="'+ac2Esc(tit||'')+'" style="'+base+' border:1px solid #eceff1; background:#f7f8f9; color:#cfd8dc; cursor:not-allowed;">'+ac2Esc(txt)+'</span>'; };
  var sc=document.getElementById('ac2_sectorChips');
  if (sc) sc.innerHTML=AC2_SECTORES.map(function(s){ return chip(s, AC2.sector===s, "ac2SetSector('"+s+"')"); }).join(' ');
  var ec=document.getElementById('ac2_estructChips');
  if (ec) ec.innerHTML=AC2_ESTRUCTURAS.map(function(e){
    var lbl=(e==='GEN'?'GENERAL':e);
    // Estructura no válida para el sector elegido → chip deshabilitado (regla ELEV/LCIELO/VCIELO/FUND).
    if (AC2.sector && !ac2EstructValida(e, AC2.sector)) return chipOff(lbl, 'No aplica a '+AC2.sector);
    return chip(lbl, AC2.estructura===e, "ac2SetEstructura('"+e+"')");
  }).join(' ');
  var lk=document.getElementById('ac2_sectorLock');
  if (lk) lk.textContent = bloq ? '🔒 bloqueado (hay barras) — para cambiar, descarta/elimina el despiece' : '';
  ac2PintarPlano();   // M1.10: el plano vive en esta misma fila
}
window.ac2SetSector=function(s){ if(ac2Bloqueado()) return;
  AC2.sector=s;
  // Si la estructura ya elegida NO aplica al nuevo sector, se resetea (evita ELEV+Losa colgado).
  if (AC2.estructura && !ac2EstructValida(AC2.estructura, s)){ AC2.estructura=''; AC2_TIPOS=[]; ac2PintarSubtabs(); }
  ac2PintarSectorEstructura(); ac2ActualizarBotonesCrear();
};
window.ac2SetEstructura=function(e){
  if(ac2Bloqueado()) return;
  if(!ac2EstructValida(e, AC2.sector)){ return; }   // defensa: no permitir una estructura inválida para el sector
  AC2.estructura=e;
  // Las tipologías (subtabs) dependen de la estructura (en su orden funcional del catálogo).
  AC2_TIPOS=(AC2_TIPOS_MAP[e]||[]).map(function(t){return t.codigo;});
  AC2_ORD_TIPO={}; AC2_TIPOS.forEach(function(t,i){ AC2_ORD_TIPO[t]=i; });
  ac2PintarSectorEstructura(); ac2PintarSubtabs();
  // Entrar por defecto a la PRIMERA tipología (no a TODOS) → los botones de crear ya quedan
  // habilitados y el flujo es directo. Si la estructura no tuviera tipologías, cae a TODOS.
  ac2SetTipo(AC2_TIPOS.length ? AC2_TIPOS[0] : 'TODOS');
  // FLUJO POR ETAPAS: el lote se crea AHORA (al completar sector+estructura), NO al presionar "Crear
  // despiece" con solo ciclo+eje. Así el despiece nunca aparece en el histórico sin su ubicación
  // completa (ciclo+eje+sector). Solo si aún no hay lote y el contexto está completo.
  if (!AC2.loteId && AC2.proyecto && AC2.ciclo && AC2.eje && AC2.sector && AC2.estructura){
    ac2CrearLote();
  }
};

// ── M1.10 · PLANO del despiece (chip fijo ↔ input editable) ──────────────────
// Estado en AC2.plano. Se pinta como chip verde (parece fijo); click en el chip lo
// vuelve editable; al salir/Enter se fija y persiste. Solo editable en borrador.
function ac2PintarPlano(){
  var inp=document.getElementById('ac2_planoInput'), chip=document.getElementById('ac2_planoChip');
  if(!inp||!chip) return;
  var editable = AC2.loteEstado==='borrador' || !AC2.loteId;
  var val=(AC2.plano||'').trim();
  if (val){
    chip.textContent='📄 '+val;
    chip.style.display='inline-block';
    chip.style.cursor=editable?'pointer':'default';
    chip.title=editable?'Click para editar el plano':'Plano fijo (despiece terminado)';
    inp.style.display='none';
  } else {
    // sin plano aún: input visible si editable, nada si no
    chip.style.display='none';
    inp.style.display=editable?'inline-block':'none';
  }
}
window.ac2EditarPlano=function(){
  if (!(AC2.loteEstado==='borrador' || !AC2.loteId)) return;   // terminado = fijo de verdad
  var inp=document.getElementById('ac2_planoInput'), chip=document.getElementById('ac2_planoChip');
  if(!inp||!chip) return;
  inp.value=AC2.plano||''; chip.style.display='none'; inp.style.display='inline-block'; inp.focus(); inp.select();
};
window.ac2FijarPlano=async function(){
  var inp=document.getElementById('ac2_planoInput'); if(!inp) return;
  var nuevo=(inp.value||'').trim().slice(0,60);
  if (nuevo===(AC2.plano||'')){ ac2PintarPlano(); return; }   // sin cambio
  AC2.plano=nuevo;
  ac2PintarPlano();
  // Persistir si ya hay lote (si aún no, se guarda al crearlo — ver ac2CrearLote).
  if (AC2.loteId && AC2.loteEstado==='borrador'){
    var r=await _ac2Patch('/lotes/'+AC2.loteId+'/plano', { plano:nuevo });
    if (!r.ok){ alert('No se pudo guardar el plano.'); }
  }
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

// Habilita ＋barra/＋barras M solo con LOTE creado + sector + estructura + un subtab (no TODOS).
function ac2ActualizarBotonesCrear(){
  var puede = AC2.loteId && AC2.sector && AC2.estructura && AC2.tipo!=='TODOS' && AC2.loteEstado!=='terminada';
  ['ac2_barraBtn','ac2_barrasMBtn'].forEach(function(bid){
    var btn=document.getElementById(bid); if(!btn) return;
    btn.disabled=!puede; btn.style.opacity=puede?'1':'0.45'; btn.style.cursor=puede?'pointer':'not-allowed';
    btn.title=puede?'':(!AC2.loteId?'Crea el lote primero (Obra, Ciclo y Eje).':(!AC2.sector||!AC2.estructura?'Elige Sector y Estructura primero.':'Entra a una tipología (no TODOS) para agregar barras.'));
  });
}

// Cabecera del formulario según haya lote o no:
//  - SIN lote: se muestra "🆕 Crear lote" (pintado vivo si obra+ciclo+eje listos) y se ocultan
//    guardar/terminar/eliminar (no hay lote sobre el cual actuar).
//  - CON lote: se ocultan Crear lote; se muestran 💾 guardar, 🚩 terminar, ✕ descartar y 🗑 eliminar.
// En lote TERMINADO/bloqueado, la única acción real es 🗑 Eliminar (el resto queda deshabilitado).
function ac2ActualizarCabecera(){
  var hayLote=!!AC2.loteId, terminado=(AC2.loteEstado==='terminada'), eliminado=(AC2.loteEstado==='eliminado');
  var show=function(id,on){ var el=document.getElementById(id); if(el) el.style.display=on?'':'none'; };
  var dis=function(id,off){ var el=document.getElementById(id); if(!el) return; el.disabled=off; el.style.opacity=off?'0.45':'1'; el.style.cursor=off?'not-allowed':'pointer'; };
  // Botón Crear lote: visible solo sin lote; pintado vivo si la ubicación está completa.
  // Leemos las 3 fuentes DIRECTO del DOM/estado en el momento (no dependemos de que los eventos
  // onElegir/onInput hayan corrido antes): obra del BuscadorObra, ciclo/eje del texto visible.
  _ac2LeerContexto();
  if (_ac2CbObra){ var oid=_ac2CbObra.getId(); if(oid) AC2.proyecto=oid; }
  var listo = AC2.proyecto && AC2.ciclo && AC2.eje;
  var crear=document.getElementById('ac2_crearLoteBtn');
  if (crear){
    crear.style.display=hayLote?'none':'';
    crear.style.background=listo?'#8BC34A':'#eceff1';
    crear.style.color=listo?'#fff':'#90a4ae';
    crear.style.cursor=listo?'pointer':'not-allowed';
    crear.title=listo?'Crear el despiece y empezar a cubicar':'Completa Obra, Ciclo y Eje/Losa.';
  }
  show('ac2_bandera', hayLote && !eliminado); show('ac2_guardarBtn', hayLote && !eliminado);
  show('ac2_descartarBtn', hayLote);   // la X (cerrar/volver) sigue disponible siempre
  show('ac2_eliminarBtn', hayLote && !eliminado);   // ya eliminado → no se puede re-eliminar
  // 🧱 3D Template (Modelador): visible en un despiece BORRADOR (donde se pueden agregar barras).
  show('ac2_modelador3dBtn', hayLote && !eliminado && !terminado);
  // Editar ciclo/eje: en un despiece BORRADOR (con o sin barras) se puede corregir la ubicación. Con
  // barras es más delicado (reasigna todas), pero también sin barras (recién creado). En
  // terminado/eliminado no aplica.
  var borradorEditable = hayLote && AC2.loteEstado==='borrador';
  if (borradorEditable && _ac2ModoCorregir){
    // En plena corrección: ocultar "Editar", mostrar Aplicar/Cancelar, mantener resalte.
    show('ac2_reasignarBtn', false); show('ac2_reasignarAplicarBtn', true); show('ac2_reasignarCancelarBtn', true);
    _ac2LockContexto(false);
  } else {
    // Fuera de corrección: borrador → candado en ciclo/eje + botón "Editar ciclo/eje".
    if (_ac2ModoCorregir){ _ac2ModoCorregir=false; _ac2HighlightContexto(false); var _h=document.getElementById('ac2_corregirHint'); if(_h) _h.style.display='none'; }
    show('ac2_reasignarBtn', borradorEditable); show('ac2_reasignarAplicarBtn', false); show('ac2_reasignarCancelarBtn', false);
    var _rb=document.getElementById('ac2_reasignarBtn'); if(_rb) _rb.textContent='✎ Editar ciclo/eje';
    _ac2LockContexto(borradorEditable);
  }
  // En terminado, guardar/terminar quedan inertes; Eliminar sigue vivo. En eliminado, todo inerte
  // salvo la X (para salir y crear otro lote).
  dis('ac2_guardarBtn', terminado); dis('ac2_bandera', terminado);
  // Flujo por etapas: tras ajustar la cabecera, decidir qué BLOQUES se muestran según la etapa.
  ac2AplicarEtapa();
}

// ── FLUJO POR ETAPAS (revelación progresiva) ──────────────────────────────────────────────────
// Deriva la etapa (0-4) del estado YA existente (no inventa fuentes de verdad) y muestra/oculta los
// BLOQUES del editor según corresponda. No toca el cableado de ningún control: la lógica fina de cada
// control (botones de estado, masiva, corregir eje/ciclo) sigue en ac2ActualizarCabecera; la etapa
// solo decide si el bloque contenedor está visible. Ver docs/programa_flujo_editor_despieces.md.
//  0 landing        : sin obra
//  1 obra sin lote  : obra elegida, sin lote abierto (retomar histórico o crear)
//  2 creando ctx    : presionó "Crear despiece", aún sin ciclo+eje
//  3 ctx listo      : ciclo+eje completos, aún sin lote creado
//  4 editor         : lote abierto/creado
function ac2Etapa(){
  if (!AC2.proyecto) return 0;
  if (AC2.loteId) return 4;
  if (!AC2.creando) return 1;
  // Etapa 3 (elegir Sector/Estructura) recién cuando ciclo+eje están listos Y FIJADOS (botón Fijar).
  // Así el usuario confirma las coordenadas antes de que aparezca el sector; hasta entonces, etapa 2.
  var ctxListo = (AC2.ciclo && String(AC2.ciclo).trim() && AC2.eje && String(AC2.eje).trim());
  return (ctxListo && AC2.ctxFijado) ? 3 : 2;
}
function ac2AplicarEtapa(){
  var e = ac2Etapa();
  // show(id, on, disp): al MOSTRAR usa el display correcto (por defecto '' = block; para los
  // contenedores flex hay que pasar 'flex', si no style.display='' los resetea a block y rompe el
  // layout en línea de la fila de contexto). Al ocultar, 'none'.
  var show=function(id,on,disp){ var el=document.getElementById(id); if(el) el.style.display=on?(disp||''):'none'; };
  // Gráfico: solo en la landing (etapa 0, todas las obras) y en la obra elegida (etapa 1, esa obra).
  // Al iniciar la creación de un despiece (etapa 2+) DESAPARECE → foco en crear. Lista de obras: etapa 0.
  show('ac2_grafico', e<=1);
  show('ac2_landingObras', e===0);
  // Botón "Crear despiece" (landing): solo etapa 1. Volver a obras: etapas 1-3 (en 4 la ✕ hace de volver).
  show('ac2_crearDespieceWrap', e===1);
  show('ac2_volverObras', e>=1 && e<=3);
  // Fila de contexto (caja turquesa): SIEMPRE con su fondo. Es un contenedor FLEX (campos en línea);
  // por eso se muestra con 'flex'. Los divs de campo (ac2_fld*) también son flex-column → 'flex'.
  var _ctxDesde2 = (e>=2);
  show('ac2_filaContexto', true, 'flex');
  show('ac2_fldObra', e<=1, 'flex');
  // En la landing el campo obra es un BUSCADOR (elegir obra); el label lo refleja.
  var _lbl=document.getElementById('ac2_lblObra'); if(_lbl) _lbl.textContent = (e===0) ? 'Buscar obra' : 'Obra';
  show('ac2_fldCiclo', _ctxDesde2, 'flex');
  show('ac2_fldEje', _ctxDesde2, 'flex');
  // El botón "Crear despiece" de la fila de contexto YA NO se usa (el lote se crea al elegir
  // sector+estructura). Oculto siempre.
  var _crear=document.getElementById('ac2_crearLoteBtn'); if(_crear) _crear.style.display='none';
  // Flujo de creación (sin lote): en etapa 2, si ciclo+eje están listos → botón "✓ Fijar" (confirma y
  // habilita elegir sector); si falta ciclo/eje → hint. Al fijar → etapa 3 (sector visible), sin botón.
  var _ctxListo = (AC2.ciclo && String(AC2.ciclo).trim() && AC2.eje && String(AC2.eje).trim());
  var _fijar=document.getElementById('ac2_fijarBtn');
  var _hint=document.getElementById('ac2_ctxHint');
  if (_fijar) _fijar.style.display = (e===2 && _ctxListo) ? '' : 'none';
  if (_hint)  _hint.style.display  = (e===2 && !_ctxListo) ? '' : 'none';
  var _cfg=document.getElementById('ac2_cfgBtn'); if(_cfg) _cfg.style.display=_ctxDesde2?'':'none';
  // Sector/Estructura: etapas 3-4. Tipologías, toolbar, grilla, rollup: solo editor (4). Todos son
  // contenedores FLEX en su HTML original → se muestran con 'flex' (el grid es block normal).
  show('ac2_filaSector', e>=3, 'flex');
  show('ac2_filaTipologia', e===4, 'flex');   // fila con subtabs de tipología + campo Plano
  show('ac2_toolbar', e===4, 'flex');
  show('ac2_grid', e===4);            // grid: div block normal
  show('ac2_rollupWrap', e===4, 'flex');
  // Histórico de despieces: protagonista en etapa 1, y visible también en el editor (4) como hoy.
  show('ac2_historicoWrap', e===1 || e===4);
  // Título: nombre de la obra desde etapa 1; genérico en la landing.
  var tit = document.getElementById('ac2_tituloObra');
  if (tit) tit.textContent = (e>=1 && AC2._nombreObra) ? ('📋 ' + AC2._nombreObra) : '📋 Despiece de Cubicación';
}
// "Crear despiece" (etapa 1 → 2): abre el flujo de creación (aparecen Ciclo/Eje). Parte NO fijado.
window.ac2IniciarCreacion=function(){ AC2.creando=true; AC2.ctxFijado=false; ac2ActualizarCabecera(); };
// "✓ Fijar ciclo/eje" (etapa 2 → 3): confirma ciclo+eje, los bloquea y habilita elegir Sector/Estructura.
window.ac2FijarContexto=function(){
  _ac2LeerContexto();   // vuelca el texto visible de ciclo/eje al estado
  if (!AC2.ciclo || !String(AC2.ciclo).trim() || !AC2.eje || !String(AC2.eje).trim()){
    alert('Completa Ciclo y Eje/Losa antes de fijar.'); return;
  }
  AC2.ctxFijado=true;
  _ac2LockContexto(true);        // bloquea ciclo/eje (candado); "Editar" los desbloquea después
  ac2ActualizarCabecera();
};
// Landing: TODAS las obras que tienen despieces (para retomar/ver). Para crear en una obra SIN
// despieces se usa el buscador de arriba (encuentra cualquier obra). Al click en una fila → etapa 1.
window.ac2CargarLandingObras=async function(){
  var tb=document.getElementById('ac2_landingObrasBody'); if(!tb) return;
  var d; try { d=await _ac2Get('/despieces/obras-activas'); } catch(e){ d=null; }
  var obras=(d&&d.obras)||[];
  if (!obras.length){
    tb.innerHTML='<tr><td colspan="6" style="padding:10px 8px; color:#90a4ae; font-style:italic; text-align:center;">Aún no hay obras con despieces. Busca una obra arriba para crear el primero.</td></tr>';
    return;
  }
  tb.innerHTML=obras.map(function(o){
    // Columna "Despieces": total + cuántos en edición (borrador). Ej. "3 (2 en edición)".
    var enEd = o.en_edicion||0;
    var despTxt = (o.total||0) + (enEd ? ' <span style="color:#e65100;">('+enEd+' en edición)</span>' : '');
    return '<tr class="ac2loterow" onclick="ac2ElegirObraLanding('+"'"+ac2Esc(o.id_proyecto)+"','"+ac2Esc((o.nombre||'').replace(/'/g,"\\'"))+"'"+')" style="cursor:pointer; border-top:1px solid #f0f0f0;">'+
      '<td style="padding:6px 8px; font-weight:600; color:#558B2F;">'+ac2Esc(o.nombre||o.id_proyecto)+'</td>'+
      '<td style="padding:6px 8px;">'+despTxt+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+(o.items||0)+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+ac2Num(o.barras||0)+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+ac2Num(o.kg,1)+'</td>'+
      '<td style="padding:6px 8px; color:#888;">'+ac2Esc(o.ultimo||'')+'</td>'+
    '</tr>';
  }).join('');
};
// Click en una obra de la landing: setea la obra (mismo efecto que elegirla en el buscador) → etapa 1.
window.ac2ElegirObraLanding=function(idProyecto, nombre){
  // Sincronizar el buscador de obra (input visible + select oculto), para que getId() devuelva la obra
  // y ac2ActualizarCabecera no pise AC2.proyecto con vacío. El select oculto ya tiene las opciones.
  var io=document.getElementById('ac2_obra'); if(io) io.value=nombre||'';
  var sel=document.getElementById('ac2_obraSel');
  if (sel){
    var found=false;
    for (var i=0;i<sel.options.length;i++){ if(sel.options[i].value===idProyecto){ sel.selectedIndex=i; found=true; break; } }
    if (!found){ var op=document.createElement('option'); op.value=idProyecto; op.text=nombre||idProyecto; sel.appendChild(op); sel.value=idProyecto; }
  }
  // Efecto de "obra elegida" (mismo camino que el buscador).
  AC2.proyecto=idProyecto; AC2._nombreObra=nombre||''; AC2.creando=false;
  AC2.ciclo=''; AC2.eje=''; AC2.sector=''; AC2.estructura=''; AC2.loteId=null; AC2.loteEstado=''; AC2.barras=[]; AC2.plano='';
  if (_ac2CbCiclo) _ac2CbCiclo.limpiar(); if (_ac2CbEje) _ac2CbEje.limpiar();
  ac2PintarEstado(); ac2PintarSectorEstructura(); ac2PintarSubtabs();
  ac2ActualizarBotonesCrear(); ac2ActualizarCabecera(); ac2Render(); ac2CargarLotes();
  _ac2Pisos=[]; ac2PintarMenuPisos();
  _ac2CargarContexto(idProyecto); _ac2CargarPisos();
  ac2CargarGrafico();   // gráfico filtrado a esta obra
};

// ── PANEL DE CUBICACIÓN (componente compartido shared/panel_cubicacion.js) ────────────────────
// El gráfico de kilos por cubicador es el componente ESTÁNDAR "Panel de Cubicación": formato y
// funcionalidad viven en shared/ (toggle S/M·S/M·D/A, años checkbox, valores, totales, resalte).
// Aquí solo se CABLEA la data del editor: filtro por obra (AC2.proyecto) y el alcance del título
// (nombre de la obra + resalte cuando se está dentro de una). Instancia perezosa (el div ac2_grafico
// existe desde el mount; el panel se crea la primera vez que se pide recargar).
var _ac2Panel=null;
window.ac2CargarGrafico=function(){
  if (!_ac2Panel){
    var el=document.getElementById('ac2_grafico');
    if (!el || !window.PanelCubicacion) return;
    _ac2Panel=PanelCubicacion.crear(el, {
      getParams:  function(){
        // Dentro de una obra: SOLO lo cubicado a mano en ESA obra (foco del cubicador).
        // En la landing (sin obra): TODO (CSV + manual) de todas las obras, igual que el Hub.
        return AC2.proyecto ? { proyecto: AC2.proyecto, origen: 'manual' } : { origen: 'todos' };
      },
      getAlcance: function(){
        var enObra=!!(AC2.proyecto && AC2._nombreObra);
        return { texto: enObra ? (' · '+AC2._nombreObra) : ' · todas las obras (CSV + creados)', resaltar: enObra };
      }
    });
    if (!_ac2Panel) return;
  }
  _ac2Panel.recargar();
};
// "← Volver a obras": regresa a la landing (etapa 0). Descarta lo no guardado y limpia la obra.
window.ac2VolverObras=function(){
  // Avisos al salir: (a) barras sin guardar se descartan; (b) un despiece creado SIN barras (en blanco)
  // se BORRA de la BD al salir (los despieces sin barras no se conservan). El aviso lo deja claro.
  var pend = AC2.barras && AC2.barras.filter(function(b){return !b._guardada;}).length;
  var loteVacio = AC2.loteId && !(AC2.barras && AC2.barras.some(function(b){return b._guardada;}));
  if (pend && !confirm('Tienes '+pend+' barra(s) sin guardar. Si vuelves a obras se descartarán.\n\n¿Continuar?')) return;
  if (!pend && loteVacio && !confirm('Este despiece no tiene barras guardadas.\n\nSi vuelves a obras, el registro se BORRARÁ (no se conservan despieces en blanco).\n\n¿Continuar?')) return;
  _ac2ResetTanda();              // limpia lote/barras/contexto (reusa lo existente); borra el lote vacío
  AC2.creando=false;
  AC2.proyecto=null; AC2._nombreObra='';
  if (_ac2CbObra && _ac2CbObra.limpiar) _ac2CbObra.limpiar();
  var io=document.getElementById('ac2_obra'); if(io) io.value='';
  ac2ActualizarCabecera();
  if (typeof ac2CargarLandingObras==='function') ac2CargarLandingObras();   // refrescar landing
  if (typeof ac2CargarGrafico==='function') ac2CargarGrafico();             // gráfico → todas las obras
};

window.ac2SetTipo=function(t){
  AC2.tipo=t;
  AC2_TIPOS.concat(['TODOS']).forEach(function(x){ var b=document.getElementById('ac2t_'+x); if(b) b.className='ac2tab'+(x===t?' on':''); });
  // Al cambiar de tipología, la selección masiva NO debe arrastrar barras que dejan de verse (si
  // marqué en TODOS y entro a MH, no quiero seguir con la traba marcada por detrás). Se depura la
  // selección para dejar SOLO lo visible en la nueva vista → estado coherente con lo que veo.
  _ac2DepurarSeleccionVisible();
  ac2ActualizarBotonesCrear();
  ac2Render();
};
// Quita de AC2.seleccion cualquier barra que NO sea visible en la vista actual (tipología activa).
// La selección siempre debe corresponder a lo que el usuario ve; así la masiva y el check global
// operan exactamente sobre pantalla.
function _ac2DepurarSeleccionVisible(){
  if (!AC2.masiva) return;
  var vis={}; ac2Visibles().forEach(function(b){ vis[b._id]=true; });
  Object.keys(AC2.seleccion).forEach(function(k){ if(!vis[k]) delete AC2.seleccion[k]; });
}
window.ac2SetOrden=function(o){ AC2.orden=o; _ac2PisosOrden=[]; _ac2PisoDir=1;   // reset orden manual + dirección
  ['creacion','piso','tipo'].forEach(function(x){ var b=document.getElementById('ac2o_'+x); if(b){var on=(o===x); b.style.background=on?'#8BC34A':'#fff'; b.style.color=on?'#fff':'#558B2F';} });
  ac2Render(); };
// Orden GLOBAL de pisos ascendente (dir=1) o descendente (dir=-1). Los iconos ▲/▼ del header de
// Piso están visibles en las 3 vistas; al presionarlos, si no estabas ordenando por piso, se
// cambia a "Orden: Piso" (para que la acción SIEMPRE tenga efecto visible). Resetea el orden
// manual de grupos (flechas "mover piso") para que la dirección mande.
window.ac2OrdenarPisos=function(dir){
  if (AC2.orden!=='piso'){ ac2SetOrden('piso'); }   // fuerza el modo piso y re-pinta los botones de Orden
  _ac2PisosOrden=[]; _ac2PisoDir=(dir<0?-1:1);       // DESPUÉS de ac2SetOrden (que resetea la dirección)
  ac2Render();
};
// Sube/baja un grupo de PISO en el orden de la grilla (flechas del header). dir=-1 sube, +1 baja.
window.ac2MoverGrupo=function(piso, dir){
  // SIEMPRE partimos del orden VISIBLE actual (los pisos que tienen barras, en el orden en que se
  // muestran) para que el swap sea consistente aunque _ac2PisosOrden esté vacío o desactualizado.
  var base=[];
  ac2Visibles().forEach(function(b){ if(base.indexOf(b.piso)<0) base.push(b.piso); });
  var i=base.indexOf(piso); if(i<0) return;
  var j=i+dir; if(j<0||j>=base.length) return;   // ya en el tope/fondo
  var t=base[i]; base[i]=base[j]; base[j]=t;      // swap con el vecino
  _ac2PisosOrden=base;                            // este orden manda en ac2OrdPiso
  ac2Render();
};
window.ac2ToggleMasiva=function(){ AC2.masiva=!AC2.masiva;
  // Color AZUL estilo Bar Manager (acciones masivas = azul en toda la app). On = azul lleno.
  var b=document.getElementById('ac2_masivaBtn'); b.style.background=AC2.masiva?'#1565c0':'#fff'; b.style.color=AC2.masiva?'#fff':'#1565c0'; b.style.borderColor='#1565c0';
  document.getElementById('ac2_masivaBar').style.display=AC2.masiva?'flex':'none';
  if (AC2.masiva) ac2SetColTipo('lados');   // poblar dropdowns de columna al abrir
  else ac2LimpiarSeleccion();               // al apagar masivas, limpiar selección
  ac2Render(); };
// Muestra/oculta la columna Multiplicador en la grilla (checkbox "Mult").
window.ac2ToggleMult=function(on){ AC2.verMult=!!on; ac2Render(); };
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
  // Si la barra YA está guardada, persistir el estado revisada al instante (/revisar). Antes
  // vivía solo en el front y la BD no se enteraba → la bandera veía "sin revisar" (bug). Las
  // barras aún NO guardadas viajan con revisada en ac2Payload al guardar.
  if (b._guardada && b._dbid){
    _ac2Post('/lotes/'+AC2.loteId+'/revisar', { barra_ids:[b._dbid], revisada:!!b.rev })
      .then(function(r){ if(!r.ok){ b.rev=!b.rev; el.checked=b.rev; ac2ActualizarContadores(); alert('No se pudo actualizar la revisión en el servidor. Reintenta.'); } });
  }
};

// ── Edición de celda: muta el dato. Sin re-render (el input ya muestra el valor). Solo la
//    FIGURA re-renderiza su fila (cambian qué dims pide). Casting numérico donde aplica. ──
var AC2_CAMPOS_NUM={diam:1,cant:1,mult:1,radio:1,ang1:1,ang2:1,ang3:1,ang4:1,
  dim_a:1,dim_b:1,dim_c:1,dim_d:1,dim_e:1,dim_f:1,dim_g:1,dim_h:1,dim_i:1};
// Muta SOLO el dato de una barra (casting numérico + defaults por figura/diámetro), sin re-render.
// Lo usa la edición masiva en tándem para aplicar el mismo cambio a varias barras y re-render una vez.
function ac2SetBarraDato(id, campo, valor){
  var b=ac2BarraPorId(id); if(!b) return;
  // El input ya va disabled, pero el bloqueo de verdad va ACÁ: la edición masiva en
  // tándem escribe sobre barras que el usuario no está tocando, y por ahí se colaba.
  if (ac2BarraDeEstructura(b)) return;
  if (campo in AC2_CAMPOS_NUM){ var s=String(valor).trim(); b[campo]=(s===''?null:Number(s)); }
  else if (campo==='figura') b[campo]=_ac2NormFigura(valor);   // normalizar para que matchee el catálogo
  else b[campo]=valor;
  // mult NUNCA queda vacío ni <1: si el usuario lo borra o pone 0, vuelve a 1 (cant_total = cant×mult).
  if (campo==='mult' && !(Number(b.mult)>=1)) b.mult=1;
  if (campo==='figura') ac2AplicarDefaults(b,'figura');
  else if (campo==='diam') ac2AplicarDefaults(b,'diam');
}
// Normaliza el código de figura que teclea el usuario para que SIEMPRE matchee la clave del catálogo
// (_ac2Figuras usa códigos como '101A', '102A'). Sin esto, si el cubicador escribe '102a' o '102A '
// la figura no se encontraba → ac2AplicarDefaults salía sin limpiar los slots de la figura anterior
// → quedaba "geometría inválida" con datos pegados, hasta reescribir el código exacto. Raíz del bug.
function _ac2NormFigura(v){ return String(v==null?'':v).trim().toUpperCase(); }
window.ac2SetBarra=function(id,campo,valor){
  var b=ac2BarraPorId(id); if(!b) return;
  // EDICIÓN MASIVA EN TÁNDEM (igual que Bar Manager): si el modo masivo está activo y la barra
  // editada está MARCADA, aplicar este mismo cambio a TODAS las marcadas. Actualización GRANULAR
  // por fila (NO re-render completo → antes destruía el input enfocado y al presionar Enter se
  // perdía el cursor). La fila que el usuario está editando NO se re-renderiza (conserva el foco);
  // el resto se actualiza según el campo (geometría re-pinta su fila, cant/mult solo largo/peso).
  if (AC2.masiva && AC2.seleccion[id]){
    var ids=ac2IdsSeleccionados();
    if (ids.length>1){
      var esGeom = (campo.indexOf('dim_')===0 || campo.indexOf('ang')===0 || campo==='radio');
      var esFigDiam = (campo==='figura' || campo==='diam');
      ids.forEach(function(oid){
        ac2SetBarraDato(oid, campo, valor);   // muta el dato (con defaults de figura/diam)
        if (oid===id) return;                 // la fila activa: no la tocamos (conserva el foco)
        if (esFigDiam){ ac2ReRenderFila(oid); return; }   // figura/diam re-renderizan la fila entera
        // dims/ángulos/radio/cant/mult NO re-renderizan → hay que reescribir a mano el VALUE del
        // input de esas filas con el dato ya normalizado (si no, el input muestra el valor viejo
        // aunque el dato y los cálculos sí cambien → parece que "no propaga"). Este era el bug: al
        // pasar la masiva de re-render completo a granular, se perdió el refresco de los inputs.
        var _bo=ac2BarraPorId(oid);
        var _inp=document.querySelector('input.ac2nav[data-row="'+oid+'"][data-col="'+campo+'"]');
        if (_inp && _bo){ _inp.value = (_bo[campo]==null ? '' : _bo[campo]); }
        if (esGeom) ac2ActualizarGeom(oid);   // dims/áng/radio: dibujo/largo/peso/rojo
        else ac2ActualizarLargoPeso(oid);     // cant/mult: largo/peso/cant.T
      });
      // La fila ACTIVA sí necesita reflejar el cambio de figura/diam (cambian sus celdas). En ese
      // caso re-renderizamos SOLO esa fila y re-enfocamos la celda editada explícitamente.
      if (esFigDiam) ac2ReRenderFila(id, { row:String(id), col:campo });
      else if (esGeom) ac2ActualizarGeom(id);
      else ac2ActualizarLargoPeso(id);
      ac2ActualizarContadores();
      return;
    }
  }
  if (campo in AC2_CAMPOS_NUM){ var s=String(valor).trim(); b[campo]=(s===''?null:Number(s)); }
  else if (campo==='figura'){ b[campo]=_ac2NormFigura(valor);   // normalizar para que matchee el catálogo
    var fi=document.querySelector('input.ac2nav[data-row="'+id+'"][data-col="figura"]'); if(fi && fi.value!==b.figura) fi.value=b.figura; }
  else b[campo]=valor;
  // mult NUNCA vacío ni <1: si lo borran o ponen 0, vuelve a 1 (cant_total = cant×mult siempre).
  if (campo==='mult' && !(Number(b.mult)>=1)){ b.mult=1; var mi=document.querySelector('input.ac2nav[data-row="'+id+'"][data-col="mult"]'); if(mi) mi.value=1; }
  // Valores por defecto (rellena solo celdas vacías): al elegir figura → ángulos+intermedios;
  // al elegir diámetro → lados extremos = 10×diam.
  if (campo==='figura') ac2AplicarDefaults(b,'figura');
  else if (campo==='diam') ac2AplicarDefaults(b,'diam');
  if (campo==='figura' || campo==='diam'){
    // Cambian QUÉ celdas existen (dims/ángulos según figura) o los defaults → re-render de fila.
    // Pasamos focoCol EXPLÍCITO (no lo deducimos de document.activeElement, que en un <input list>
    // o <select> ya perdió el foco al disparar el change → antes el cursor desaparecía).
    ac2ReRenderFila(id, { row:String(id), col:campo });
  } else if (campo.indexOf('dim_')===0 || campo.indexOf('ang')===0 || campo==='radio'){
    // Editar una MEDIDA: NO re-render (perdería el foco/cursor). Actualiza granularmente el
    // dibujo, largo/peso y el marcado rojo de validación, sin recrear los inputs.
    ac2ActualizarGeom(id);
  } else {
    if (campo==='cant' || campo==='mult') ac2ActualizarLargoPeso(id);   // solo largo/peso/cant.T
    if (campo==='piso'){
      // Piso obligatorio: al elegirlo/quitarlo, refrescar su resalte rojo y el check Rev (granular).
      var _sp=document.querySelector('select.ac2nav[data-row="'+id+'"][data-col="piso"]');
      if (_sp){ var _falta=(b.figura && !ac2TienePiso(b)); _sp.classList.toggle('rojo', !!_falta); _sp.style.background=_falta?'#ffebee':''; }
      ac2ActualizarRevHabilitado(id, b);
    }
    // Si cambió el campo por el que se ORDENA/AGRUPA la vista (piso cuando ordenas por piso, marca
    // cuando ordenas por tipo), hay que re-renderizar para REUBICAR la fila en su grupo. Antes solo
    // se reordenaba al cambiar la marca → cambiar el PISO no movía la barra a su grupo de piso.
    var campoOrden = ac2AgrupaPor();   // 'piso' | 'marca' | null
    if ((campo===campoOrden) || (campo==='marca' && AC2.masiva)){ ac2Render(); return; }
  }
  ac2ActualizarContadores();                              // rollup (items/barras/kg/revisadas)
};

// Recalcula y pinta largo+peso de UNA fila (granular, sin re-render). No toca los inputs.
function ac2ActualizarLargoPeso(id){
  var b=ac2BarraPorId(id); if(!b) return;
  var l=document.getElementById('ac2largo_'+id); if(l) l.textContent=ac2Num(ac2Largo(b));
  var p=document.getElementById('ac2peso_'+id);  if(p) p.innerHTML=ac2PesoTxt(b);
  var ct=document.getElementById('ac2cantt_'+id); if(ct) ct.textContent=ac2CantTotal(b);   // cant×mult
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
  // FONDO de la fila (mismo criterio que ac2Fila, vía ac2EstiloFila). Antes solo lo pintaba/quitaba
  // el re-render completo (ac2Fila) → si el usuario corregía una barra editando una MEDIDA (que no
  // re-renderiza la fila), el fondo rosado "inválida" quedaba PEGADO aunque la barra ya fuera válida,
  // hasta forzar un re-render (cambiar figura/diám). Ahora el fondo se recalcula aquí también.
  if (tr){
    var est=ac2EstiloFila(b, val);
    tr.style.background=est.bg;
    tr.title=est.tit;
  }
  // El check Rev solo se puede marcar si la barra está completa y válida (ver ac2Fila).
  ac2ActualizarRevHabilitado(id, b);
}
// ¿La barra tiene PISO? (obligatorio, como sector/ciclo/eje). El piso es el único de la ubicación que
// vive por barra (sector/ciclo/eje vienen del contexto global). Sin piso, la barra queda sin ubicar.
function ac2TienePiso(b){ return !!(b.piso && String(b.piso).trim()); }
// Habilita/deshabilita el checkbox Rev de una fila según si la barra está lista para revisar.
// Exige φ, figura, geometría válida Y piso (obligatorio → no se guardan barras sin ubicar).
function ac2BarraLista(b){ return b.diam!=null && b.figura && ac2TienePiso(b) && ac2Validar(b).ok; }
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
  // Re-enfocar la celda que estaba activa (misma fila+columna), si sigue existiendo. Incluye
  // <select> (φ) además de <input>, porque la celda editada puede ser cualquiera de los dos.
  if (focoCol && focoCol.row!=null){
    var sel='input.ac2nav[data-row="'+focoCol.row+'"][data-col="'+focoCol.col+'"],'+
            'select.ac2nav[data-row="'+focoCol.row+'"][data-col="'+focoCol.col+'"]';
    var again=document.querySelector(sel);
    if (again){ again.focus(); if(again.select) again.select(); }
  }
}
// Refresca contador de revisadas + rollup sin reconstruir la tabla.
function ac2ActualizarContadores(){
  var arr=ac2Visibles();
  var rev=arr.filter(function(b){return b.rev;}).length;
  // ITEMS = nº de filas (arr.length). BARRAS FÍSICAS = Σ(cant×mult) (no solo cant → antes el "uds"
  // subreportaba con mult>1). Nomenclatura estandarizada: "items" = filas, "barras" = físicas.
  var barrasFis=arr.reduce(function(s,b){return s+((Number(b.cant)||0)*(Number(b.mult)||1));},0);
  var kg=arr.reduce(function(s,b){return s+(Number(ac2Peso(b))||0);},0);
  // Barras inválidas: contamos SOLO las que ya tienen figura (una fila recién agregada, vacía, no
  // es "inválida", está a medio llenar). Y armamos un detalle para el tooltip (cuáles son).
  var malas=arr.filter(function(b){ return b.figura && !ac2Validar(b).ok; });
  var inval=malas.length;
  var detalle=malas.map(function(b){
    var faltan=Object.keys(ac2Validar(b).rojas).map(function(c){ return c.indexOf('dim_')===0?('lado '+c.split('_')[1].toUpperCase()):(c.indexOf('ang')===0?('áng '+c.slice(3)):c); });
    return '• '+(b.piso||'?')+' '+(b.marca||'')+' fig '+b.figura+(faltan.length?(' → revisa: '+faltan.join(', ')):'');
  }).join('\n');
  var rc=document.getElementById('ac2_revcount');
  if(rc){ rc.innerHTML = !arr.length ? '' :
    ('✓ '+rev+' de '+arr.length+' revisadas' + (inval?(' · <b style="color:#c62828; cursor:help;" title="'+ac2Esc(detalle)+'">⚠ '+inval+' con geometría inválida</b>'):'')); }
  var ro=document.getElementById('ac2_rollup'); if(ro) ro.innerHTML=arr.length?('<b style="color:#37474f;">'+arr.length+'</b> items · <b style="color:#37474f;">'+ac2Num(barrasFis)+'</b> barras · <b style="color:#558B2F;">'+ac2Num(kg,1)+'</b> kg'):'';
}

// ── Agregar / copiar / duplicar / quitar barras (cambios estructurales → re-render completo) ──
function ac2PuedeCrear(){
  if (!AC2.proyecto){ alert('Elige primero una obra.'); return false; }
  if (!AC2.loteId){ alert('Crea el lote primero (🆕 Crear lote) definiendo Obra, Ciclo y Eje.'); return false; }
  if (AC2.loteEstado==='terminada'){ alert('El despiece está terminado; se edita desde Bar Manager.'); return false; }
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
  if (ac2BarraDeEstructura(b)) return;   // una copia suelta no pertenecería a la estructura
  var copia=JSON.parse(JSON.stringify(b)); copia._id=_ac2Seq++; copia.rev=false;
  // La copia nace SIN el estado de guardado del original. Antes heredaba _guardada y
  // _dbid: el 💾 la saltaba para siempre (fila fantasma que desaparecía al recargar —
  // "las modificaciones no se guardan") y peor, quitarla borraba de la BD la barra
  // ORIGINAL (compartían _dbid). _sync/_idu por lo mismo: son identidad del original.
  delete copia._guardada; delete copia._dbid; delete copia._sync; delete copia._idu;
  AC2.barras.splice(AC2.barras.indexOf(b)+1,0, copia);
  ac2Render();
};
window.ac2Quitar=async function(id){
  var b=ac2BarraPorId(id);
  if (ac2BarraDeEstructura(b)){
    alert('Esta barra viene de una estructura del Enfierrador. Ábrela con 🧱 para quitarla:\nal regenerar, las barras que dejan de existir se borran solas.');
    return;
  }
  // Si la barra YA está guardada en BD, hay que borrarla también allá; si no, quedaría huérfana y
  // 'terminar' la contaría como no revisada (aunque el usuario ya no la vea).
  if (b && b._guardada && b._dbid){
    if (!confirm('Esta barra ya está guardada en el despiece. ¿Eliminarla también del despiece guardado?')) return;
    var r=await _ac2Delete('/lotes/'+AC2.loteId+'/barras/'+b._dbid);
    if (!r.ok){ alert('No se pudo eliminar la barra del despiece'+(r.data&&r.data.detail?': '+(r.data.detail.msg||r.data.detail):'')+'.'); return; }
  }
  AC2.barras=AC2.barras.filter(function(x){return x._id!==id;});
  delete AC2.seleccion[id];
  ac2Render(); ac2CargarLotes();
};
// La SELECCIÓN vive en AC2.seleccion (estado JS), NO en el DOM → sobrevive a los re-renders de
// fila (antes se perdía y la edición masiva fallaba de forma inconsistente).
// Check MAESTRO del grupo: marca/desmarca todas las barras del grupo (en el estado). El grupo
// puede ser por TIPOLOGÍA o por PISO según la vista → comparamos contra el campo vigente.
window.ac2SelGrupo=function(el){
  var grp=el.getAttribute('data-grp'), on=el.checked;
  var gc=ac2AgrupaPor(), campo=(gc==='piso')?'piso':'marca';
  ac2Visibles().forEach(function(b){ if((b[campo]||'')===grp){ if(on) AC2.seleccion[b._id]=true; else delete AC2.seleccion[b._id]; ac2PintarFilaSel(b._id); } });
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
// Pinta (o despinta) el FONDO de resaltado de una fila seleccionada, granular (sin re-render, no
// pierde foco). Pasa por ac2EstiloFila: al DESMARCAR no se puede dejar la fila en blanco a secas
// porque debajo del celeste puede haber azul (barra del Enfierrador) o verde (ya guardada) —
// pintarla blanca borraba esa información hasta el siguiente re-render.
function ac2PintarFilaSel(id){
  var tr=document.getElementById('ac2row_'+id); if(!tr) return;
  var b=ac2BarraPorId(id); if(!b) return;
  var est=ac2EstiloFila(b);
  tr.style.background=est.bg;
  tr.title=est.tit;
}
// Al marcar/desmarcar UNA fila: actualiza el estado + resalta la fila + sincroniza el maestro.
window.ac2SelFila=function(el){
  if (el){ var id=Number(el.getAttribute('data-id')); if(el.checked) AC2.seleccion[id]=true; else delete AC2.seleccion[id]; ac2PintarFilaSel(id); }
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
// ── ACCIONES MASIVAS: operan sobre las barras MARCADAS *Y VISIBLES* (AC2.seleccion, estado JS) ──
// El universo de una acción masiva es SIEMPRE lo que se ve en pantalla: si estoy en la tipología MH,
// solo toca barras MH; si estoy en TODOS, toca lo visible en TODOS. Nunca una barra fuera de la vista
// activa (antes una selección hecha en otra tipología se arrastraba y editaba barras que no se veían
// → p.ej. cambiar B en MH le cambiaba el B a una traba). Filtrar por visibles es la garantía de raíz.
function ac2IdsSeleccionados(){
  var vis={}; ac2Visibles().forEach(function(b){ vis[b._id]=true; });
  return Object.keys(AC2.seleccion).map(Number).filter(function(id){ return vis[id] && !!ac2BarraPorId(id); });
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
    // _dbid/_sync/_idu son identidad del ORIGINAL: si la copia los hereda, la
    // sincronización de revisadas y el quitar tocan la barra equivocada en la BD.
    delete copia._dbid; delete copia._sync; delete copia._idu;
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
    // _dbid/_sync/_idu son identidad del ORIGINAL (ver ac2CopiarSeleccionadas).
    delete copia._dbid; delete copia._sync; delete copia._idu;
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
// Borrar las barras marcadas (con confirmación). Las que ya están guardadas en BD se borran
// también allá (si no, quedarían huérfanas y 'terminar' las contaría como no revisadas).
window.ac2BorrarSeleccionadas=async function(){
  var ids=ac2IdsSeleccionados();
  if (!ids.length){ alert('Marca al menos una barra.'); return; }
  var guardadas=ids.map(ac2BarraPorId).filter(function(b){ return b && b._guardada && b._dbid; });
  var msg='Borrar '+ids.length+' barra(s) seleccionada(s)?';
  if (guardadas.length) msg+='\n\n'+guardadas.length+' de ellas YA están guardadas y se eliminarán también del despiece guardado.';
  if (!confirm(msg)) return;
  // Borrar del backend las ya guardadas.
  for (var i=0;i<guardadas.length;i++){
    var r=await _ac2Delete('/lotes/'+AC2.loteId+'/barras/'+guardadas[i]._dbid);
    if (!r.ok){ alert('No se pudo eliminar una barra guardada. Se detiene el borrado; reintenta.'); ac2Render(); ac2CargarLotes(); return; }
  }
  AC2.barras=AC2.barras.filter(function(b){ return ids.indexOf(b._id)<0; });
  ids.forEach(function(id){ delete AC2.seleccion[id]; });
  ac2Render(); ac2CargarLotes();
};
// ── Estado visual del badge/bandera según el estado del lote (sin número inventado) ──
function ac2PintarEstado(){
  var b=document.getElementById('ac2_bandera'), badge=document.getElementById('ac2_estadoBadge');
  var terminado=(AC2.loteEstado==='terminada');
  // Mostramos el correlativo POR OBRA (AC2.loteNum), no el id global. Fallback al id si no vino.
  // Incluye el nombre de la obra para que NUNCA se pierda del encabezado.
  var obraTxt=(AC2._nombreObra?(AC2._nombreObra+' · '):'');
  var lote=AC2.loteId?(obraTxt+'Despiece #'+(AC2.loteNum||AC2.loteId)+' · '):obraTxt;
  if (b){ b.textContent=terminado?'🏁':'🚩';
    b.style.background=terminado?'#e8f5e9':'#ffebee'; b.style.color=terminado?'#2e7d32':'#c62828'; b.style.borderColor=terminado?'#a5d6a7':'#ef9a9a'; }
  if (badge){
    if (terminado){ badge.textContent=lote+'🔒 Terminado'; badge.style.background='#e8f5e9'; badge.style.color='#2e7d32'; badge.style.borderColor='#a5d6a7'; }
    else if (AC2.loteId){ badge.textContent=lote+'En edición'; badge.style.background='#fff3e0'; badge.style.color='#e65100'; badge.style.borderColor='#ffb74d'; }
    else { badge.textContent='Nuevo Despiece'; badge.style.background='#eceff1'; badge.style.color='#607d8b'; badge.style.borderColor='#cfd8dc'; }
  }
}

// M1.4: los /lotes ahora también viven bajo /api/v1 → estos helpers usan la MISMA
// convención (apiUrl) y auth (authHeaders) de shared/api.js. Conservan el shape
// {ok,status,data} porque el editor maneja sus errores EN LÍNEA (409/404/estado),
// sin el toast/logout global de apiGet.
async function _ac2Req(method, url, body){
  var headers = Object.assign({}, authHeaders());
  var opts = { method: method, headers: headers };
  if (body !== undefined){ headers['Content-Type']='application/json'; opts.body = JSON.stringify(body||{}); }
  var res = await fetch(apiUrl(url), opts);
  var data=null; try{ data=await res.json(); }catch(e){}
  return { ok:res.ok, status:res.status, data:data };
}
async function _ac2Post(url, body){ return _ac2Req('POST', url, body||{}); }
async function _ac2Patch(url, body){ return _ac2Req('PATCH', url, body||{}); }
async function _ac2Delete(url){ return _ac2Req('DELETE', url); }
async function _ac2Get(url){
  var r = await _ac2Req('GET', url);
  return r.ok ? r.data : null;
}

// Barras COMPLETAS (con figura, φ, piso y geometría válida) y NO guardadas aún, listas para guardar.
// Usa ac2BarraLista (mismo criterio que habilita el check Rev) → NO se guardan barras sin piso.
function ac2BarrasListas(){
  return AC2.barras.filter(function(b){ return !b._guardada && ac2BarraLista(b); });
}
// IDENTIDAD ESTABLE DE LA BARRA A TRAVÉS DE REINTENTOS (bug "guardé de nuevo y se
// duplicaron las barras"): cada barra recibe UNA vez un id_unico local (mismo formato
// 'M-…' del backend) que viaja en el POST. Si el guardado se repite — doble clic con
// el primer POST en vuelo, o reintento tras "Error de red" cuando el INSERT sí había
// entrado — el backend reconoce el id por su índice único y NO inserta de nuevo.
// La colisión (astronómicamente improbable) la resuelve el backend con id propio.
function _ac2IdUnicoLocal(){
  var s='';
  for (var i=0;i<12;i++) s+='0123456789ABCDEF'[Math.floor(Math.random()*16)];
  return 'M-'+s;
}
// Campos de la barra que viven en la BD y son editables en la grilla. Con ellos se
// hace la FOTO (_sync) del estado guardado de cada barra: comparando la foto con el
// estado actual se sabe QUÉ campos editó el usuario en una barra YA guardada, para
// mandarlos por PATCH al guardar (antes esas ediciones se perdían en silencio: el 💾
// solo insertaba barras nuevas y una barra _guardada editada no viajaba nunca).
var AC2_CAMPOS_SYNC=['piso','marca','suf_tipo','diam','cant','mult','figura','radio',
                     'ang1','ang2','ang3','ang4'].concat(AC2_DIMKEYS);
function _ac2Snapshot(b){
  var s={};
  AC2_CAMPOS_SYNC.forEach(function(k){ s[k]=(b[k]==null||b[k]==='')?null:b[k]; });
  return JSON.stringify(s);
}
// Diff contra la foto: {campo: valorNuevo} SOLO con lo que cambió, o null si nada.
// Sin foto (barra de sesiones anteriores a este fix) no hay contra qué comparar → null.
function _ac2CambiosBarra(b){
  if (!b._sync) return null;
  var prev; try{ prev=JSON.parse(b._sync); }catch(e){ return null; }
  var out=null;
  AC2_CAMPOS_SYNC.forEach(function(k){
    var v=(b[k]==null||b[k]==='')?null:b[k];
    // Comparación tolerante a "5" vs 5 (los selects entregan string): en campos
    // numéricos se compara el número.
    if (k in AC2_CAMPOS_NUM){ v=(v==null)?null:Number(v); var p=(prev[k]==null)?null:Number(prev[k]);
      if (v!==p && !(v==null&&p==null)){ (out=out||{})[k]=v; } return; }
    if (v!==prev[k]){ (out=out||{})[k]=v; }
  });
  return out;
}
function _ac2Editadas(){
  return AC2.barras.filter(function(b){ return b._guardada && b._dbid && _ac2CambiosBarra(b); });
}
// Mapea una barra del estado al payload del backend (mismo shape; solo limpia nulls/estampa contexto).
function ac2Payload(b){
  var it={ sector:AC2.sector||null, ciclo:AC2.ciclo||null, piso:(b.piso||null), eje:AC2.eje||null,
           diam:Number(b.diam), figura:b.figura||null, marca:b.marca||null,
           cant:Number(b.cant)||1, mult:Number(b.mult)||1, radio:(b.radio!=null?Number(b.radio):null),
           revisada: !!b.rev, suf_tipo:(b.suf_tipo||'').trim()||null,
           id_unico:(b._idu||null) };   // identidad estable (ver _ac2IdUnicoLocal)
  AC2_DIMKEYS.forEach(function(k){ it[k]=(b[k]!=null?Number(b[k]):null); });
  ['ang1','ang2','ang3','ang4'].forEach(function(a){ it[a]=(b[a]!=null?Number(b[a]):null); });
  return it;
}

// 🆕 CREAR LOTE (paso EXPLÍCITO y previo): exige ubicación completa (obra + ciclo + eje) ANTES
// de poder elegir sector/estructura y agregar barras. Reconcilia el texto de los comboboxes para
// no perder lo escrito. Sin lote creado, la ubicación está bloqueada (ver ac2Bloqueado).
window.ac2CrearLote=async function(){
  if (AC2.loteId){ return; }   // ya hay lote en curso
  if (!AC2.proyecto){ alert('Elige primero una obra.'); return; }
  _ac2LeerContexto();          // vuelca el texto visible de ciclo/eje al estado (evita perderlo)
  var faltan=[];
  if (!AC2.ciclo) faltan.push('Ciclo');
  if (!AC2.eje)   faltan.push('Eje / Losa');
  if (faltan.length){ alert('Para crear el despiece completa: '+faltan.join(' y ')+'.'); return; }
  try{
    // Estampar la ubicación en el lote → el histórico la muestra aunque el despiece aún no tenga barras.
    var r=await _ac2Post('/lotes', { id_proyecto:AC2.proyecto, ciclo:AC2.ciclo||null, eje:AC2.eje||null,
                                     sector:AC2.sector||null, estructura:AC2.estructura||null });
    if (!r.ok || !r.data || !r.data.lote_id){ alert('No se pudo crear el despiece'+(r.data&&r.data.detail?': '+(r.data.detail.msg||r.data.detail):'')+'.'); return; }
    AC2.loteId=r.data.lote_id; AC2.loteNum=r.data.num_obra||null; AC2.loteEstado='borrador';
    // M1.10: si ya se había escrito un plano antes de existir el lote, persistirlo ahora.
    if ((AC2.plano||'').trim()){ _ac2Patch('/lotes/'+AC2.loteId+'/plano', { plano:AC2.plano.trim() }); }
    ac2PintarEstado(); ac2PintarSectorEstructura(); ac2ActualizarBotonesCrear();
    ac2ActualizarCabecera(); ac2Render(); ac2CargarLotes();
  }catch(e){ alert('Error de red al crear el despiece. Reintenta.'); }
};

// ── CORRECCIÓN DE EJE/CICLO (modo explícito de 2 pasos) ────────────────────────────────────────
// En un despiece BORRADOR con barras guardadas, ciclo/eje quedan BLOQUEADOS (candado visual) para
// que no se editen por error. Para corregir un eje/ciclo mal escrito, el usuario entra a "modo
// corrección": el botón ✎ Corregir desbloquea y RESALTA ciclo/eje; luego ✓ Aplicar hace el PATCH.
// Así el gesto es explícito y no hay que adivinar "modifica y después presiona".
var _ac2ModoCorregir=false;

// Aplica/quita el look BLOQUEADO (candado) a los inputs ciclo/eje. locked=true → readonly + gris.
function _ac2LockContexto(locked){
  ['ac2_ciclo','ac2_eje'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    el.readOnly=locked;
    el.style.background=locked?'#f4f6f7':'';
    el.style.color=locked?'#607d8b':'';
    el.style.cursor=locked?'not-allowed':'';
    el.title=locked?'🔒 Bloqueado. Usa "✎ Corregir eje/ciclo" para cambiarlo.':'';
  });
}
// Aplica/quita el RESALTE (ámbar) de edición durante el modo corrección.
function _ac2HighlightContexto(on){
  ['ac2_ciclo','ac2_eje'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    el.style.border=on?'2px solid #ffa000':'';
    el.style.boxShadow=on?'0 0 0 3px rgba(255,193,7,.25)':'';
    el.style.background=on?'#fffdf5':'';
  });
}

// Paso 1: entrar a modo corrección → desbloquea + resalta ciclo/eje, muestra hint y botones.
window.ac2CorregirContextoInicio=function(){
  if (!AC2.loteId || AC2.loteEstado!=='borrador'){ return; }
  _ac2ModoCorregir=true;
  _ac2LockContexto(false);
  _ac2HighlightContexto(true);
  var hint=document.getElementById('ac2_corregirHint'); if(hint) hint.style.display='';
  var show=function(id,on){ var el=document.getElementById(id); if(el) el.style.display=on?'':'none'; };
  show('ac2_reasignarBtn', false);
  show('ac2_reasignarAplicarBtn', true);
  show('ac2_reasignarCancelarBtn', true);
  var e=document.getElementById('ac2_ciclo'); if(e){ e.focus(); e.select&&e.select(); }
};

// Cancelar: descarta la corrección, restaura ciclo/eje al valor real y re-bloquea.
window.ac2CorregirContextoCancelar=function(){
  _ac2ModoCorregir=false;
  _ac2HighlightContexto(false);
  // Restaurar el ciclo/eje visible al valor real del despiece (por si el usuario alcanzó a tipear).
  var iC=document.getElementById('ac2_ciclo'), iE=document.getElementById('ac2_eje');
  if (iC) iC.value=AC2.ciclo||''; if (iE) iE.value=AC2.eje||'';
  var hint=document.getElementById('ac2_corregirHint'); if(hint) hint.style.display='none';
  ac2ActualizarCabecera();   // re-pinta botones y re-bloquea contexto
};

// Paso 2: aplicar. Aplica el nuevo ciclo/eje a TODAS las barras guardadas del despiece (PATCH).
// Un despiece terminado ya no se puede reasignar (backend 409). Al terminar, sale del modo.
window.ac2ReasignarContexto=async function(){
  if (!AC2.loteId || AC2.loteEstado!=='borrador'){ return; }
  _ac2LeerContexto();   // toma el ciclo/eje que el usuario tiene escrito ahora
  if (!AC2.ciclo || !AC2.eje){ alert('Ciclo y Eje no pueden quedar vacíos.'); return; }
  var hayGuardadas=AC2.barras.some(function(b){ return b._guardada; });
  var msg = hayGuardadas
    ? 'Reasignar el despiece a Ciclo "'+AC2.ciclo+'" · Eje "'+AC2.eje+'".\nSe aplica a TODAS las barras guardadas del despiece.\n\n¿Continuar?'
    : 'Cambiar el Ciclo/Eje del despiece a Ciclo "'+AC2.ciclo+'" · Eje "'+AC2.eje+'".\n\n¿Continuar?';
  if (!confirm(msg)) return;
  // El PATCH /contexto actualiza el lote (ubicación en el histórico) y sus barras si las hay.
  var r=await _ac2Patch('/lotes/'+AC2.loteId+'/contexto', { ciclo:AC2.ciclo, eje:AC2.eje });
  if (!r.ok){ var d=r.data&&r.data.detail; alert('No se pudo reasignar'+(d?': '+(d.msg||d):'')+'.'); return; }
  // Actualizar las barras del front (ciclo/eje) para reflejar el cambio sin recargar.
  AC2.barras.forEach(function(b){ if(b._guardada){ b.ciclo=AC2.ciclo; b.eje=AC2.eje; } });
  _ac2ModoCorregir=false;
  _ac2HighlightContexto(false);
  ac2CargarLotes();
  ac2ActualizarCabecera();
  alert('✎ Despiece reasignado a Ciclo '+AC2.ciclo+' · Eje '+AC2.eje+' ('+(r.data&&r.data.barras)+' barras).');
};

// 💾 GUARDAR AVANCE: persiste las barras COMPLETAS y válidas en el lote YA creado. Las incompletas
// NO se pierden: quedan en el formulario para completarlas y guardar después. (El backend solo
// acepta barras con geometría válida + ubicación completa; guardar avance = fijar lo listo.)
// Además persiste las EDICIONES de barras ya guardadas (PATCH por barra, el mismo canal del Bar
// Manager): antes esas ediciones vivían solo en el front y se perdían al recargar — el síntoma
// clásico era un despiece DUPLICADO (nace con todas sus barras _guardada) al que "no se le
// guardaban las modificaciones".
var _ac2Guardando=false;   // guardado EN VUELO: un segundo clic no dispara otro POST (duplicaba barras)
window.ac2Guardar=async function(opts){
  var silencioso=!!(opts&&opts.silencioso);   // sin alerts (lo llama la bandera antes de terminar)
  if (_ac2Guardando) return;   // el guardado anterior aún no responde: NO repetir el envío
  if (!AC2.loteId){ if(!silencioso) alert('Primero crea el despiece (🆕 Crear despiece) definiendo Obra, Ciclo y Eje.'); return; }
  if (AC2.loteEstado==='terminada'){ if(!silencioso) alert('El despiece está terminado; se edita desde Bar Manager.'); return; }
  var listas=ac2BarrasListas();
  // Barras ya guardadas con ediciones pendientes: solo las COMPLETAS viajan (el backend valida la
  // geometría del PATCH igual que la del alta); las editadas a medio llenar esperan en pantalla.
  var editadas=_ac2Editadas();
  var editListas=editadas.filter(function(b){ return ac2BarraLista(b); });
  var editIncompletas=editadas.length-editListas.length;
  var pendientes=AC2.barras.filter(function(b){ return !b._guardada; }).length - listas.length;
  if (!listas.length && !editListas.length){
    if(!silencioso) alert('Aún no hay ninguna barra COMPLETA para guardar.\n\nGuardar fija en el despiece las barras que ya tienen φ, figura y sus medidas válidas. Las que están a medio llenar (celdas en rojo/vacías) se quedan en pantalla para que las completes; guarda de nuevo cuando estén listas.'+(editIncompletas?'\n\n('+editIncompletas+' barra(s) guardadas tienen ediciones a medio llenar: complétalas para poder guardarlas.)':''));
    return;
  }
  _ac2LeerContexto();   // reconciliar ciclo/eje por si el usuario los ajustó justo antes de guardar
  _ac2Guardando=true;
  var _gb=document.getElementById('ac2_guardarBtn'); if(_gb) _gb.disabled=true;
  try{
    var n=0;
    if (listas.length){
      // Identidad estable ANTES del envío: el mismo lote de barras reintentado viaja con los
      // MISMOS id_unico y el backend no lo inserta dos veces (ver _ac2IdUnicoLocal).
      listas.forEach(function(b){ if(!b._idu) b._idu=_ac2IdUnicoLocal(); });
      // Agregar las barras (transaccional en el backend; rechaza si falta ubicación).
      var rb=await _ac2Post('/lotes/'+AC2.loteId+'/barras', { barras: listas.map(ac2Payload) });
      if (!rb.ok){
        var d=rb.data&&rb.data.detail;
        alert('No se guardaron las barras'+(d?': '+(d.msg||JSON.stringify(d)):' (error '+rb.status+')')+'.');
        return;
      }
      n=(rb.data&&rb.data.creadas)||listas.length;
      // Las barras guardadas PERMANECEN en la grilla (marcadas _guardada) para poder revisarlas
      // ahí (el check "revisada" es por fila) y terminar el lote. NO se vacían. Guardamos el id de
      // BD (_dbid) de cada una — el backend los devuelve en ORDEN — para poder sincronizar luego su
      // estado "revisada" (/revisar) sin re-insertarlas, y la FOTO (_sync) del estado recién
      // guardado para detectar ediciones posteriores.
      var idsDb=(rb.data&&rb.data.ids)||[];
      listas.forEach(function(b,i){ b._guardada=true; if(idsDb[i]!=null) b._dbid=idsDb[i]; b._sync=_ac2Snapshot(b); });
    }
    // EDICIONES de barras ya guardadas → PATCH por barra, en paralelo (patrón del Bar Manager).
    // Solo viajan los campos que CAMBIARON respecto de la foto (_sync): así la auditoría del
    // backend registra exactamente la edición y nada más.
    var editOk=0, editFail=0, editMsg='';
    if (editListas.length){
      var resultados=await Promise.all(editListas.map(async function(b){
        var cambios=_ac2CambiosBarra(b);
        if (!cambios) return { ok:true, sin_cambios:true };
        var r=await _ac2Patch('/barras/'+b._dbid, cambios);
        if (r.ok) b._sync=_ac2Snapshot(b);   // la foto pasa a ser el estado recién guardado
        return { ok:r.ok, detail:r.data&&r.data.detail };
      }));
      resultados.forEach(function(r){
        if (r.ok) editOk++;
        else { editFail++; if(!editMsg && r.detail) editMsg=(r.detail.mensaje||r.detail.msg||(typeof r.detail==='string'?r.detail:'')); }
      });
    }
    if (silencioso){   // guardado desde la bandera: solo persistir + refrescar, sin alert
      ac2PintarEstado(); ac2ActualizarCabecera(); ac2Render(); ac2CargarLotes();
      return;
    }
    // El disquete NUNCA limpia el formulario: el usuario debe poder guardar SEGUIDO (avance) sin
    // perder lo que tiene en pantalla si se corta el internet. Para limpiar y crear otro lote está
    // la X (ac2Descartar). Las barras guardadas quedan marcadas _guardada; las incompletas siguen ahí.
    ac2PintarEstado(); ac2ActualizarCabecera(); ac2Render(); ac2CargarLotes();
    var partes=[];
    if (n) partes.push(n+' barra(s) guardadas');
    if (editOk) partes.push(editOk+' edición(es) actualizadas');
    var msg='✅ '+(partes.join(' · ')||'Sin cambios')+' en el despiece #'+(AC2.loteNum||AC2.loteId)+'.';
    if (editFail) msg+='\n\n⚠ '+editFail+' edición(es) NO se guardaron'+(editMsg?': '+editMsg:'')+'. Corrige y guarda de nuevo.';
    if (editIncompletas) msg+='\n\n'+editIncompletas+' barra(s) guardadas tienen ediciones a medio llenar — complétalas y guarda de nuevo.';
    if (pendientes>0) msg+='\n\nQuedan '+pendientes+' barra(s) sin completar en el formulario — complétalas y guarda de nuevo.';
    else if (!editFail) msg+='\n\nMarca "Rev" y 🏁 Terminar, o sigue agregando. Para vaciar el formulario usa la X.';
    alert(msg);
  }catch(e){ alert('Error de red al guardar. Reintenta.'); }
  finally{ _ac2Guardando=false; if(_gb) _gb.disabled=false; }
};

// 🏁 TERMINAR: cierra el lote. El backend exige que TODAS sus barras estén revisadas (5N.19).
// GUARDA PRIMERO lo pendiente (barras nuevas + su estado revisada) para que la BD refleje lo que
// el usuario ve marcado en la grilla — antes la bandera veía "sin revisar" porque el check vivía
// solo en el front (bug: 14 con ticket = 14 sin revisar).
window.ac2ToggleTerminado=async function(){
  if (!AC2.loteId){ alert('Primero crea el despiece y guarda barras (💾) antes de terminarlo.'); return; }
  if (AC2.loteEstado==='terminada'){ alert('El despiece ya está terminado.'); return; }
  // Guardar avance si hay barras completas sin persistir O ediciones pendientes de barras
  // guardadas (sincroniza revisada de las nuevas y fija las ediciones antes de cerrar).
  if (ac2BarrasListas().length || _ac2Editadas().length){ await ac2Guardar({ silencioso:true }); }
  var pendientes=AC2.barras.filter(function(b){ return !b._guardada; }).length;
  if (pendientes){ alert('Quedan '+pendientes+' barra(s) sin completar en el formulario. Complétalas y guárdalas, o descártalas, antes de terminar.'); return; }
  // Ediciones que el guardado NO pudo fijar (incompletas o rechazadas por el backend): terminar
  // ahora las perdería en silencio — la BD quedaría con el valor viejo y la grilla se limpia.
  var editPend=_ac2Editadas().length;
  if (editPend){ alert('Hay '+editPend+' barra(s) guardadas con ediciones sin fijar (a medio llenar o con error al guardar). Corrígelas y guarda (💾) antes de terminar.'); return; }
  // Sincronizar el estado "revisada" de TODAS las barras guardadas (por si alguna se marcó en el
  // front antes de este fix y nunca llegó a la BD). Marcamos revisadas y desmarcamos las no-rev.
  var revIds=AC2.barras.filter(function(b){return b._dbid && b.rev;}).map(function(b){return b._dbid;});
  var noRevIds=AC2.barras.filter(function(b){return b._dbid && !b.rev;}).map(function(b){return b._dbid;});
  if (revIds.length)   await _ac2Post('/lotes/'+AC2.loteId+'/revisar', { barra_ids:revIds,   revisada:true });
  if (noRevIds.length) await _ac2Post('/lotes/'+AC2.loteId+'/revisar', { barra_ids:noRevIds, revisada:false });
  if (!confirm('Terminar el despiece #'+(AC2.loteNum||AC2.loteId)+' lo cierra: sus barras se editarán solo desde Bar Manager.\n\n¿Continuar?')) return;
  var r=await _ac2Post('/lotes/'+AC2.loteId+'/terminar', {});
  if (!r.ok){
    var d=r.data&&r.data.detail;
    alert('No se pudo terminar'+(d?': '+(d.msg||JSON.stringify(d)):'')+'.');   // 409 si faltan revisadas / lote vacío
    return;
  }
  var numTerm=(AC2.loteNum||AC2.loteId);
  AC2.loteEstado='terminada';
  // Terminar CIERRA la tanda → limpiamos el formulario para crear otro lote. El lote terminado
  // queda en el repositorio (se puede ver desde ahí; sus barras se corrigen en Bar Manager).
  _ac2ResetTanda();
  alert('🏁 Despiece #'+numTerm+' terminado.\nEl formulario quedó listo para crear otro despiece. El despiece terminado está en el repositorio (corrige barras desde Bar Manager).');
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
// ✕ DESCARTAR / LIMPIAR: vacía el formulario y vuelve al inicio (crear lote). NO borra de la BD
// las barras ya guardadas (para eso está 🗑 Eliminar); el lote guardado queda en el repositorio.
// Es EL botón para limpiar la pantalla (el disquete ya no limpia, para poder guardar seguido).
window.ac2Descartar=function(){
  var sinGuardar=AC2.barras.filter(function(b){return !b._guardada;}).length;
  var hayGuardadas=AC2.barras.some(function(b){return b._guardada;});
  // Si no hay nada abierto, no hay qué limpiar.
  if (!AC2.loteId && !AC2.barras.length){ return; }
  var msg = sinGuardar
    ? ('Se vaciará el formulario. Las '+sinGuardar+' barra(s) que aún NO guardaste se descartarán.'+
       (hayGuardadas||AC2.loteId ? '\nEl despiece guardado NO se borra (queda en el repositorio; para borrarlo usa 🗑 Eliminar).' : '')+
       '\n\n¿Continuar?')
    : ('Se cerrará el despiece actual y el formulario quedará listo para crear otro.\nEl despiece guardado NO se borra (queda en el repositorio).\n\n¿Continuar?');
  if (!confirm(msg)) return;
  _ac2ResetTanda();   // limpia lote/barras/ciclo/eje/sector/estructura y refresca cabecera+botones
};

// 🗑 ELIMINAR LOTE: borra el lote y TODAS sus barras. ES LA ÚNICA forma de borrar un lote
// (diseno_editor_cubicacion.md §146). Aplica INCLUSO a lotes terminados/bloqueados (única acción
// posible ahí). Pide escribir ELIMINAR para confirmar (acción destructiva e irreversible).
window.ac2EliminarLote=async function(){
  if (!AC2.loteId){ alert('No hay despiece abierto para eliminar.'); return; }
  var n=AC2.barras.filter(function(b){return b._guardada;}).length;
  var txt=prompt('⚠ Vas a ELIMINAR el despiece #'+(AC2.loteNum||AC2.loteId)+' y sus '+n+' barra(s) guardada(s).\n'+
    'Esta acción es IRREVERSIBLE.\n\nEscribe ELIMINAR para confirmar:');
  if (txt===null) return;                          // canceló
  if (txt.trim().toUpperCase()!=='ELIMINAR'){ alert('No se eliminó: debes escribir ELIMINAR.'); return; }
  try{
    var r=await _ac2Delete('/lotes/'+AC2.loteId);
    if (!r.ok){ var d=r.data&&r.data.detail; alert('No se pudo eliminar el despiece'+(d?': '+(d.msg||JSON.stringify(d)):' (error '+r.status+')')+'.'); return; }
    var borradas=(r.data&&r.data.barras_eliminadas)||0;
    _ac2ResetTanda();
    await ac2CargarLotes();   // esperar el refresco de la lista ANTES del alert (así la lápida ya se ve)
    alert('🗑 Despiece eliminado ('+borradas+' barra(s) borradas). Queda registrado como eliminado en el histórico.');
  }catch(e){ alert('Error de red al eliminar el despiece. Reintenta.'); }
};
// ¿El usuario actual es administrador? (admin o admin_calidad → puede purgar del histórico).
function _ac2EsAdmin(){
  return (typeof currentRole !== 'undefined') && (currentRole === 'admin' || currentRole === 'admin_calidad');
}

// 🗑 PURGAR (ADMIN): borra DEFINITIVAMENTE un despiece eliminado del histórico (no deja lápida).
// Sirve para limpiar registros mal asignados por usuarios nuevos. Irreversible. Solo admin (el
// backend también lo exige: 403 si no lo es). Pide confirmación escribiendo BORRAR.
window.ac2PurgarLote=async function(loteId, numObra){
  if (!_ac2EsAdmin()){ alert('Solo un administrador puede borrar despieces del histórico.'); return; }
  var txt=prompt('⚠ ADMIN: vas a BORRAR DEFINITIVAMENTE el despiece #'+numObra+' del histórico.\n'+
    'No quedará ningún rastro (esto NO es "eliminar con lápida", es purga total).\n\nEscribe BORRAR para confirmar:');
  if (txt===null) return;
  if (txt.trim().toUpperCase()!=='BORRAR'){ alert('No se borró: debes escribir BORRAR.'); return; }
  try{
    var r=await _ac2Delete('/lotes/'+loteId+'/purgar');
    if (!r.ok){ var d=r.data&&r.data.detail; alert('No se pudo purgar el despiece'+(d?': '+(d.msg||JSON.stringify(d)):' (error '+r.status+')')+'.'); return; }
    await ac2CargarLotes();
    alert('🗑 Despiece #'+numObra+' borrado definitivamente del histórico.');
  }catch(e){ alert('Error de red al purgar el despiece. Reintenta.'); }
};

// Resetea el FORMULARIO para volver a "crear lote" (sin cambiar de obra): limpia lote/barras/
// sector/estructura/ciclo/eje y vuelve a la cabecera con el botón Crear lote. Reutilizado tras
// guardar un lote (volver a crear otro) y tras eliminar.
// Si el lote en curso está VACÍO (borrador, sin ninguna barra guardada), lo borra físicamente en
// el backend para no ensuciar el histórico y liberar su num_obra. Fire-and-forget (no bloquea). El
// backend solo borra si de verdad está vacío (0 barras, borrador), así que es seguro llamarlo.
function _ac2DescartarLoteVacioSiCorresponde(){
  if (!AC2.loteId || AC2.loteEstado!=='borrador') return;
  var hayGuardadas=AC2.barras.some(function(b){ return b._guardada; });
  if (hayGuardadas) return;   // tiene barras guardadas → NO es vacío, no se toca
  _ac2Delete('/lotes/'+AC2.loteId+'/vacio');   // fire-and-forget
}
function _ac2ResetTanda(){
  _ac2DescartarLoteVacioSiCorresponde();   // borra el lote vacío antes de soltarlo
  AC2.loteId=null; AC2.loteNum=null; AC2.loteEstado=''; AC2.barras=[]; AC2.sector=''; AC2.estructura=''; AC2.tipo='TODOS'; AC2.plano='';
  AC2.ciclo=''; AC2.eje='';
  AC2.creando=false; AC2.ctxFijado=false;   // flujo por etapas: tras descartar/cerrar, volver a etapa 1 (obra sin lote)
  ac2LimpiarSeleccion();
  if (_ac2CbCiclo) _ac2CbCiclo.limpiar();
  if (_ac2CbEje)   _ac2CbEje.limpiar();
  ac2PintarEstado(); ac2PintarSectorEstructura(); ac2PintarSubtabs();
  ac2ActualizarBotonesCrear(); ac2ActualizarCabecera(); ac2SetTipo('TODOS'); ac2CargarLotes();
  // Soltamos el lote → el índice de estructuras que se ve en pantalla es del lote anterior.
  // Se vacía aquí y no en cada llamador para que no quede colgando en ninguna ruta de salida.
  window.ac2PintarEstructuras([]);
}


// Carga TODOS los lotes de la obra en el repositorio (GET /lotes?proyecto=X, con n_barras/kg
// reales). Permite ver que los lotes guardados SIGUEN existiendo entre sesiones y (a futuro)
// retomarlos. Los datos viven en BD; esta lista los muestra aunque recargues la página.
// Ver despieces eliminados en el histórico (checkbox "Ver eliminados"). Por defecto OCULTOS para no
// ensuciar la vista; el usuario los muestra si quiere consultarlos.
var _ac2VerEliminados=false;
window.ac2ToggleVerEliminados=function(on){ _ac2VerEliminados=!!on; ac2CargarLotes(); };
async function ac2CargarLotes(){
  var tb=document.getElementById('ac2_lotesBody'); if(!tb) return;
  if (!AC2.proyecto){ tb.innerHTML='<tr><td colspan="8" style="padding:10px 8px; color:#90a4ae; font-style:italic; text-align:center;">Elige una obra para ver sus despieces.</td></tr>'; return; }
  var lotes=[];
  try { var d=await _ac2Get('/lotes?proyecto='+encodeURIComponent(AC2.proyecto)); lotes=(d&&d.lotes)||[]; }
  catch(e){ lotes=[]; }
  // Filtrar eliminados salvo que el checkbox esté marcado.
  if (!_ac2VerEliminados) lotes=lotes.filter(function(l){ return l.estado!=='eliminado'; });
  if (!lotes.length){ tb.innerHTML='<tr><td colspan="11" style="padding:10px 8px; color:#90a4ae; font-style:italic; text-align:center;">'+(_ac2VerEliminados?'Esta obra aún no tiene despieces.':'Esta obra no tiene despieces activos.')+'</td></tr>'; return; }
  tb.innerHTML=lotes.map(function(l){
    var esta=(l.id===AC2.loteId);
    var eliminado=(l.estado==='eliminado');
    var estado = eliminado
      ? '<span style="background:#f5f5f5; color:#9e9e9e; border:1px solid #e0e0e0; padding:1px 8px; border-radius:8px;">🗑 Eliminado</span>'
      : (l.estado==='terminada'
        ? '<span style="background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; padding:1px 8px; border-radius:8px;">🏁 Terminado</span>'
        : '<span style="background:#fff3e0; color:#e65100; border:1px solid #ffb74d; padding:1px 8px; border-radius:8px;">🚩 En edición</span>');
    var fecha=(l.creado_fecha||'').slice(0,10);
    // KPIs del despiece (azul fuerte). El Ø prom viene ponderado por peso desde el
    // backend; PPB (kg/barra física) y PPI (kg/item) se derivan aquí — mismo criterio
    // que el KPI de obra (barras.py). Sin datos → '—' (no 0, que se leería como dato).
    var _kpiTd=function(txt,tit){ return '<td style="padding:6px 8px; text-align:right; color:#0d47a1; font-weight:600;" title="'+tit+'">'+txt+'</td>'; };
    var _kg=Number(l.kg||0);
    var _dp=Number(l.diam_prom||0);
    var _ppb=(Number(l.n_barras)>0)?(_kg/Number(l.n_barras)):null;
    var _ppi=(Number(l.n_items)>0)?(_kg/Number(l.n_items)):null;
    var kpis=_kpiTd(_dp?ac2Num(_dp,1):'—','Ø promedio ponderado por peso')+
             _kpiTd(_ppb!=null?ac2Num(_ppb,2):'—','Peso Por Barra física = Kg / Barras')+
             _kpiTd(_ppi!=null?ac2Num(_ppi,2):'—','Peso Por Item = Kg / Items');
    // LÁPIDA (eliminado): fila en gris, CLICKEABLE para VER su contenido en solo-lectura (desde el
    // snapshot congelado). Muestra quién/cuándo lo eliminó.
    if (eliminado){
      var elim=(l.eliminado_fecha||'').slice(0,10);
      return '<tr class="ac2loterow" onclick="ac2RetomarLote('+l.id+')" title="Ver el contenido de este despiece eliminado (solo lectura)" style="border-top:1px solid #f0f0f0; color:#9e9e9e; background:#fafafa; cursor:pointer;">'+
        '<td style="padding:6px 8px; font-weight:600;">#'+(l.num_obra||l.id)+'</td>'+
        '<td style="padding:6px 8px;">'+ac2Esc(l.sector||'—')+' · '+ac2Esc(l.ciclo||'—')+' · '+ac2Esc(l.eje||'—')+'</td>'+
        '<td style="padding:6px 8px;">'+estado+'</td>'+
        '<td style="padding:6px 8px; text-align:right;" title="Items que tenía al eliminarse">'+(l.n_items||0)+'</td>'+
        '<td style="padding:6px 8px; text-align:right;" title="Barras que tenía al eliminarse">'+ac2Num(l.n_barras||0)+'</td>'+
        '<td style="padding:6px 8px; text-align:right;" title="Kg que tenía al eliminarse">'+ac2Num(l.kg,1)+'</td>'+
        kpis+
        '<td style="padding:6px 8px;">'+ac2Esc(fecha)+'</td>'+
        '<td style="padding:6px 8px; text-align:right; white-space:nowrap; font-size:10px;">'+
          '<span onclick="event.stopPropagation(); ac2DuplicarLotePrompt('+l.id+','+(l.num_obra||l.id)+')" title="Duplicar este despiece en otro ciclo/eje" style="color:#1565c0; cursor:pointer; margin-right:10px;">⎘ duplicar</span>'+
          (_ac2EsAdmin() ? '<span onclick="event.stopPropagation(); ac2PurgarLote('+l.id+','+(l.num_obra||l.id)+')" title="ADMIN: borrar DEFINITIVAMENTE este despiece del histórico (no deja rastro)" style="color:#c62828; cursor:pointer; margin-right:10px;">🗑 borrar del histórico</span>' : '')+
          '<span title="Eliminado por '+ac2Esc(l.eliminado_por||'?')+' el '+ac2Esc(elim)+'">👁 ver · por '+ac2Esc((l.eliminado_por||'').split('@')[0])+'</span>'+
        '</td></tr>';
    }
    // Fila COMPLETA como hiperlink: hover la resalta, click retoma el lote.
    return '<tr class="ac2loterow" onclick="ac2RetomarLote('+l.id+')" title="Abrir este despiece para verlo/seguir editándolo" style="border-top:1px solid #f0f0f0; cursor:pointer;'+(esta?' background:#f1f8e9;':'')+'">'+
      '<td style="padding:6px 8px; font-weight:600; color:#558B2F;">#'+(l.num_obra||l.id)+(esta?' •':'')+'</td>'+
      '<td style="padding:6px 8px;">'+ac2Esc(l.sector||'—')+' · '+ac2Esc(l.ciclo||'—')+' · '+ac2Esc(l.eje||'—')+'</td>'+
      '<td style="padding:6px 8px;">'+estado+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+(l.n_items||0)+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+ac2Num(l.n_barras||0)+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+ac2Num(l.kg,1)+'</td>'+
      kpis+
      '<td style="padding:6px 8px; color:#888;">'+ac2Esc(fecha)+'</td>'+
      '<td style="padding:6px 8px; text-align:right; white-space:nowrap; font-size:11px;">'+
        '<span onclick="event.stopPropagation(); ac2DuplicarLotePrompt('+l.id+','+(l.num_obra||l.id)+')" title="Duplicar este despiece en otro ciclo/eje" style="color:#1565c0; cursor:pointer; margin-right:10px;">⎘ duplicar</span>'+
        '<span style="color:#558B2F;">'+(l.estado==='terminada'?'🔒 ver':'✎ abrir')+'</span>'+
      '</td></tr>';
  }).join('');
}

// DUPLICAR LOTE: abre un mini-popup para elegir Ciclo y Eje del NUEVO lote (el resto de la data se
// copia tal cual). Con datalists de los ciclos/ejes de la obra (texto libre igual que en el form).
window.ac2DuplicarLotePrompt=function(loteId, numObra){
  var ov=document.getElementById('ac2_dupModal');
  if (!ov){
    ov=document.createElement('div'); ov.id='ac2_dupModal';
    ov.style.cssText='display:none; position:fixed; inset:0; z-index:300; background:rgba(0,0,0,.35);';
    ov.innerHTML='<div style="max-width:420px; margin:80px auto; background:#fff; border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,.25); padding:18px;">'+
      '<h3 style="margin:0 0 4px; color:#1565c0; font-size:16px;">⎘ Duplicar despiece <span id="ac2_dupNum"></span></h3>'+
      '<p style="margin:0 0 14px; font-size:12px; color:#607d8b;">Se copia toda la data del despiece (pisos, tipologías, medidas, cant/mult). Elige el <b>Ciclo</b> y <b>Eje</b> del nuevo despiece:</p>'+
      '<div style="display:flex; gap:10px; margin-bottom:14px;">'+
        '<div style="flex:1;"><label style="font-size:11px; color:#558B2F; font-weight:700;">Ciclo *</label><input id="ac2_dupCiclo" list="ac2_dupCiclosDL" style="width:100%; height:32px; box-sizing:border-box; font-size:13px;" placeholder="ciclo…"/><datalist id="ac2_dupCiclosDL"></datalist></div>'+
        '<div style="flex:1;"><label style="font-size:11px; color:#558B2F; font-weight:700;">Eje / Losa *</label><input id="ac2_dupEje" list="ac2_dupEjesDL" style="width:100%; height:32px; box-sizing:border-box; font-size:13px;" placeholder="eje…"/><datalist id="ac2_dupEjesDL"></datalist></div>'+
      '</div>'+
      '<div style="display:flex; justify-content:flex-end; gap:8px;">'+
        '<button onclick="ac2CerrarDup()" style="font-size:12px; padding:6px 14px; background:#fff; color:#607d8b; border:1px solid #cfd8dc; border-radius:4px; cursor:pointer;">Cancelar</button>'+
        '<button id="ac2_dupOk" style="font-size:12px; padding:6px 16px; background:#1565c0; color:#fff; border:none; border-radius:4px; cursor:pointer;">Duplicar</button>'+
      '</div></div>';
    document.body.appendChild(ov);
  }
  document.getElementById('ac2_dupNum').textContent='#'+numObra;
  // Poblar datalists con ciclos/ejes de la obra (ya cargados en el contexto).
  var dlc=document.getElementById('ac2_dupCiclosDL'), dle=document.getElementById('ac2_dupEjesDL');
  if (dlc) dlc.innerHTML=(_ac2CiclosObra||[]).map(function(c){return '<option value="'+ac2Esc(c.id)+'">';}).join('');
  if (dle) dle.innerHTML=(_ac2EjesObra||[]).map(function(e){return '<option value="'+ac2Esc(e.id)+'">';}).join('');
  document.getElementById('ac2_dupCiclo').value=''; document.getElementById('ac2_dupEje').value='';
  document.getElementById('ac2_dupOk').onclick=function(){ ac2DuplicarLote(loteId); };
  ov.style.display='block';
  setTimeout(function(){ document.getElementById('ac2_dupCiclo').focus(); }, 50);
};
window.ac2CerrarDup=function(){ var m=document.getElementById('ac2_dupModal'); if(m) m.style.display='none'; };
window.ac2DuplicarLote=async function(loteId){
  var ciclo=(document.getElementById('ac2_dupCiclo').value||'').trim();
  var eje=(document.getElementById('ac2_dupEje').value||'').trim();
  if (!ciclo || !eje){ alert('Completa Ciclo y Eje para duplicar.'); return; }
  var r=await _ac2Post('/lotes/'+loteId+'/duplicar', { ciclo:ciclo, eje:eje });
  if (!r.ok){ var d=r.data&&r.data.detail; alert('No se pudo duplicar'+(d?': '+(d.msg||d):'')+'.'); return; }
  ac2CerrarDup();
  await ac2CargarLotes();
  alert('⎘ Despiece duplicado como #'+(r.data&&r.data.num_obra)+' ('+(r.data&&r.data.barras)+' barras) en Ciclo '+ciclo+' · Eje '+eje+'.\nÁbrelo desde el repositorio para revisarlo.');
};

// ── ENFIERRADOR = TEMPLATE EDITOR CON CONTEXTO DE OBRA ──────────────────────────
// No hay dos editores ni un modal paralelo: es el MISMO Template Editor, al que se le
// pasa el contexto del despiece por la puerta (templateEditorAbrirEnObra). Sin ese
// contexto el editor se comporta igual que en el Catálogo.
window.ac2CtxEditor3D=function(){
  return { loteId:AC2.loteId, id_proyecto:AC2.proyecto||null, sector:AC2.sector||null,
           ciclo:AC2.ciclo||null, eje:AC2.eje||null, nombre_plano:AC2.plano||null,
           estructura:AC2.estructura||null };
};

// Sin argumento crea una estructura NUEVA; con instanciaId REABRE una ya cargada (su
// receta, su piso y su nombre), y al volver a cargarla el backend actualiza en vez de
// duplicar — cada barra conserva su id, su historia y su revisión.
window.ac2AbrirEditor3D=async function(instanciaId){
  if (!AC2.loteId){ alert('Crea primero el despiece (Obra + Ciclo + Eje).'); return; }
  // Despiece TERMINADO: no se puede cargar nada nuevo (el backend responde 409), pero SÍ se
  // puede mirar una estructura que ya está adentro. Antes se bloqueaban las dos cosas con el
  // mismo alert y "ver cómo quedó el muro" era imposible después de banderar.
  var soloVista = (AC2.loteEstado==='terminada' && instanciaId!=null);
  if (AC2.loteEstado!=='borrador' && !soloVista){
    // Se dice ANTES, no después de que el usuario modele la estructura completa.
    alert(AC2.loteEstado==='eliminado'
      ? 'Este despiece está eliminado: su contenido es histórico y no se puede modelar.'
      : 'Este despiece ya está terminado: sus barras se corrigen en el Bar Manager.');
    return;
  }
  if (typeof window.templateEditorAbrirEnObra!=='function'){
    alert('El editor aún se está cargando. Reintenta en un momento.'); return;
  }
  // UBICACIÓN COMPLETA ANTES DE MODELAR (25-ago). Cada barra que salga del 3D se
  // estampa con sector/ciclo/eje y el backend las exige; sin ellos el "Cargar al
  // despiece" falla — y falla al FINAL, con el elemento ya modelado. Se dice acá,
  // que es la única puerta donde el usuario todavía no ha invertido nada.
  // Con el lote devolviendo su propia ubicación esto no debería saltar nunca; queda
  // para el despiece antiguo que la tenga en null, y para que si vuelve a faltar se
  // sepa DÓNDE falta en vez de descubrirlo con un rechazo del servidor.
  var faltaUbic=[['sector',AC2.sector],['ciclo',AC2.ciclo],['eje',AC2.eje]]
    .filter(function(p){ return !String(p[1]||'').trim(); }).map(function(p){ return p[0]; });
  if (faltaUbic.length && !soloVista){
    alert('A este despiece le falta '+faltaUbic.join(', ')+'.\n\nCada barra del 3D se guarda con esa '+
          'ubicación, así que el despiece la rechazaría al cargar. Complétala arriba y vuelve a entrar.');
    return;
  }
  var opts={};
  if (instanciaId!=null){
    var d=await _ac2Get('/elementos/instancia/'+instanciaId);
    if (!d || !d.params || !d.params.geometria){
      alert('No se pudo abrir esa estructura (su receta no está disponible).'); return;
    }
    opts={ receta:d.params, piso:d.piso||'', nombre:d.nombre||'', instanciaId:d.id,
           elemento:(d.elemento||'').toUpperCase()||null, tplOrigen:d.template_id,
           soloVista:soloVista };
  }
  window.templateEditorAbrirEnObra(ac2CtxEditor3D(), opts);
};

// ── ESTRUCTURAS DEL DESPIECE (listado compacto) ──────────────────────────────────
// Para qué existe: en la grilla se ven BARRAS, y un muro son 30 barras repartidas entre
// las demás; no había forma de preguntar "¿cómo quedó ese muro?" sin cazar una de sus
// filas. Esta lista es el índice de las estructuras que hay dentro del despiece y su
// única acción es ABRIR el 3D. No mueve ni reordena los listados de barras.
window.ac2PintarEstructuras=function(lista){
  var wrap=document.getElementById('ac2_estructurasWrap'); if(!wrap) return;
  var cuerpo=document.getElementById('ac2_estructurasBody');
  var cnt=document.getElementById('ac2_estructurasCnt');
  lista=lista||[];
  // Sin estructuras el bloque se esconde entero: un despiece cubicado a mano no tiene por qué
  // cargar con una tabla vacía.
  wrap.style.display = lista.length ? '' : 'none';
  if (cnt) cnt.textContent = lista.length ? ('('+lista.length+')') : '';
  if (!cuerpo) return;
  // El 🧱 abre editable o en solo-vista según el estado del lote: esa decisión ya vive en
  // ac2AbrirEditor3D (un solo lugar), aquí solo se nombra. En un despiece ELIMINADO el 3D no
  // se abre, así que no se ofrece el botón: un control que solo puede responder con un alert
  // es un control muerto (se deja el texto explicando por qué, no se esconde la fila).
  var eliminado = (AC2.loteEstado==='eliminado');
  var verTxt = (AC2.loteEstado==='borrador') ? '🧱 Abrir' : '👁 Ver 3D';
  cuerpo.innerHTML = lista.map(function(e){
    var retirada = (e.estado==='retirada');
    var accion;
    if (eliminado) accion='<span style="color:#9e9e9e; font-size:10px;" title="Despiece eliminado: su contenido es histórico y no se abre en 3D.">— histórico</span>';
    else if (retirada) accion='<span style="color:#9e9e9e; font-size:10px;" title="Estructura retirada: sus barras ya no están en el despiece.">— retirada</span>';
    else accion='<span onclick="ac2AbrirEditor3D('+e.id+')" title="Ver esta estructura en 3D" style="color:#0277bd; cursor:pointer; font-weight:600;">'+verTxt+'</span>';
    return '<tr style="border-top:1px solid #f0f0f0;'+(retirada?' color:#9e9e9e;':'')+'">'+
      '<td style="padding:5px 8px; font-weight:600;'+(retirada?'':' color:#0277bd;')+'">'+ac2Esc(e.nombre||('#'+e.id))+'</td>'+
      '<td style="padding:5px 8px;">'+ac2Esc(e.elemento||'—')+'</td>'+
      '<td style="padding:5px 8px;">'+ac2Esc(e.piso||'—')+'</td>'+
      '<td style="padding:5px 8px; text-align:right;">'+(e.n_barras||0)+'</td>'+
      '<td style="padding:5px 8px; text-align:right;">'+ac2Num(e.kg,1)+'</td>'+
      '<td style="padding:5px 8px; text-align:right; white-space:nowrap;">'+accion+'</td></tr>';
  }).join('');
};
// Trae las estructuras del despiece y las pinta. Falla en SILENCIO VISIBLE: si el GET no
// responde, la lista queda vacía (el bloque se esconde) y el error real sale por consola —
// no se inventa contenido ni se bloquea la carga del despiece, que es lo importante.
async function _ac2CargarEstructuras(loteId){
  if (loteId==null){ window.ac2PintarEstructuras([]); return; }
  var d=await _ac2Get('/lotes/'+loteId+'/elementos');
  if (!d){ console.error('[AC2] No se pudieron cargar las estructuras del despiece '+loteId); }
  window.ac2PintarEstructuras((d && d.elementos) || []);
}

// RECARGAR el despiece abierto. El editor 3D llama a esto tras cargar barras. NO
// existía (sólo ac2CargarLotes, que es el REPOSITORIO de despieces de la obra): por eso
// al volver del enfierrador la grilla seguía mostrando lo de antes.
window.ac2CargarLote=function(id){
  var lid=(id!=null)?id:AC2.loteId;
  if (lid==null) return;
  return window.ac2RetomarLote(lid, true);
};

// RETOMAR un lote: carga sus barras (GET /lotes/{id}) y reconstruye el formulario. Un lote
// TERMINADO se abre en solo-lectura (sus barras se corrigen en Bar Manager). Uno en borrador
// se puede seguir editando. Advierte si hay cambios sin guardar en el form actual.
window.ac2RetomarLote=async function(id, forzar){
  // forzar = RECARGAR el mismo lote (lo usa ac2CargarLote tras cargar barras desde el
  // editor 3D): sin esto la grilla se quedaba mostrando lo de antes.
  if (id===AC2.loteId && !forzar) return;   // ya está abierto
  var pend=AC2.barras.filter(function(b){return !b._guardada;}).length;
  if (pend && !confirm('Tienes '+pend+' barra(s) sin guardar en el formulario. Si abres otro despiece se descartarán.\n\n¿Continuar?')) return;
  // Al RECARGAR el lote abierto no hay nada que soltar: descartar aquí borraría el
  // propio despiece que se está releyendo (AC2.barras aún es el de antes de la carga).
  if (!forzar) _ac2DescartarLoteVacioSiCorresponde();   // si el despiece actual estaba vacío, borrarlo antes de abrir otro
  var d=await _ac2Get('/lotes/'+id);
  if (!d || !d.lote){ alert('No se pudo abrir el despiece.'); return; }
  var L=d.lote, bs=d.barras||[];
  AC2.loteId=L.id; AC2.loteNum=L.num_obra||null; AC2.loteEstado=L.estado;
  AC2.plano=L.plano||'';   // M1.10: recuperar el plano del lote
  // Reponer el nombre de la obra si se perdió (título/cabecera): del input visible o del nombre guardado.
  if (!AC2._nombreObra){
    var _io2=document.getElementById('ac2_obra');
    AC2._nombreObra=(_io2 && _io2.value || '').trim() || AC2._nombreObra;
  }
  // CONTEXTO DEL LOTE — manda EL LOTE, no su primera barra (fix 25-ago).
  // Sector/ciclo/eje se estampan en CADA barra y el backend los exige, así que este
  // dato no es decorativo: es lo que hace válida una barra. Antes salía de bs[0], la
  // primera barra guardada, y por eso un despiece VACÍO —recién creado, o reabierto
  // antes de guardar nada— dejaba el contexto en blanco. En la grilla no se notaba
  // (el alta pide Sector y Estructura antes de dejar agregar), pero el editor 3D sí
  // abría: el usuario modelaba un muro completo y al "Cargar al despiece" el backend
  // lo rechazaba con 400 por ubicación faltante. El lote GUARDA su ubicación desde que
  // se crea (columnas de la migración 101, con los viejos ya rellenados desde sus
  // barras); la primera barra queda sólo como respaldo por si algún lote antiguo
  // llegara con las columnas en null.
  var b0=bs[0]||{};
  AC2.sector=L.sector||b0.sector||''; AC2.ciclo=L.ciclo||b0.ciclo||''; AC2.eje=L.eje||b0.eje||'';
  AC2.estructura=L.estructura||ac2EstructuraDeMarca(b0.marca)||AC2.estructura;
  // La OBRA del despiece también sale del lote: hasta ahora sólo la ponía el selector
  // de obra, así que cualquier camino que llegue a un lote sin pasar por él dejaba
  // AC2.proyecto en null — y ese campo viaja en el contexto del editor 3D igual que
  // sector/ciclo/eje. Es el mismo error de fondo: leer el dato de quien lo trajo en
  // vez de leerlo del registro que lo tiene.
  if (!AC2.proyecto && L.id_proyecto) AC2.proyecto=L.id_proyecto;
  // Reconstruir las barras (todas ya guardadas → _guardada=true).
  _ac2Seq=1; ac2LimpiarSeleccion();
  AC2.barras=bs.map(function(x){
    var nb=ac2NuevaBarra({ piso:x.piso||'', marca:x.marca||'', diam:x.diam, cant:x.cant, mult:x.mult,
      figura:x.figura||'', radio:x.radio, rev:!!x.revisada, suf_tipo:x.suf_tipo||'' });
    AC2_DIMKEYS.forEach(function(k){ nb[k]=x[k]; });
    ['ang1','ang2','ang3','ang4'].forEach(function(a){ nb[a]=x[a]; });
    nb._guardada=true; nb._dbid=x.id;   // id de BD para sincronizar revisada (/revisar) al terminar
    nb._sync=_ac2Snapshot(nb);          // FOTO del estado guardado: contra ella se detectan ediciones (PATCH al 💾)
    // ORIGEN de la barra: 'csv' | 'manual' | 'template' (las nacidas del editor 3D).
    // Un despiece puede tener de varias clases y el front tiene que distinguirlas.
    nb._origen=x.origen||''; nb._instanciaId=(x.template_instancia_id!=null?x.template_instancia_id:null);
    return nb;
  });
  // Sincronizar tipologías de la estructura + reflejar contexto en los comboboxes/chips.
  if (AC2.estructura){ AC2_TIPOS=(AC2_TIPOS_MAP[AC2.estructura]||[]).map(function(t){return t.codigo;}); AC2_ORD_TIPO={}; AC2_TIPOS.forEach(function(t,i){ AC2_ORD_TIPO[t]=i; }); }
  if (_ac2CbCiclo) _ac2CbCiclo.setValor({id:AC2.ciclo,label:AC2.ciclo});
  if (_ac2CbEje)   _ac2CbEje.setValor({id:AC2.eje,label:AC2.eje});
  AC2.tipo='TODOS';
  ac2PintarSectorEstructura(); ac2PintarSubtabs(); ac2PintarEstado(); ac2ActualizarCabecera();
  // Cargar los pisos de la obra ANTES de pintar la grilla: _ac2CargarPisos es async y si no se
  // espera, ac2SetTipo renderiza los <select> de piso con _ac2Pisos aún vacío → el desplegable
  // salía sin pisos al retomar un despiece (carrera). Con await, la grilla se pinta con los pisos ya
  // disponibles. Si falla la carga, igual se renderiza (los pisos existentes de las barras aparecen).
  try { await _ac2CargarPisos(); } catch(e) {}
  ac2SetTipo('TODOS'); ac2CargarLotes();
  // Índice de estructuras del despiece: se pide DESPUÉS de tener el lote fijado en AC2, porque
  // el texto del botón (abrir vs ver) depende de AC2.loteEstado. Sin await, igual que el
  // repositorio: la grilla no tiene por qué esperar a esta lista.
  _ac2CargarEstructuras(L.id);
  if (L.estado==='eliminado') alert('Despiece #'+(L.num_obra||L.id)+' ELIMINADO — solo lectura (histórico).\nSe conserva su contenido para consulta; no se puede editar. Usa la ✕ para volver.');
  else if (L.estado==='terminada') alert('Despiece #'+(L.num_obra||L.id)+' TERMINADO — solo lectura.\nDesde aquí solo puedes ELIMINARLO. Para corregir una barra, usa Bar Manager.');
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
        // Antes de soltar el lote de la obra anterior: si estaba vacío (nunca se guardó), borrarlo.
        _ac2DescartarLoteVacioSiCorresponde();
        AC2.proyecto = idProyecto || null;
        // Nombre de la obra para el título del flujo por etapas (del texto visible del buscador).
        var _io = document.getElementById('ac2_obra'); AC2._nombreObra = (_io && _io.value || '').trim();
        AC2.creando = false;   // al elegir obra, arrancamos en etapa 1 (elegir/crear despiece)
        // Al cambiar de obra: se descarta la tanda en curso (ciclo/eje/lote/barras son de la
        // obra anterior). El lote guardado no se pierde (vive en BD); solo se limpia el form.
        AC2.ciclo=''; AC2.eje=''; AC2.sector=''; AC2.estructura='';
        AC2.loteId=null; AC2.loteEstado=''; AC2.barras=[]; AC2.tipo='TODOS'; ac2LimpiarSeleccion();
        if (_ac2CbCiclo) _ac2CbCiclo.limpiar();
        if (_ac2CbEje)   _ac2CbEje.limpiar();
        _ac2CiclosObra=[]; _ac2EjesObra=[];
        ac2PintarEstado(); ac2PintarSectorEstructura(); ac2PintarSubtabs();
        ac2ActualizarBotonesCrear(); ac2ActualizarCabecera(); ac2Render(); ac2CargarLotes();
        window.ac2PintarEstructuras([]);   // el índice visible era del despiece de la obra anterior
        _ac2Pisos=[]; ac2PintarMenuPisos();
        if (AC2.proyecto){ _ac2CargarContexto(AC2.proyecto); _ac2CargarPisos(); }
        if (typeof ac2CargarGrafico==='function') ac2CargarGrafico();   // gráfico → esta obra (o todas si se deseleccionó)
      }
    });
  }
  if (!window.Combobox) return;   // combobox.js aún no cargó (ciclo/eje lo usan)
  // Ciclo: texto libre (se puede escribir uno nuevo o elegir uno existente de la obra). onInput
  // pinta el botón Crear lote mientras se escribe; onSelect fija el valor final.
  if (iC && !_ac2CbCiclo){
    _ac2CbCiclo = Combobox.crear(iC, {
      items: function(){ return _ac2CiclosObra; },
      textoLibre: true,
      placeholder: '🔍 buscar o escribir ciclo…',
      onInput: function(v){ AC2.ciclo=String(v||'').trim(); ac2ActualizarCabecera(); },
      onSelect: function(it){ AC2.ciclo = it ? it.id : (_ac2CbCiclo ? _ac2CbCiclo.getTexto().trim() : ''); ac2ActualizarCabecera(); }
    });
  }
  // Eje/Losa: texto libre (el cubicador puede crear un eje nuevo).
  if (iE && !_ac2CbEje){
    _ac2CbEje = Combobox.crear(iE, {
      items: function(){ return _ac2EjesObra; },
      textoLibre: true,
      placeholder: '🔍 buscar o escribir eje…',
      onInput: function(v){ AC2.eje=String(v||'').trim(); ac2ActualizarCabecera(); },
      onSelect: function(it){ AC2.eje = it ? it.id : (_ac2CbEje ? _ac2CbEje.getTexto().trim() : ''); ac2ActualizarCabecera(); }
    });
  }
  // RESPALDO robusto del pintado: escuchar `input` NATIVO en obra/ciclo/eje. Así el botón Crear
  // lote se repinta en CADA tecla, sin depender del wiring interno del combobox/buscador (evita
  // el caso "escribí ciclo y eje y el botón no se pintó"). ac2ActualizarCabecera relee los 3
  // valores del DOM, así que es idempotente. Marcamos el input para no duplicar el listener.
  ['ac2_obra','ac2_ciclo','ac2_eje'].forEach(function(id){
    var el=document.getElementById(id);
    if (el && !el._ac2CabHook){ el._ac2CabHook=true; el.addEventListener('input', ac2ActualizarCabecera); el.addEventListener('change', ac2ActualizarCabecera); }
  });
}

// Puebla el <datalist id=ac2_figDatalist> de la grilla desde el catálogo YA cargado (_ac2Figuras).
// Se llama en CADA montaje del tab: el datalist es un elemento del DOM que se re-inyecta al
// re-entrar, así que hay que repoblarlo aunque los datos ya estén cacheados (antes el guard de
// _ac2CargarFiguras retornaba temprano y dejaba el datalist vacío tras un re-montaje → el filtro
// de figuras no ofrecía opciones, sobre todo visible en obras sin barras que lo enmascaren).
function _ac2PoblarDatalistFiguras(){
  var dl=document.getElementById('ac2_figDatalist'); if(!dl) return;
  var codigos=Object.keys(_ac2Figuras);
  dl.innerHTML=codigos.map(function(c){ return '<option value="'+ac2Esc(c)+'"></option>'; }).join('');
}
// Catálogo de figuras (GET /figuras-catalogo). Cachea _ac2Figuras[codigo] = {parciales, angulos,
// radio, geometria}. La descarga se hace UNA vez; el datalist se (re)puebla SIEMPRE.
async function _ac2CargarFiguras(){
  if (!Object.keys(_ac2Figuras).length){   // descargar solo si no está en caché
    var figs=[];
    try { var d=await apiGet('/figuras-catalogo'); figs=(d && d.figuras)||[]; } catch(e){ figs=[]; }
    figs.forEach(function(f){ if(f && f.codigo) _ac2Figuras[f.codigo]=f; });
  }
  _ac2PoblarDatalistFiguras();   // repoblar el datalist del DOM actual (aunque venga de caché)
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
  // PARTIR LIMPIO al (re)entrar al tab: si venías de otra sección con un despiece a medias, se
  // resetea el formulario. Si ese despiece estaba VACÍO (nunca se guardó), se descarta en la BD
  // (no ensucia el histórico). Si tenía barras guardadas, quedan en su lote del repositorio; el
  // formulario igual parte limpio (se retoma desde el repositorio si hace falta).
  var pendSinGuardar=AC2.barras.some(function(b){ return !b._guardada; });
  if (AC2.loteId || AC2.barras.length || AC2.ciclo || AC2.eje || pendSinGuardar){
    _ac2ResetTanda();   // limpia estado + descarta lote vacío + reinicia la cabecera
  } else {
    ac2PintarSectorEstructura(); ac2PintarSubtabs(); ac2ActualizarCabecera();
    ac2SetTipo(AC2.tipo || 'TODOS');
  }
  // Flujo por etapas: al entrar (etapa 0), poblar la landing de obras + el gráfico (todas las obras).
  if (typeof ac2CargarLandingObras==='function') ac2CargarLandingObras();
  if (typeof ac2CargarGrafico==='function') ac2CargarGrafico();
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

// M1.4: PUT por la misma convención /api/v1 + auth compartida (shape histórico).
async function _ac2Put(url, body){
  var r = await _ac2Req('PUT', url, body||{});
  return r.ok ? Object.assign({ok:true}, r.data) : { ok:false, status:r.status, data:r.data };
}

// Init al cargar el módulo (el markup ya está en el DOM por el {% include %}). El loader
// del tab vuelve a correr al activarlo; ambas rutas son idempotentes. Carga también el catálogo
// de figuras y las tipologías (poblar el datalist de figuras aquí evita que quede vacío si el
// tab se monta por esta ruta y no por loadAgregarCubicacion2).
function _ac2Init(){
  if(!document.getElementById('ac2_grid')) return;
  _ac2InitComboboxes(); ac2PintarSectorEstructura(); ac2PintarSubtabs(); ac2ActualizarCabecera(); ac2SetTipo('TODOS');
  _ac2CargarFiguras(); _ac2CargarTipologias(); _ac2CargarObras();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _ac2Init);
else _ac2Init();
