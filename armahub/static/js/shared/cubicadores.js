// ArmaHub — CÓMO SE ESCRIBE EL NOMBRE DE UN CUBICADOR, en toda la plataforma.
//
// En aSa la gente no tiene nombre: tiene login —`jrodriguez`, `HMONDACA`, `Nlopez`—, y ese
// login es lo que viaja en cada barra, cada pedido y cada auditoría. Mostrarlo tal cual
// deja la pantalla hablando en un idioma que no es el de la planta. El usuario (2-nov):
// «estandariza para que a todos los filtros les pongas el nombre real del cubicador:
// jrodriguez → J Rodriguez, HMONDACA → H Mondaca».
//
// EL MAPA LO ARMA EL BACKEND, que es el único que puede: hay que cruzar el login con los
// usuarios de la plataforma, y esa regla ya vive ahí (`alias_de`). Acá sólo se guarda.
//
// A QUIEN NO ES USUARIO NO SE LE INVENTA NOMBRE. Un login que no calza con nadie —`RMC`,
// `MarioP`, `aSaAdmin`, un correo suelto— se muestra como viene: es el único nombre que
// tenemos de esa persona, y escribir «M Puyo» porque el login empieza con Mario sería
// adivinar. El usuario fue explícito: «revisa los filtros activos para no ponerle nombre a
// todo el mundo».
(function (global) {
  var MAPA = null;      // null = todavía no se pidió
  var PIDIENDO = null;  // la promesa en curso, para no pedirlo dos veces

  // El nombre de este login. Si el mapa todavía no llegó, o la persona no es usuario,
  // devuelve el login: la pantalla nunca queda en blanco esperando.
  global.nomCub = function (login) {
    var l = String(login == null ? '' : login).trim();
    if (!l) return '(sin dato)';
    return (MAPA && MAPA[l]) || l;
  };

  // Se pide una vez por sesión de pantalla. Si falla, se sigue con los logins: que no se
  // pueda escribir lindo un nombre no puede dejar sin datos a la pantalla.
  global.cargarNomCub = function () {
    if (MAPA) return Promise.resolve(MAPA);
    if (PIDIENDO) return PIDIENDO;
    PIDIENDO = Promise.resolve(global.apiGet('/cubicadores/nombres'))
      .then(function (d) { MAPA = (d && d.nombres) || {}; return MAPA; })
      .catch(function () { MAPA = {}; return MAPA; })
      .then(function (m) { PIDIENDO = null; return m; });
    return PIDIENDO;
  };
})(window);
