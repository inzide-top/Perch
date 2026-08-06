-- 历史版本曾把 passed / failed 同时用作轮次状态和结果；统一为 completed + result。
UPDATE "interview_rounds"
SET
  "result" = "status",
  "status" = 'completed'
WHERE "status" IN ('passed', 'failed');

-- 上线“面试安排”前，planned 记录只由复盘入口创建。
-- 有复盘正文、摘要或结构化提取记录的历史行回填为已完成，避免被误展示为未来安排。
UPDATE "interview_rounds" AS "round"
SET
  "status" = 'completed',
  "result" = CASE WHEN "round"."result" = 'pending' THEN 'unknown' ELSE "round"."result" END
WHERE
  "round"."status" = 'planned'
  AND (
    BTRIM("round"."review_note") <> ''
    OR BTRIM("round"."note") <> ''
    OR JSONB_ARRAY_LENGTH("round"."key_takeaways") > 0
    OR EXISTS (
      SELECT 1
      FROM "review_documents" AS "document"
      WHERE "document"."interview_round_id" = "round"."id"
    )
  );

UPDATE "interview_rounds"
SET "result" = 'unknown'
WHERE "status" = 'completed' AND "result" = 'pending';

UPDATE "interview_rounds"
SET "result" = 'unknown'
WHERE "status" = 'canceled';
