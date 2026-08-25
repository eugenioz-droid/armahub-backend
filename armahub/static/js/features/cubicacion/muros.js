// ═════════════════════════════════════════════════════════════════════════════
// TAB «Element Manager» — los ELEMENTOS CONSOLIDADOS de una obra.
// (se llamó «Muros» hasta el 25-ago, cuando el 3D sólo paría muros; hoy modela viga,
//  columna, fundación y genérico. Los nombres internos siguen diciendo `muros`.)
//
// POR QUÉ EXISTE: un muro modelado en el Enfierrador se disuelve en 30 barras dentro
// de un despiece; una vez terminado el despiece no había ninguna pantalla que dijera
// "estos son los muros de la obra". Este tab es esa vista, a nivel OBRA (el creador de
// despieces solo alcanza a ver el despiece abierto).
//
// QUÉ MUESTRA: solo muros con la bandera puesta (GET /elementos/estructuras filtra por
// lotes.estado='terminada'). Mientras el despiece está en borrador el muro es material
// de trabajo y se revisa desde el creador; recién al banderar pasa a ser dato de la obra.
//
// QUÉ NO HACE: no edita. El 3D se abre con soloVista → el editor bloquea toda mutación
// (las barras de un despiece terminado se corrigen en Bar Manager). El filtro por
// elemento='muro' es de LISTADO: la tipología no decide nada en el motor.
//
// Markup: templates/tabs/muros.html. Loader del tab: shell.js (tabLoaders.muros).
// ═════════════════════════════════════════════════════════════════════════════

var _murosCbObra = null;     // instancia del buscador de obra (shared/buscador_obra.js)
var _murosProyecto = null;   // id de la obra elegida
var _murosLista = [];        // último listado traído — lo escribe el LOADER, nunca el render

function _murosEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function _murosNum(v,d){ if(v==null||v===''||isNaN(v)) return ''; return d? Number(v).toFixed(d): String(Math.round(Number(v))); }

// Mensaje de estado bajo la tabla. Siempre visible cuando aplica: una tabla vacía sin
// explicación se lee como "esto se rompió".
function _murosMsg(txt){
  var m=document.getElementById('muros_msg'); if(!m) return;
  m.textContent = txt||'';
  m.style.display = txt ? '' : 'none';
}

// RENDER PURO: pinta la tabla desde la lista que recibe. No toca _murosLista ni ningún
// otro estado (quien carga es quien decide qué hay).
window.murosPintar = function(lista){
  var cuerpo=document.getElementById('muros_body'); if(!cuerpo) return;
  var res=document.getElementById('muros_resumen');
  lista = lista || [];
  if (res){
    var kg=lista.reduce(function(a,e){ return a + Number(e.kg||0); }, 0);
    res.textContent = lista.length ? (lista.length+' elemento(s) · '+_murosNum(kg,1)+' kg') : '';
  }
  cuerpo.innerHTML = lista.map(function(e){
    var ciclo=(e.ciclo||'—'), eje=(e.eje||'—');
    var fecha=String(e.fecha||'').slice(0,10);
    return '<tr style="border-top:1px solid #f0f0f0;">'+
      '<td style="padding:6px 8px; font-weight:600; color:#0277bd;">'+_murosEsc(e.nombre||('#'+e.id))+'</td>'+
      '<td style="padding:6px 8px;">'+_murosEsc(e.piso||'—')+'</td>'+
      '<td style="padding:6px 8px;">'+_murosEsc(ciclo)+' · '+_murosEsc(eje)+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+(e.n_barras||0)+'</td>'+
      '<td style="padding:6px 8px; text-align:right;">'+_murosNum(e.kg,1)+'</td>'+
      '<td style="padding:6px 8px; color:#558B2F;">#'+_murosEsc(e.num_obra!=null?e.num_obra:e.lote_id)+'</td>'+
      '<td style="padding:6px 8px; color:#888;">'+_murosEsc(String(e.creado_por||'').split('@')[0])+(fecha?' · '+_murosEsc(fecha):'')+'</td>'+
      '<td style="padding:6px 8px; text-align:right; white-space:nowrap;">'+
        '<span onclick="murosVer3D('+e.id+')" title="Ver este muro en 3D (solo visualización)" style="color:#0277bd; cursor:pointer; font-weight:600;">👁 Ver 3D</span>'+
      '</td></tr>';
  }).join('');
};

