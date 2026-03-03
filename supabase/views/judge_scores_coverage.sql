-- judge_scores_coverage
-- Tracks judge_scores coverage for every completed decision fight (and non-decision
-- fights that went past round 1, where judges may have scored partial rounds).
--
-- coverage_status:
--   'missing'  = 0 rows in judge_scores for this fight's event date (±1 day)
--   'partial'  = some rows but fewer than expected (rounds × 2 fighters × 3 judges)
--                NOTE: 'partial' is often a name-matching artefact in SQL — the frontend's
--                matchesFighter() resolves most of these via last-name / word-subset strategies
--   'complete' = row count meets or exceeds expected
--
-- Uses ±1 day date window to handle international events (Australia, Fight Island,
-- Abu Dhabi) where judge_scores.date is +1 day vs ufc_events.event_date.

CREATE OR REPLACE VIEW judge_scores_coverage AS
SELECT
    ue.event_date,
    ue.event_name,
    fmd.fight_url,
    fmd.fighter1_name,
    fmd.fighter2_name,
    fmd.method,
    fmd.round  AS rounds_fought,
    CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6 AS expected_rows,
    COUNT(js.id) AS score_rows_on_date,
    CASE
        WHEN COUNT(js.id) = 0                                                              THEN 'missing'
        WHEN COUNT(js.id) < CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6        THEN 'partial'
        ELSE 'complete'
    END AS coverage_status
FROM fight_meta_details fmd
JOIN ufc_events ue ON fmd.event_name = ue.event_name
LEFT JOIN judge_scores js
    ON js.date BETWEEN ue.event_date - INTERVAL '1 day' AND ue.event_date + INTERVAL '1 day'
WHERE (
    fmd.method ILIKE '%decision%'
    OR (
        fmd.round ~ '^[0-9]'
        AND CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) > 1
        AND fmd.method NOT ILIKE '%decision%'
    )
)
AND fmd.round ~ '^[0-9]'
AND ue.event_date <= CURRENT_DATE
GROUP BY
    ue.event_date,
    ue.event_name,
    fmd.fight_url,
    fmd.fighter1_name,
    fmd.fighter2_name,
    fmd.method,
    fmd.round
ORDER BY ue.event_date DESC;
