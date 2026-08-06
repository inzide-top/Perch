-- 旧版“面试复盘”表单把正文写入 note；新版明确区分安排备注与复盘原文。
-- 与机会终止记录绑定的 note 是终止原因，必须保留，不能迁入复盘。
UPDATE "interview_rounds" AS "round"
SET
  "review_note" = "round"."note",
  "note" = ''
WHERE
  "round"."status" = 'completed'
  AND BTRIM("round"."review_note") = ''
  AND BTRIM("round"."note") <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "opportunity_terminations" AS "termination"
    WHERE "termination"."related_interview_round_id" = "round"."id"
  );
