@echo off
setlocal enabledelayedexpansion

if "%BASE%"=="" set "BASE=https://fantasyaverageweb.onrender.com"

echo == warming container (Render free tier cold-starts after 15m idle) ==
call :time_req "%BASE%/api/matchups/upcoming-dates" ping1
echo   ping: !ping1!
call :time_req "%BASE%/api/matchups/upcoming-dates" ping2
echo   ping: !ping2!
echo.

echo == live slate (default 'Upcoming (live)') ==
call :time_req "%BASE%/api/matchups/today" call1
echo   call 1 (cold compute if cache expired): !call1!
call :time_req "%BASE%/api/matchups/today" call2
echo   call 2 (warm, 5-min slate cache hit)  : !call2!
echo.

echo == each upcoming date (first hit = cold compute for that slate) ==
set "DATES_RAW="
for /f "delims=" %%D in ('powershell -NoProfile -Command "($r = (Invoke-RestMethod '%BASE%/api/matchups/upcoming-dates')); if ($r) { $r -join ',' }"') do set "DATES_RAW=%%D"

if "x%DATES_RAW%"=="x" (
    echo   no upcoming game dates - offseason
) else (
    for %%A in (%DATES_RAW:,= %) do (
        set "d=%%A"
        set "ymd=!d:-=!"
        call :time_req "%BASE%/api/matchups/today?date=!ymd!" cold
        call :time_req "%BASE%/api/matchups/today?date=!ymd!" warm
        echo   !d!  cold: !cold!   warm: !warm!
    )
)

echo.
echo Tip: the cold number is what the depth-chart fetch will add to; the warm
echo number should stay ~unchanged (served from the 5-min slate cache).
goto :eof

:time_req
set "url=%~1"
for /f "delims=" %%R in ('curl -sS -o NUL -w "%%{time_total}s (HTTP %%{http_code})" --max-time 120 "%url%"') do set "%~2=%%R"
goto :eof
