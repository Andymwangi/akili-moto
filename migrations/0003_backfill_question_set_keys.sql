-- Custom SQL migration file, put your code below! --
UPDATE daily_quizzes
SET question_set_key = (
  SELECT group_concat(question_id, ',')
  FROM (
    SELECT value AS question_id
    FROM json_each(daily_quizzes.question_ids)
    ORDER BY value
  )
);
