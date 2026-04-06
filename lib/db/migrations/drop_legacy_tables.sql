-- Drop 7 legacy prototype tables (after confirming new 19-table schema seed works)
-- Run AFTER create_new_schema.sql and a successful seed.py run
DROP TABLE IF EXISTS correction_history CASCADE;
DROP TABLE IF EXISTS passing_orders CASCADE;
DROP TABLE IF EXISTS race_entries CASCADE;
DROP TABLE IF EXISTS batch_jobs CASCADE;
DROP TABLE IF EXISTS analysis_params CASCADE;
DROP TABLE IF EXISTS venues CASCADE;
DROP TABLE IF EXISTS races CASCADE;
