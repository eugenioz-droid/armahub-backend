-- Auditorías › Deep Audit (26-nov, SPECS §16): la auditoría a fondo de una obra, guardada.
--
-- Cada corrida queda: no se pisa la anterior. Con el tiempo cuenta la historia de la obra y se
-- puede estudiar (usuario, 26-nov). La foto guarda los CC como estaban ese día (estado, kilos,
-- piso, ciclo, sector, cubicador); los hallazgos, lo que encontró cada regla y su validación.
CREATE TABLE IF NOT EXISTS deep_audit (
    id           SERIAL PRIMARY KEY,
    obra         TEXT NOT NULL,                  -- el nombre de aSa, como estaba ese día
    jobs         TEXT[] NOT NULL,                -- los jobs de aSa auditados (la obra y su «- BARRAS»)
    creado_por   TEXT NOT NULL,
    creado_el    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER NOT NULL,               -- versión de las reglas (deep_audit.VERSION_REGLAS)
    kpis         JSONB NOT NULL DEFAULT '{}',
    foto         JSONB NOT NULL DEFAULT '[]'     -- un objeto por CC
);
CREATE INDEX IF NOT EXISTS idx_deep_audit_jobs ON deep_audit USING GIN (jobs);

CREATE TABLE IF NOT EXISTS deep_audit_hallazgo (
    id           SERIAL PRIMARY KEY,
    audit_id     INTEGER NOT NULL REFERENCES deep_audit(id) ON DELETE CASCADE,
    regla        TEXT NOT NULL,                  -- N1, N2, D1, D2, E1, E2, F1, K1, R1, Q1
    gravedad     TEXT NOT NULL,                  -- 'alta' | 'media' | 'aviso'
    cc           TEXT,                           -- NULL: hallazgo de la obra entera
    titulo       TEXT NOT NULL,
    detalle      JSONB NOT NULL DEFAULT '{}',
    kg           NUMERIC(12,2),
    estado       TEXT NOT NULL DEFAULT 'pendiente',   -- 'pendiente' | 'confirmado' | 'descartado'
    revisado_por TEXT,
    revisado_el  TIMESTAMPTZ,
    nota         TEXT
);
CREATE INDEX IF NOT EXISTS idx_deep_audit_hallazgo ON deep_audit_hallazgo (audit_id, cc);
