@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo 没有找到 Git。请先安装 Git for Windows，再重新运行这个脚本。
  goto :pause
)

echo 正在拉取 EchoSage 最新发布版本……
git fetch origin main
if errorlevel 1 goto :failed

git reset --hard origin/main
if errorlevel 1 goto :failed

echo.
echo 拉取完成。请回到 EchoSage 设置页，点击“我已拉取，重载扩展”。
goto :pause

:failed
echo.
echo 更新失败。请检查网络连接，或把这个窗口里的信息发给维护者。

:pause
echo.
pause
