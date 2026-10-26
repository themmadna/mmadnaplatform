-- judge_scores_coverage
-- Tracks judge_scores coverage per completed decision fight (plus 'Overturned' results —
-- decisions later changed to NC, which mmadecisions still lists). Other stoppages are
-- excluded: mmadecisions only publishes scorecards for decisions.
--
-- Per-fight matching (rewritten 2026-10-26). The old version counted EVERY judge_scores
-- row on the event date (±1 day), so any fight on a card with ≥1 scorecard read
-- 'complete' — Yan vs Dvalishvili 3 showed complete with 0 rows of its own.
--
-- A judge_scores bout (bout + date) belongs to the fight when, within ±1 day:
--   (a) either fighter's normalised name matches a fighter on that bout — a fighter is
--       unique within an event, so one exact match identifies the bout; or
--   (b) the bout string contains both fighters' last names (distinct last names only —
--       'Santos vs Santos' would otherwise match any Santos on the card).
-- All rows of a matched bout are counted, so a name variant on one fighter doesn't
-- halve the count. Normalisation = lower + strip non-alphanumerics except spaces
-- (normName(), minus accent folding — unaccent is not installed).
--
-- coverage_status:
--   'missing'  = no matching scorecard rows
--   'partial'  = fewer than expected (rounds × 2 fighters × 3 judges) — usually
--                mmadecisions genuinely has only 1–2 judges' cards
--   'complete' = exactly expected
--   'excess'   = more than expected — duplicate scorecards stored under two bout
--                names (see matched_bouts > 1)
--
-- score_rows_on_date keeps its old name for compatibility; it now counts only this
-- fight's rows.

CREATE OR REPLACE VIEW judge_scores_coverage AS
WITH fights_in_scope AS (
    SELECT
        ue.event_date,
        ue.event_name,
        fmd.fight_url,
        fmd.fighter1_name,
        fmd.fighter2_name,
        fmd.method,
        fmd.round,
        CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6 AS expected_rows,
        lower(regexp_replace(fmd.fighter1_name, '[^a-zA-Z0-9 ]', '', 'g')) AS n1,
        lower(regexp_replace(fmd.fighter2_name, '[^a-zA-Z0-9 ]', '', 'g')) AS n2
    FROM fight_meta_details fmd
    JOIN ufc_events ue ON fmd.event_name = ue.event_name
    WHERE fmd.round ~ '^[0-9]'
      AND ue.event_date <= CURRENT_DATE
      AND (fmd.method ILIKE '%decision%' OR fmd.method ILIKE 'overturned%')
),
fights_named AS (
    SELECT f.*,
        (regexp_split_to_array(f.n1, ' '))[array_length(regexp_split_to_array(f.n1, ' '), 1)] AS l1,
        (regexp_split_to_array(f.n2, ' '))[array_length(regexp_split_to_array(f.n2, ' '), 1)] AS l2
    FROM fights_in_scope f
),
score_bouts AS (
    SELECT
        js.bout,
        js.date,
        COUNT(*) AS row_count,
        array_agg(DISTINCT lower(regexp_replace(js.fighter, '[^a-zA-Z0-9 ]', '', 'g'))) AS fighter_names,
        ' ' || lower(regexp_replace(js.bout, '[^a-zA-Z0-9 ]', '', 'g')) || ' ' AS bout_norm
    FROM judge_scores js
    GROUP BY js.bout, js.date
)
SELECT
    f.event_date,
    f.event_name,
    f.fight_url,
    f.fighter1_name,
    f.fighter2_name,
    f.method,
    f.round AS rounds_fought,
    f.expected_rows,
    CAST(COALESCE(SUM(sb.row_count), 0) AS BIGINT) AS score_rows_on_date,
    CASE
        WHEN COALESCE(SUM(sb.row_count), 0) = 0               THEN 'missing'
        WHEN SUM(sb.row_count) < f.expected_rows               THEN 'partial'
        WHEN SUM(sb.row_count) = f.expected_rows               THEN 'complete'
        ELSE 'excess'
    END AS coverage_status,
    COUNT(sb.bout) AS matched_bouts
FROM fights_named f
LEFT JOIN score_bouts sb
    ON sb.date BETWEEN f.event_date - 1 AND f.event_date + 1
   AND (
        f.n1 = ANY (sb.fighter_names)
        OR f.n2 = ANY (sb.fighter_names)
        OR (f.l1 <> f.l2
            AND sb.bout_norm LIKE '% ' || f.l1 || ' %'
            AND sb.bout_norm LIKE '% ' || f.l2 || ' %')
   )
GROUP BY
    f.event_date,
    f.event_name,
    f.fight_url,
    f.fighter1_name,
    f.fighter2_name,
    f.method,
    f.round,
    f.expected_rows
ORDER BY f.event_date DESC;
