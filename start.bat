@echo off
chcp 65001 >nul
title BTC预测系统 - 完整版
color 0A

echo ========================================
echo   BTC 10分钟预测系统 - 完整增强版
echo ========================================
echo.

REM 检查Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到Python！
    echo 请先安装Python 3.8+，下载地址：https://www.python.org/downloads/
    pause
    exit /b 1
)

REM 显示Python版本
for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYVER=%%i
echo [信息] %PYVER%
echo.

REM 检查是否在主程序目录
if not exist "main.py" (
    echo [错误] 请在包含main.py文件的目录中运行此脚本！
    echo.
    pause
    exit /b 1
)

echo [步骤1] 检查依赖库...
python -c "import requests, pandas, numpy, sklearn" 2>nul
if errorlevel 1 (
    echo [操作] 正在安装依赖库...
    pip install requests pandas numpy scikit-learn colorama --user
    echo.
)

REM 检查可选依赖
echo [步骤2] 检查可选机器学习库...
python -c "import lightgbm" 2>nul
if errorlevel 1 (
    echo [提示] LightGBM未安装，模型性能可能受限
)
python -c "import xgboost" 2>nul
if errorlevel 1 (
    echo [提示] XGBoost未安装，模型性能可能受限  
)

echo.
echo [步骤3] 启动主程序...
echo ========================================
echo.

REM 运行主程序
python main.py

echo.
echo ========================================
if errorlevel 1 (
    echo 程序异常退出，请查看上方错误信息
) else (
    echo 程序正常退出
)
echo ========================================
echo.
pause