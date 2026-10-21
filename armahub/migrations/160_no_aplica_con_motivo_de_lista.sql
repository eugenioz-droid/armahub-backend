-- «NO APLICA» CON MOTIVO DE LISTA TAMBIÉN EN LA AUDITORÍA (21-oct).
--
-- La revisión de barras ya lo tenía: una lista de motivos más la explicación, para poder
-- leer después lo que el texto libre esconde (si muchos marcan «criterio acordado con el
-- auditor», el problema está en el criterio, no en las barras). La auditoría sólo tenía
-- el texto. El usuario pidió armonizar los dos flujos; esto es la columna que faltaba.
-- Los motivos son de ESTE módulo (`MOTIVOS_NO_APLICA_AUD`): acá lo marcó una persona
-- mirando la barra, no una regla, y las razones son otras.
ALTER TABLE auditoria_items ADD COLUMN IF NOT EXISTS desestimado_tipo TEXT;
