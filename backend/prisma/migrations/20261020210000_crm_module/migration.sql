-- The leads module now covers the whole CRM group (opportunities and tags).
-- Renaming the catalog key keeps the existing tenant_modules overrides attached
-- to the same module row and leaves organizations without explicit
-- configuration enabled by default.
UPDATE "modules"
SET "key" = 'crm',
    "name" = 'CRM',
    "description" = 'Oportunidades, funil comercial e etiquetas.',
    "category" = 'CRM',
    "icon" = 'KanbanSquare',
    "sort_order" = 25,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'leads';
