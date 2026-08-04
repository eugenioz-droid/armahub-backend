-- Purga de LÁPIDAS VACÍAS: despieces eliminados que nunca tuvieron data (0 barras).
-- Antes, eliminar un despiece sin barras dejaba una lápida en cero en el histórico (basura).
-- Ahora eliminar un vacío lo borra físicamente; esto limpia las que ya quedaron registradas.
-- Idempotente: solo toca lotes 'eliminado' cuya lápida no preserva ninguna barra.
DELETE FROM lotes
WHERE estado = 'eliminado'
  AND COALESCE(snap_n_barras, 0) = 0
  AND (snap_barras IS NULL OR snap_barras::text IN ('', '[]', 'null'));
