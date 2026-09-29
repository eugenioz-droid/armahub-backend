-- 116 — ROW-LEVEL SECURITY en todas las tablas de `public` (29-sep).
--
-- POR QUÉ. Supabase avisó («Table publicly accessible», rls_disabled_in_public) y era
-- cierto: las 43 tablas estaban sin RLS y con 602 permisos concedidos a los roles `anon`
-- y `authenticated`. Esos roles son los de la API REST que Supabase publica sola; con la
-- URL del proyecto y la llave anónima —que es pública por diseño— cualquiera podía leer
-- o escribir cualquier tabla, aunque ArmaHub nunca use esa API.
--
-- QUÉ HACE. Activa RLS en cada tabla y NO crea políticas: sin políticas, `anon` y
-- `authenticated` no ven ninguna fila. ArmaHub no se entera porque entra a Postgres
-- como `postgres`, que tiene BYPASSRLS (verificado antes de escribir esto:
-- rolbypassrls = true). Es una sola regla y no una lista de tablas para que sirva
-- también para las que se creen después; además `db.py` la vuelve a aplicar al arrancar
-- sobre cualquier tabla nueva que aparezca sin RLS.
--
-- Complemento (a mano, en el panel de Supabase): Settings → API → sacar `public` de
-- «Exposed schemas». Con eso la API ni siquiera ve las tablas.

DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;
