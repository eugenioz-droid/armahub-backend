// =============================================================================
// Modelador 3D — VIGA-SEMILLA (F1 · T1.2)
// Receta DE DATA (no código) que el 3D Template carga por defecto para que el
// usuario AJUSTE, no construya de cero. Corresponde a la maqueta template3d:
//   - CBS (cabezal superior) 103B ø16, 2 capas × 3 barras
//   - CBI (cabezal inferior) 101A ø18, 1 capa × 4 barras
//   - ES  (estribo) 104D ø8, por 3 zonas (10/20/10)
//   - TRV (traba) 101A ø8 (1 traba lineal a lo largo, cara lateral)
//
// dims: cada dimensión de la figura es {modo:'fija',valor} o {modo:'auto'} (se
// deriva del elemento). Estructura idéntica al modelo de datos del guion.
//
// MODELO ADITIVO (§DISCOVERY-INTERACCIÓN-2 · campos aditivos al componente): cada
// componente lleva además campos OPCIONALES que HOY no cambian nada (defaults null)
// pero abren empalmes / prioridad / dependencias sin romper la receta:
//   - comp_id   : id estable del componente ('CBS','CBI','ES','TRV'). Lo usan
//                 prioridad/depende_de para referenciar componentes por id.
//   - prioridad : nº global único (1 = más afuera). null = no participa del
//                 retranqueo por prioridad. NO se implementa aún (solo el DATO).
//   - empalme   : { extremo:'inicio'|'fin'|null, valor:string|number } | null.
//                 Alarga el extremo indicado (valor fórmula '60*phi+1' u override).
//   - depende_de: [{ comp_id, holgura }] | null. Retranqueo hacia el núcleo
//                 respecto de otros componentes. NO se implementa aún (solo el DATO).
//   - modo      : 'puntual'|'lineal'|'arreglo' — MODO DE USO, independiente de la
//                 tipología (§INTERACCIÓN-2.0). Preset por tipología: cabezal/CB
//                 -> 'puntual'; estribo/traba -> 'lineal'. Editable en otra tarea.
//                 Solo DATO: NO cambia el despacho (sigue por distribucion.modo).
//   - plano_pieza: { volteado:false } — plano de trabajo de la pieza (rotar 90°
//                 después). volteado:false = comportamiento IDÉNTICO al actual.
//   - arreglo   : { n_capas:1, sep_capas:20, rango:null } — params del modo arreglo.
//                 n_capas:1 = una sola fila = igual que hoy. Lógica NO implementada.
// Y a geometria: contorno = null (usa la caja rect actual; a futuro polígono).
// =============================================================================
(function (global) {
  'use strict';

  function semillaViga() {
    return {
      tipo: 'viga',
      geometria: {
        largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3,
        contorno: null   // null = caja rect (boundaryDeVista); a futuro polígono
      },
      componentes: [
        {
          comp_id: 'CBS',
          tipologia: 'CBS', figura: '103B', diam: 16, suf_tipo: 'sup', cara: 'sup',
          recub_override: null, angulos: [45, 45],
          prioridad: null, empalme: null, depende_de: null,
          modo: 'puntual', plano_pieza: { volteado: false },
          arreglo: { n_capas: 1, sep_capas: 20, rango: null },
          dims: {
            A: { modo: 'fija', valor: 30 },
            B: { modo: 'auto' },
            C: { modo: 'fija', valor: 30 }
          },
          distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 4, sentido: 'nucleo' }
        },
        {
          comp_id: 'CBI',
          tipologia: 'CBI', figura: '101A', diam: 18, suf_tipo: 'inf', cara: 'inf',
          recub_override: null, angulos: [],
          prioridad: null, empalme: null, depende_de: null,
          modo: 'puntual', plano_pieza: { volteado: false },
          arreglo: { n_capas: 1, sep_capas: 20, rango: null },
          dims: { A: { modo: 'auto' } },
          distribucion: { modo: 'layered', n_capas: 1, barras_capa: 4, gap: 0, sentido: 'nucleo' }
        },
        {
          comp_id: 'ES',
          tipologia: 'ES', figura: '104D', diam: 8, suf_tipo: 'estribo', cara: 'lateral',
          recub_override: null, angulos: [135, 135],
          prioridad: null, empalme: null, depende_de: null,
          modo: 'lineal', plano_pieza: { volteado: false },
          arreglo: { n_capas: 1, sep_capas: 20, rango: null },
          dims: {
            A: { modo: 'auto' }, B: { modo: 'auto' },
            C: { modo: 'auto' }, D: { modo: 'auto' }
          },
          distribucion: {
            modo: 'linear',
            zonas: [{ long: 150, sep: 10 }, { long: 300, sep: 20 }, { long: 150, sep: 10 }],
            start_offset: 4
          }
        },
        {
          comp_id: 'TRV',
          tipologia: 'TRV', figura: '101A', diam: 8, suf_tipo: 'traba', cara: 'lateral',
          recub_override: null, angulos: [],
          prioridad: null, empalme: null, depende_de: null,
          modo: 'lineal', plano_pieza: { volteado: false },
          arreglo: { n_capas: 1, sep_capas: 20, rango: null },
          dims: { A: { modo: 'auto' } },
          distribucion: {
            modo: 'linear',
            zonas: [{ long: 600, sep: 40 }],
            start_offset: 4
          }
        }
      ]
    };
  }

  var API = { semillaViga: semillaViga };
  global.ModeladorSemilla = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
