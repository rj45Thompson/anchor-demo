@echo off
rem Builds the C++ twin of core.js with MSVC: replay.exe, replay_library_math.exe and test_core.exe.
rem
rem   cpp\build.cmd [out_dir] [source_dir]      (defaults: cpp\build, and the folder this file is in)
rem
rem Run it from a Developer Command Prompt for Visual Studio 2022 or later (x64), or from anywhere if
rem Visual Studio is installed with its C++ tools: it then finds them with vswhere. The flags:
rem   /std:c++17 /permissive-   standard C++17, with MSVC's own extensions turned off
rem   /W4 /WX                   every level 4 warning, and any warning fails the build
rem   /EHs-c- /GR-              no exceptions and no RTTI (/EHsc- would leave exceptions on: it means /EHs /EHc-)
rem   /O2                       optimised
rem   /fp:precise               the default, written out because parity with core.js depends on it: no
rem                             reordering of floating point arithmetic and no fused multiply-add
rem replay_library_math.exe is replay.exe with the C runtime's sin, cos, atan2 and hypot in place of Trig's,
rem for tools/parity.js to measure why Trig exists.
setlocal
set "FLAGS=/nologo /std:c++17 /permissive- /W4 /WX /EHs-c- /GR- /O2 /fp:precise"
set "SRC=%~dp0."
if not "%~2"=="" set "SRC=%~2"
set "OUT=%~dp0build"
if not "%~1"=="" set "OUT=%~1"
for %%I in ("%SRC%") do set "SRC=%%~fI"
if not exist "%OUT%" mkdir "%OUT%"
for %%I in ("%OUT%") do set "OUT=%%~fI"

where cl >nul 2>nul
if errorlevel 1 call :find_msvc
if errorlevel 1 exit /b 1

cl 2> "%OUT%\compiler.txt" >nul
call :build replay "%SRC%\replay_main.cpp" "" || exit /b 1
call :build replay_library_math "%SRC%\replay_main.cpp" "/DSHATTERBELT_LIBRARY_MATH" || exit /b 1
call :build test_core "%SRC%\test_core.cpp" "" || exit /b 1
echo built replay.exe, replay_library_math.exe and test_core.exe in %OUT%
exit /b 0

rem %1 the program, %2 its main file, %3 extra flags. Each program gets its own folder for object files.
:build
if not exist "%OUT%\obj_%~1" mkdir "%OUT%\obj_%~1"
pushd "%OUT%\obj_%~1"
cl %FLAGS% %~3 "%~2" "%SRC%\shatterbelt_core.cpp" /Fe"%OUT%\%~1.exe"
set "RESULT=%errorlevel%"
popd
exit /b %RESULT%

:find_msvc
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto no_msvc
set "VSINSTALL="
rem the newest Visual Studio that has the C++ compiler and its vcvarsall.bat (vcvars64.bat calls it)
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -products * -sort -property installationPath`) do (
    if not defined VSINSTALL if exist "%%I\VC\Tools\MSVC\" if exist "%%I\VC\Auxiliary\Build\vcvarsall.bat" set "VSINSTALL=%%I"
)
if not defined VSINSTALL goto no_msvc
call "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat" >nul
where cl >nul 2>nul
if errorlevel 1 goto no_msvc
exit /b 0

:no_msvc
echo build.cmd: cl.exe is not on PATH and no Visual Studio with C++ tools was found. Run it from a Developer Command Prompt.
exit /b 1
