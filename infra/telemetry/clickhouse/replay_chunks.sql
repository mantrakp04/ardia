CREATE OR REPLACE VIEW telemetry.replay_chunks
DEFINER = default SQL SECURITY DEFINER
AS
WITH
    if(match({day:String}, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), {day:String}, '0000-00-00') AS d,
    if(match({session:String}, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), {session:String}, '00000000-0000-0000-0000-000000000000') AS s
SELECT toUInt32(extract(_file, '^([0-9]+)')) AS seq, json
FROM url(concat('http://__OBJECTS_HOST__:8888/buckets/replays/', d, '/', s, '/{0..299}.json.gz'), 'JSONAsString', 'json String', 'gzip')
UNION ALL
SELECT toUInt32(extract(_file, '^([0-9]+)')) AS seq, json
FROM url(concat('http://__OBJECTS_HOST__:8888/buckets/replays/', d, '/', s, '/{0..299}.json'), 'JSONAsString', 'json String', 'none');
