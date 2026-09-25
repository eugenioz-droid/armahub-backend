// Test headless (Node) de la grilla del EDITOR DE DESPIECES: columna Tipología y columna
// Sufijo, y qué hace falta de verdad para que una barra se pueda guardar.
//
// QUÉ ARREGLÓ ESTO (25-sep, reportado por el usuario):
//  1. Tipología y Sufijo salían SÓLO en la vista TODOS. Dentro de un subtab (Fs, F'i…) no se
//     veían, así que una barra mal clasificada no se podía corregir donde se está cubicando:
//     había que salir a TODOS. Que la tipología esté implícita en el subtab no es razón para
//     esconder el dato.
//  2. El Sufijo se leía como OBLIGATORIO. No lo es —ni el front ni el backend lo exigen— pero
//     es un campo vacío en medio del recorrido con Tab, justo después de la tipología: en el
//     lote 305 hay cuatro barras guardadas con un "." de sufijo, puesto sólo para avanzar.
//     Ahora la cabecera dice "(opc.)" y el placeholder dice "opcional".
//  3. Al quedar la tipología editable en TODAS las vistas quedaba abierta la puerta contraria:
//     dejarla en "— tipo —" guardaba la barra con marca vacía, fuera de todo subtab y de
//     cualquier agrupación. Ahora la opción vacía sólo existe mientras la barra no tenga
//     tipología, y una barra sin tipología no cuenta como completa (como el piso).
//
// Corre el agregar_cubicacion2.js REAL sobre un mini-DOM. Correr con:
//   node tests/test_ac2_tipologia_sufijo.js
'use strict';
const fs = require('fs'); const vm = require('vm');
const SRC = 'C:\\EZ Developer\\Rep\\armahub-backend\\armahub\\static\\js\\features\\cubicacion\\agregar_cubicacion2.js';
const noop = () => {}; const el = {}; let cargando = true;
function E(id){ if(!el[id]) el[id]={id,style:{},textContent:'',value:'',checked:false,disabled:false,innerHTML:'',className:'',appendChild:noop,addEventListener:noop,setAttribute:noop,getAttribute:()=>null,focus:noop,select:noop,classList:{add:noop,remove:noop,toggle:noop}}; return el[id]; }
const doc={getElementById:(id)=>(cargando?null:E(id)),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>E('_'+Math.random()),body:E('_b')};
const avisos=[];
const S={console,window:{},document:doc,setTimeout:(f)=>f&&f(),alert:(m)=>avisos.push(String(m))};
S.window.document=doc; vm.createContext(S); vm.runInContext(fs.readFileSync(SRC,'utf8'),S,{filename:'ac2.js'}); cargando=false;

const AC2=S.AC2;
S._ac2Figuras={'105A':{codigo:'105A',parciales:['A','B','C','D','E'],angulos:[],radio:false}};
S.AC2_TIPOS=['Fi','Fs',"F'i","F's",'F',"F'",'SP','Rp','TRL'];
AC2.loteId=99; AC2.loteEstado='borrador'; AC2.sector='LCIELO'; AC2.estructura='LOSA';
AC2.masiva=false; AC2.render=true; AC2.seleccion={}; AC2.verMult=false; AC2.orden='piso';

let f=0; const ok=(c,m)=>{ console.log((c?'  OK   ':'  FALLA ')+m); if(!c) f++; };

// --- 1) columnas visibles en un SUBTAB ---
AC2.tipo='Fs';
const th=S.ac2Thead();
ok(/>Tipología</.test(th), 'en el subtab Fs la cabecera trae Tipología');
ok(/>Sufijo/.test(th), 'y trae Sufijo');
ok(/\(opc\.\)/.test(th), 'y el Sufijo dice (opc.)');

const b=S.ac2NuevaBarra({piso:'P1',marca:'Fs',diam:8,cant:22,mult:1,figura:'105A'});
b.dim_a=85;b.dim_b=11;b.dim_c=617;b.dim_d=11;b.dim_e=86; AC2.barras=[b];
const fila=S.ac2Fila(b);
ok(/data-col="marca"/.test(fila), 'la fila del subtab trae el select de tipología');
ok(/data-col="suf_tipo"/.test(fila), 'y el campo de sufijo');
ok(/placeholder="opcional"/.test(fila), 'con placeholder "opcional"');
ok(!/— tipo —/.test(fila), 'y SIN la opción vacía (la barra ya tiene tipología: no se puede dejar sin)');

// --- 2) guardar SIN sufijo sigue funcionando ---
ok(b.suf_tipo==='' && S.ac2BarraLista(b)===true, 'una barra sin sufijo está COMPLETA (el sufijo nunca fue obligatorio)');
ok(S.ac2Payload(b).suf_tipo===null, 'y viaja con suf_tipo null, sin bloquear nada');

