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
// =============================================================================
(function (global) {
  'use strict';

  function semillaViga() {
    return {
      tipo: 'viga',
      geometria: { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
      componentes: [
        {
          tipologia: 'CBS', figura: '103B', diam: 16, suf_tipo: 'sup', cara: 'sup',
          recub_override: null, angulos: [45, 45],
          dims: {
            A: { modo: 'fija', valor: 30 },
            B: { modo: 'auto' },
            C: { modo: 'fija', valor: 30 }
          },
          distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 4, sentido: 'nucleo' }
        },
        {
          tipologia: 'CBI', figura: '101A', diam: 18, suf_tipo: 'inf', cara: 'inf',
          recub_override: null, angulos: [],
          dims: { A: { modo: 'auto' } },
          distribucion: { modo: 'layered', n_capas: 1, barras_capa: 4, gap: 0, sentido: 'nucleo' }
        },
        {
          tipologia: 'ES', figura: '104D', diam: 8, suf_tipo: 'estribo', cara: 'lateral',
          recub_override: null, angulos: [135, 135],
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
          tipologia: 'TRV', figura: '101A', diam: 8, suf_tipo: 'traba', cara: 'lateral',
          recub_override: null, angulos: [],
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
