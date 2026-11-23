// complejidad_js — la complejidad McCabe de cada función JavaScript, con la regla `complexity` de ESLint.
//
// Lo llama calidad.py: recibe por la entrada estándar [{archivo, texto}, ...] y devuelve por la salida
// [{archivo, nombre, linea, c, motivo}, ...], una fila por función.
//
// El NÚMERO lo pone ESLint (la regla reconocida, no una cuenta propia). Lo que se agrega acá es el
// NOMBRE: la base compara función por función, y el número de línea cambia con cualquier cambio de más
// arriba. El nombre sale de dónde está la función: `function f`, `var f = function`, `obj.f = function`,
// `f: function`, `f() {}`; anidada, lleva delante el de la que la contiene («render.alClic»); y una sin
// nombre (un callback) es «(anónima N)» de la que la contiene, N contando desde 1 en su orden.
//
// `motivo`: «// mccabe: <motivo>» en la línea de la función o en la de arriba deja llegar a 15
// (PROTOCOLO_GENERAL_REP §10).
'use strict';
const { Linter } = require('eslint');

const FUNCIONES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

function nombrePropio(nodo) {
  const p = nodo.parent;
  if (nodo.id && nodo.id.name) return nodo.id.name;
  if (!p) return null;
  if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  if ((p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.value === nodo) {
    if (p.key.type === 'Identifier') return p.key.name;
    if (p.key.type === 'Literal') return String(p.key.value);
  }
  if (p.type === 'AssignmentExpression' && p.right === nodo) {
    const l = p.left;
    if (l.type === 'Identifier') return l.name;
    if (l.type === 'MemberExpression' && !l.computed && l.property.type === 'Identifier') return l.property.name;
  }
  return null;
}

// Dónde empieza la función para ubicar el aviso de ESLint: un método reporta desde su nombre, que está
// en el nodo padre y no dentro de la función.
function inicio(nodo) {
  const p = nodo.parent;
  if (p && (p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.value === nodo) {
    return p.range[0];
  }
  return nodo.range[0];
}

function medirArchivo(archivo, texto) {
  const funciones = [];
  const plugin = {
    rules: {
      funciones: {
        create() {
          const pila = [];
          const anonimas = [0];
          function entrar(nodo) {
            let propio = nombrePropio(nodo);
            if (!propio) {
              anonimas[anonimas.length - 1] += 1;
              propio = '(anónima ' + anonimas[anonimas.length - 1] + ')';
            }
            const nombre = pila.length ? pila[pila.length - 1] + '.' + propio : propio;
            funciones.push({ nombre: nombre, desde: inicio(nodo), hasta: nodo.range[1], linea: nodo.loc.start.line });
            pila.push(nombre);
            anonimas.push(0);
          }
          function salir() { pila.pop(); anonimas.pop(); }
          const v = {};
          FUNCIONES.forEach(function (t) { v[t] = entrar; v[t + ':exit'] = salir; });
          return v;
        },
      },
    },
  };
  const linter = new Linter({ configType: 'flat' });
  let avisos = null;
  for (const sourceType of ['script', 'module']) {
    avisos = linter.verify(texto, [{
      files: ['**/*.js'],
      languageOptions: { ecmaVersion: 'latest', sourceType: sourceType },
      plugins: { calidad: plugin },
      rules: { complexity: ['error', { max: 0 }], 'calidad/funciones': 'error' },
    }], { filename: archivo });
    if (!avisos.some(function (a) { return a.fatal; })) break;
    funciones.length = 0;
  }
  const fatal = avisos.find(function (a) { return a.fatal; });
  if (fatal) return { error: archivo + ':' + fatal.line + ': ' + fatal.message, filas: [] };
  // De la posición del aviso a la función: la más chica que lo contiene.
  const lineas = texto.split('\n');
  const desdeLinea = [0];
  for (let i = 0; i < lineas.length; i++) desdeLinea.push(desdeLinea[i] + lineas[i].length + 1);
  const filas = [];
  for (const a of avisos) {
    if (a.ruleId !== 'complexity') continue;
    const m = /complexity of (\d+)/.exec(a.message);
    if (!m) continue;
    const pos = desdeLinea[a.line - 1] + (a.column - 1);
    let f = null;
    for (const x of funciones) {
      if (x.desde <= pos && pos < x.hasta && (!f || x.hasta - x.desde < f.hasta - f.desde)) f = x;
    }
    if (!f) continue;
    const motivo = [f.linea - 2, f.linea - 1].some(function (i) {
      return i >= 0 && i < lineas.length && lineas[i].indexOf('mccabe:') !== -1;
    });
    filas.push({ archivo: archivo, nombre: f.nombre, linea: f.linea, c: Number(m[1]), motivo: motivo });
  }
  return { error: null, filas: filas };
}

let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (d) { entrada += d; });
process.stdin.on('end', function () {
  const salida = { filas: [], errores: [] };
  for (const { archivo, texto } of JSON.parse(entrada)) {
    const r = medirArchivo(archivo, texto);
    if (r.error) salida.errores.push(r.error);
    salida.filas.push(...r.filas);
  }
  process.stdout.write(JSON.stringify(salida));
});
