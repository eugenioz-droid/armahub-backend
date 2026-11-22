/* armascanner/visor.js — el plano en PDF, en una ventana (21-nov, SPECS §5.4 «Vista previa sin CAD»).
 *
 * ArmaScanner imprime el plano de trabajo a PDF (fondo blanco, el plano del calculista en gris,
 * las barras y los ciclos en color) y lo guarda en ArmaHub con el plano. Acá se muestra con el
 * visor del navegador (zoom, búsqueda de texto): es la foto del plano, no el DWG.
 *
 *   window.ascVerPlano(obra, plano, autor, titulo)
 *     GET /armascanner/planos-linea/pdf?obra=&plano=&autor=  →  {url}  enlace firmado al PDF
 *     autor (opcional): de quién es la copia; titulo (opcional): lo que se lee arriba (si no, el plano)
 *
 * La ventana se arma desde acá (no está en la plantilla) y reutiliza las clases de «Ver barras»
 * (.asc-modal, .asc-modal__caja, .asc-modal__cabeza, .arm-button, .asc-vacio). Va en un contenedor
 * .arm-ds.asc propio al final de la página: se puede abrir desde cualquier pestaña.
 * Cierran: «Cerrar», Esc y el clic fuera de la ventana.
 */
(function (global) {
  'use strict';

  var ID = 'ascVisorModal';
  var est = { pedido: 0, foco: null };

  var ESTILO =
    '.asc.asc-visor-raiz { padding: 0; display: block; background: transparent; }' +
    '.asc .asc-modal.asc-visor { padding: 16px 0; overflow: hidden; align-items: stretch; }' +
    '.asc .asc-visor .asc-modal__caja { max-width: none; width: calc(100% - 32px); height: 100%; margin: 0 auto;' +
    '  display: flex; flex-direction: column; }' +
    '.asc .asc-visor .asc-modal__cabeza h3 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
    '.asc .asc-visor__acciones { display: flex; gap: 8px; flex: none; }' +
    '.asc .asc-visor__acciones a.arm-button { text-decoration: none; }' +
    '.asc .asc-visor__cuerpo { flex: 1; min-height: 0; display: flex; border: 1px solid var(--arm-border);' +
    '  border-radius: var(--arm-radius-sm); background: var(--arm-background); overflow: hidden; }' +
    '.asc .asc-visor__cuerpo iframe { flex: 1; width: 100%; height: 100%; border: 0; background: #fff; }' +
    '.asc .asc-visor__cuerpo .asc-vacio { margin: auto; }';

  function el(id) { return document.getElementById(id); }

  function armar() {
    if (el(ID)) return;
    var estilo = document.createElement('style');
    estilo.textContent = ESTILO;
    document.head.appendChild(estilo);
    var raiz = document.createElement('div');
    raiz.className = 'arm-ds asc asc-visor-raiz';
    raiz.innerHTML =
      '<div id="' + ID + '" class="asc-modal asc-visor" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="ascVisorTitulo">' +
        '<div class="asc-modal__caja">' +
          '<div class="asc-modal__cabeza">' +
            '<h3 id="ascVisorTitulo"></h3>' +
            '<div class="asc-visor__acciones">' +
              '<a class="arm-button" id="ascVisorAbrir" target="_blank" rel="noopener" style="display:none;">Abrir en pestaña nueva</a>' +
              '<button type="button" class="arm-button" id="ascVisorCerrar">Cerrar</button>' +
            '</div>' +
          '</div>' +
          '<div class="asc-visor__cuerpo">' +
            '<div class="asc-vacio" id="ascVisorEstado"></div>' +
            '<iframe id="ascVisorMarco" title="Plano en PDF" style="display:none;"></iframe>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(raiz);
    el('ascVisorCerrar').addEventListener('click', cerrar);
    el(ID).addEventListener('click', function (ev) { if (ev.target === this) cerrar(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && abierto()) cerrar();
    });
  }

  function abierto() {
    var m = el(ID);
    return !!(m && m.style.display !== 'none');
  }

  // Un solo estado a la vista: el aviso (cargando, sin PDF, error) o el PDF.
  function mostrar(aviso, url) {
    var marco = el('ascVisorMarco'), estado = el('ascVisorEstado'), abrir = el('ascVisorAbrir');
    estado.textContent = aviso || '';
    estado.style.display = url ? 'none' : '';
    marco.style.display = url ? '' : 'none';
    abrir.style.display = url ? '' : 'none';
    if (url) {
      marco.src = url;
      abrir.href = url;
    } else {
      marco.removeAttribute('src');
      abrir.removeAttribute('href');
    }
  }

  function cerrar() {
    est.pedido += 1;  // una respuesta que llegue después ya no se muestra
    mostrar('', '');
    el(ID).style.display = 'none';
    if (est.foco && est.foco.focus) est.foco.focus();
    est.foco = null;
  }

  global.ascVerPlano = async function (obra, plano, autor, titulo) {
    armar();
    var pedido = est.pedido += 1;
    est.foco = document.activeElement;
    el('ascVisorTitulo').textContent = titulo || plano || 'Plano';
    mostrar('Cargando…', '');
    el(ID).style.display = 'flex';
    el('ascVisorCerrar').focus();
    var d = null;
    try {
      d = await global.apiGet('/armascanner/planos-linea/pdf?obra=' + encodeURIComponent(obra == null ? '' : obra) +
                              '&plano=' + encodeURIComponent(plano == null ? '' : plano) +
                              (autor ? '&autor=' + encodeURIComponent(autor) : ''));
    } catch (e) {
      d = null;
    }
    if (pedido !== est.pedido) return;  // se cerró, o se abrió otro plano, mientras se pedía
    if (!d) return mostrar('No se pudo abrir el PDF.', '');
    if (!d.url) return mostrar('Este plano no tiene PDF.', '');
    mostrar('', d.url);
  };

  global.ascCerrarVisor = cerrar;
})(window);
