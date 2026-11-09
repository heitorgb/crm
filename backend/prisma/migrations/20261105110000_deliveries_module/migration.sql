INSERT INTO "modules" ("id", "key", "name", "description", "category", "icon", "sort_order", "controllable", "created_at", "updated_at")
VALUES ('a0000000-0000-4000-8000-000000000007', 'deliveries', 'Entregas', 'Acompanhamento de pedidos aprovados e gestão de lojas.', 'Operação', 'PackageCheck', 35, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
