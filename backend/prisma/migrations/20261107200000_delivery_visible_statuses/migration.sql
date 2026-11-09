ALTER TABLE "tenants"
  ADD COLUMN "delivery_visible_statuses" "StoreOrderStatus"[] NOT NULL
  DEFAULT ARRAY['PENDENTE_SEPARACAO', 'SEPARANDO', 'SEPARADO', 'EM_ROTA', 'OBSERVACAO', 'ENTREGUE']::"StoreOrderStatus"[];
