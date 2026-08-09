@echo off

start "Frontend" cmd /k "cd /d D:\100_Active_Projects\107_Trading_Crypto\03_Workspace\sandbox && npm run dev"

start "Local Daemon" cmd /k "cd /d D:\100_Active_Projects\107_Trading_Crypto\03_Workspace\sandbox\local-daemon && node server.js"

start "Scalp Bot" cmd /k "cd /d D:\100_Active_Projects\107_Trading_Crypto\03_Workspace\sandbox\local-daemon && node scalpBot.js"