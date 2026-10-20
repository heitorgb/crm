UPDATE "lead_stages"
SET "id" = (
  overlay(
    overlay(md5('lead-stage:' || "pipeline_id"::text || ':' || "position"::text) placing '4' from 13 for 1)
    placing '8' from 17 for 1
  )
)::uuid
WHERE "id" = md5('lead-stage:' || "pipeline_id"::text || ':' || "position"::text)::uuid;

UPDATE "lead_pipelines"
SET "id" = (
  overlay(
    overlay(md5('lead-pipeline:' || "tenant_id"::text) placing '4' from 13 for 1)
    placing '8' from 17 for 1
  )
)::uuid
WHERE "id" = md5('lead-pipeline:' || "tenant_id"::text)::uuid;