// --- 3) tipología obligatoria ---
const c=S.ac2NuevaBarra({piso:'P1',diam:8,cant:1,mult:1,figura:'105A'}); c.marca='';
c.dim_a=85;c.dim_b=11;c.dim_c=617;c.dim_d=11;c.dim_e=86;
ok(S.ac2BarraLista(c)===false, 'una barra SIN tipología ya NO cuenta como completa (antes se guardaba con marca vacía)');
const filaC=S.ac2Fila(c);
ok(/— tipo —/.test(filaC), 'y ahí sí aparece "— tipo —" para poder elegirla');
ok(/data-col="marca"[^>]*/.test(filaC) && /ffebee/.test(filaC), 'marcada en rojo como el piso faltante');

// --- 4) colspan del header de grupo ---
AC2.tipo='Fs';
const hdr=S.ac2GrupoHdr('P1',2,true);
const m=/colspan="(\d+)"/.exec(hdr);
const cols=(S.ac2Thead().match(/<th/g)||[]).length;
ok(m && Number(m[1])===cols, 'el colspan del grupo ('+(m&&m[1])+') coincide con las columnas reales ('+cols+')');

// --- 5) cambiar tipología en un subtab saca la barra de la vista ---
AC2.barras=[b]; AC2.tipo='Fs';
ok(S.ac2Visibles().length===1, 'en Fs se ve la barra Fs');
let repinto=false; S.ac2Render=()=>{repinto=true;};
S.window.ac2SetBarra(b._id,'marca','Fi');
ok(b.marca==='Fi', 'cambiar la tipología en el subtab sí cambia el dato');
ok(repinto===true, 'y re-renderiza para que la fila se vaya a su tipología');
ok(S.ac2Visibles().length===0, 'ya no se ve en Fs');

// --- 6) el 💾 dice la VERDAD segun el caso -------------------------------------------
// ESTE ERA EL MISTERIO DE HANS. Con TODO ya guardado y sin cambios, volver a apretar 💾
// soltaba "Aún no hay ninguna barra COMPLETA para guardar". El cubicador leía que sus
// barras estaban incompletas, miraba la fila buscando el hueco y concluía que era la
// única celda vacía a la vista: el Sufijo. De ahí salieron las 4 barras del lote 305
// guardadas con un "." — el sufijo nunca tuvo nada que ver.
(async () => {
  S._ac2Post=async()=>({ok:true,status:200,data:{ok:true,creadas:1,ids:[1]}});
  S._ac2Patch=async()=>({ok:true,status:200,data:{}});
  S.ac2PintarEstado=noop; S.ac2ActualizarCabecera=noop; S.ac2Render=noop;
  S.ac2CargarLotes=noop; S._ac2LeerContexto=noop;
  AC2.tipo='TODOS';

  const completa=(marca)=>{ const x=S.ac2NuevaBarra({piso:'P1',marca:marca,diam:8,cant:1,mult:1,figura:'105A'});
    x.dim_a=85;x.dim_b=11;x.dim_c=617;x.dim_d=11;x.dim_e=86; return x; };

  // a) despiece sin ninguna barra
  AC2.barras=[]; avisos.length=0; await S.window.ac2Guardar();
  ok(/todavía no tiene barras/i.test(avisos[0]||''), 'sin barras: dice que hay que agregarlas — ['+(avisos[0]||'').split('\n')[0]+']');

  // b) TODO guardado y sin cambios = el caso de Hans
  const g1=completa('Fi'), g2=completa('Fs');
  [g1,g2].forEach(x=>{ x._guardada=true; x._dbid=1; x._sync=S._ac2Snapshot(x); });
  AC2.barras=[g1,g2]; avisos.length=0; await S.window.ac2Guardar();
  ok(/Todo guardado/i.test(avisos[0]||''), 'todo guardado: lo dice, ya no acusa barras incompletas — ['+(avisos[0]||'').split('\n')[0]+']');
  ok(!/COMPLETA para guardar/.test(avisos[0]||''), 'y NO sale el mensaje que hizo creer que faltaba el sufijo');

  // c) hay una barra de verdad incompleta → ahí sí corresponde el mensaje, y aclara el sufijo
  const mala=S.ac2NuevaBarra({piso:'P1',marca:'Fi',cant:1,mult:1});   // sin φ ni figura
  AC2.barras=[g1,g2,mala]; avisos.length=0; await S.window.ac2Guardar();
  ok(/COMPLETA para guardar/.test(avisos[0]||''), 'con una barra a medio llenar sí sale el aviso de incompleta');
  ok(/Sufijo es OPCIONAL/i.test(avisos[0]||''), 'y ese aviso ahora dice que el sufijo es OPCIONAL');

  console.log(f?('\nFALLOS: '+f):'\nTODO OK'); process.exit(f?1:0);
})();