// Trae los muros de la obra y los pinta. Guarda la lista para que "Ver 3D" pueda usar el
// contexto YA resuelto por el backend (sector/ciclo/eje caen al dato del lote cuando la
// instancia los trae en NULL — las filas pre-107).
async function _murosCargar(){
  _murosLista = [];
  if (!_murosProyecto){ window.murosPintar([]); _murosMsg('Elige una obra para ver sus elementos.'); return; }
  _murosMsg('Cargando elementos…');
  var d = await apiGet('/elementos/estructuras?proyecto='+encodeURIComponent(_murosProyecto)+'&elemento=muro');
  if (!d){ window.murosPintar([]); _murosMsg('No se pudieron cargar los elementos de esta obra.'); return; }
  _murosLista = d.estructuras || [];
  window.murosPintar(_murosLista);
  // Obra sin muros banderados NO es un error: se dice por qué está vacío.
  _murosMsg(_murosLista.length ? '' : 'Esta obra aún no tiene elementos en despieces terminados. Un elemento aparece acá cuando su despiece se bandera 🚩.');
}

window.murosRecargar = function(){ _murosCargar(); };

// VER EN 3D: el mismo Template Editor, en modo solo-visualización. No hay un visor
// aparte — un solo motor y un solo modal (misma regla que el Enfierrador del creador).
window.murosVer3D = async function(instanciaId){
  if (typeof window.templateEditorAbrirEnObra!=='function'){
    alert('El editor aún se está cargando. Reintenta en un momento.'); return;
  }
  var d = await apiGet('/elementos/instancia/'+instanciaId);
  if (!d || !d.params || !d.params.geometria){
    // El error real, no un visor vacío: si la receta no está, hay que verlo.
    alert('No se pudo abrir ese muro (su receta no está disponible).'); return;
  }
  // Fila del listado: trae sector/ciclo/eje ya resueltos contra el lote. La instancia
  // manda cuando los tiene; la fila cubre a las que nacieron sin traza.
  var fila = _murosLista.filter(function(e){ return e.id===d.id; })[0] || {};
  var ctx = { loteId:d.lote_id, id_proyecto:d.id_proyecto||_murosProyecto||null,
              sector:d.sector||fila.sector||null, ciclo:d.ciclo||fila.ciclo||null,
              eje:d.eje||fila.eje||null, nombre_plano:null, estructura:null };
  window.templateEditorAbrirEnObra(ctx, {
    receta:d.params, piso:d.piso||'', nombre:d.nombre||'', instanciaId:d.id,
    elemento:(d.elemento||'').toUpperCase()||null, tplOrigen:d.template_id,
    soloVista:true
  });
};

// Monta el buscador de obra (una vez). Al elegir obra se recarga la lista.
function _murosInitCombobox(){
  if (_murosCbObra || !window.BuscadorObra) return;
  if (!document.getElementById('muros_obra')) return;
  _murosCbObra = window.BuscadorObra.crear({
    inputId:'muros_obra', datalistId:'muros_obraDatalist', selectId:'muros_obraSel',
    onElegir: function(idProyecto){
      _murosProyecto = idProyecto || null;
      _murosCargar();
    }
  });
}

// Lista de obras para el datalist (mismo endpoint que el creador de despieces).
async function _murosCargarObras(){
  var d = await apiGet('/filters');
  var proyectos = (d && d.proyectos) || [];
  if (_murosCbObra) _murosCbObra.setProyectos(proyectos);
}

// Loader del tab (shell.js lo llama al activarlo, por clic o al restaurar tras F5).
// Idempotente: el combobox se monta una vez y la obra elegida se conserva entre visitas.
window.loadMurosTab = async function(){
  if (!document.getElementById('muros_body')) return;
  _murosInitCombobox();
  await _murosCargarObras();
  if (_murosProyecto) await _murosCargar();
};
