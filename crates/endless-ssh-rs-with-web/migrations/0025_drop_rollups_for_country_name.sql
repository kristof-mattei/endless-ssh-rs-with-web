-- Rebuild the chain so every tier carries country_name and the stats panels can show names without a second naming source. 0026-0029 recreate the aggregates, 0030 the policies, 0031 the union views.
DROP VIEW connections_1day_all;

DROP VIEW connections_1h_all;

DROP MATERIALIZED VIEW connections_1day;

DROP MATERIALIZED VIEW connections_1h;

DROP MATERIALIZED VIEW connections_5min;

DROP MATERIALIZED VIEW connections_1min;
