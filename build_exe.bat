@echo off
echo 正在构建BTC预测系统EXE文件...
echo.

REM 清理旧的构建文件
rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
del *.spec 2>nul

REM 构建EXE
pyinstaller --onefile ^
            --windowed ^
            --name "BTC_Predict_System" ^
            --icon "icon.ico" ^
            --add-data "config.json;." ^
            --add-data "requirements.txt;." ^
            run.py

echo.
echo 构建完成！
echo EXE文件位置: dist\BTC_Predict_System.exe
echo.
pause