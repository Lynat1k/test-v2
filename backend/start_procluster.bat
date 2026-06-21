@echo off
set CLICKHOUSE_DSN=192.168.0.17:9000
set CLICKHOUSE_USER=default
set CLICKHOUSE_PASSWORD=
set CLICKHOUSE_DB=default
set REDIS_ADDR=192.168.0.17:6379
set REDIS_PASSWORD=
set API_PORT=8080
start /B D:\PROCLUSTER2\procluster\backend\procluster.exe > D:\PROCLUSTER2\procluster\backend\procluster_out.txt 2> D:\PROCLUSTER2\procluster\backend\procluster_err.txt
