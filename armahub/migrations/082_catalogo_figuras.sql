-- catalogo Armacero: figuras + tipologias + relacion tipologia-figura (5M.1)
-- Catalogo UNICO (fuente de verdad). Portado de typology_catalog.py de ArmaPilot.

-- Figuras: cada una define que slots de dimension usa (parciales), sus angulos y si usa radio.
-- parciales: array de letras de slot (A..I) -> mapea a dim_a..dim_i de barras. Puede ser no contiguo.
-- angulos: array de grados (los angulos que la figura dobla).
CREATE TABLE IF NOT EXISTS figuras_catalogo (
    codigo TEXT PRIMARY KEY,
    parciales TEXT[] NOT NULL DEFAULT '{}',
    angulos INTEGER[] NOT NULL DEFAULT '{}',
    radio BOOLEAN NOT NULL DEFAULT FALSE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- Tipos de estructura + tipologias (MURO/LOSA/VIGA/... -> MH, Fi, ES, CB...).
-- clave compuesta estructura+codigo (ej. MURO-MH). nombre = descripcion legible.
CREATE TABLE IF NOT EXISTS tipologias_catalogo (
    id BIGSERIAL PRIMARY KEY,
    estructura TEXT NOT NULL,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (estructura, codigo)
);

-- Que figuras aplican a cada tipologia (FIGURAS_POR_TIPO).
CREATE TABLE IF NOT EXISTS tipologia_figuras (
    id BIGSERIAL PRIMARY KEY,
    tipologia_id BIGINT NOT NULL REFERENCES tipologias_catalogo(id) ON DELETE CASCADE,
    figura_codigo TEXT NOT NULL REFERENCES figuras_catalogo(codigo) ON DELETE CASCADE,
    UNIQUE (tipologia_id, figura_codigo)
);

CREATE INDEX IF NOT EXISTS idx_tipologia_figuras_tip ON tipologia_figuras(tipologia_id);
