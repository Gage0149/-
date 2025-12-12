# btc_gui_complete_fixed.py
"""
完整功能修复版 - 保留所有高级功能，修复所有错误
"""

import threading
import time
import math
import os
import sys
import pickle
import traceback
from datetime import datetime
import queue
from collections import deque

import requests
import pandas as pd
import numpy as np

# 机器学习库
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler, RobustScaler
from sklearn.model_selection import TimeSeriesSplit
from sklearn.neural_network import MLPClassifier
from sklearn.svm import SVC
from sklearn.linear_model import LogisticRegression

# 高级库
try:
    from lightgbm import LGBMClassifier
    LGB_AVAILABLE = True
except ImportError:
    LGB_AVAILABLE = False

try:
    from xgboost import XGBClassifier
    XGB_AVAILABLE = True
except ImportError:
    XGB_AVAILABLE = False

# GUI
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext, filedialog

# ===================== 配置 =====================
CONFIG = {
    'SYMBOL': 'BTCUSDT',
    'INTERVAL': '1m',
    'DATA_LIMIT': 1000,
    'LOG_CSV': 'btc_prediction_complete.csv',
    'LOG_XLSX': 'btc_prediction_complete.xlsx',
    'MODEL_DIR': 'models_complete',
    'TRAIN_WINDOW': 800,
    'RETRAIN_EVERY': 100,
    'MIN_TRAIN_SAMPLES': 300,
    'PREDICTION_HORIZON': 10,
    'INITIAL_CONF_THRESHOLD': 0.60,
    'MIN_CONF_THRESHOLD': 0.55,
    'MAX_CONF_THRESHOLD': 0.75,
    'COUNTDOWN_SECONDS': 600,
    'REFRESH_INTERVAL': 30,
    'MAX_RETRIES': 3,
    'TIMEOUT': 10,
}

# 创建目录
os.makedirs(CONFIG['MODEL_DIR'], exist_ok=True)

# ===================== 数据获取模块 =====================
class CompleteDataFetcher:
    """完整的数据获取器"""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0'
        })
        # 简单的内存缓存
        self.last_price = None
        self.last_price_time = 0
        self.last_klines = None
        self.last_klines_time = 0
    
    def get_realtime_price(self):
        """获取实时价格"""
        # 5秒内使用缓存
        if self.last_price and time.time() - self.last_price_time < 5:
            return self.last_price
        
        try:
            url = "https://api.binance.com/api/v3/ticker/price"
            response = self.session.get(url, params={"symbol": CONFIG['SYMBOL']}, timeout=5)
            data = response.json()
            price = float(data.get('price', 0))
            
            self.last_price = price
            self.last_price_time = time.time()
            return price
            
        except Exception as e:
            print(f"获取价格失败: {e}")
            # 返回缓存值或默认值
            return self.last_price if self.last_price else 50000.0
    
    def get_klines(self, limit=CONFIG['DATA_LIMIT']):
        """获取K线数据"""
        # 30秒内使用缓存
        if self.last_klines is not None and time.time() - self.last_klines_time < 30:
            return self.last_klines.copy()
        
        try:
            url = "https://api.binance.com/api/v3/klines"
            params = {
                'symbol': CONFIG['SYMBOL'],
                'interval': CONFIG['INTERVAL'],
                'limit': min(limit, 1000)
            }
            
            response = self.session.get(url, params=params, timeout=10)
            data = response.json()
            
            df = pd.DataFrame(data, columns=[
                'open_time', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_volume', 'trades', 'taker_buy_base',
                'taker_buy_quote', 'ignore'
            ])
            
            # 转换类型
            numeric_cols = ['open', 'high', 'low', 'close', 'volume']
            for col in numeric_cols:
                df[col] = pd.to_numeric(df[col], errors='coerce')
            
            df['open_time'] = pd.to_datetime(df['open_time'], unit='ms')
            df = df.sort_values('open_time')
            
            # 清理
            df = df.dropna(subset=numeric_cols)
            
            self.last_klines = df[['open_time', 'open', 'high', 'low', 'close', 'volume']].copy()
            self.last_klines_time = time.time()
            
            return self.last_klines.copy()
            
        except Exception as e:
            print(f"获取K线失败: {e}")
            # 生成模拟数据
            return self._generate_fallback_data(limit)
    
    def _generate_fallback_data(self, n=500):
        """生成备用数据"""
        dates = pd.date_range(end=datetime.now(), periods=n, freq='1min')
        
        # 生成更真实的随机价格
        prices = [50000.0]
        for _ in range(n-1):
            # 使用几何布朗运动
            drift = 0.0001
            volatility = 0.005
            change = np.exp((drift - 0.5 * volatility**2) + volatility * np.random.randn())
            prices.append(prices[-1] * change)
        
        prices = np.array(prices)
        
        # 生成OHLCV
        df = pd.DataFrame({
            'open_time': dates,
            'open': prices * (1 + np.random.uniform(-0.001, 0.001, n)),
            'high': np.maximum(
                prices * (1 + np.random.uniform(0, 0.002, n)),
                prices * (1 + np.random.uniform(0.001, 0.003, n))
            ),
            'low': np.minimum(
                prices * (1 + np.random.uniform(-0.002, 0, n)),
                prices * (1 + np.random.uniform(-0.003, -0.001, n))
            ),
            'close': prices,
            'volume': np.random.lognormal(6, 1, n)
        })
        
        # 确保数据合理性
        df['high'] = df[['open', 'close', 'high']].max(axis=1)
        df['low'] = df[['open', 'close', 'low']].min(axis=1)
        
        return df

# ===================== 特征工程模块 =====================
class CompleteFeatureEngineer:
    """完整的特征工程"""
    
    def __init__(self):
        self.feature_list = []
    
    def create_features(self, df):
        """创建完整特征集"""
        df = df.copy()
        
        # 1. 基础价格特征
        df['returns_1'] = df['close'].pct_change(1)
        df['returns_5'] = df['close'].pct_change(5)
        df['returns_10'] = df['close'].pct_change(10)
        df['returns_20'] = df['close'].pct_change(20)
        
        # 2. 移动平均
        for period in [3, 5, 8, 13, 21, 34, 55]:
            df[f'ma_{period}'] = df['close'].rolling(period).mean()
            df[f'ma_diff_{period}'] = (df['close'] - df[f'ma_{period}']) / df[f'ma_{period}']
        
        # 3. 指数移动平均
        df['ema_12'] = df['close'].ewm(span=12, adjust=False).mean()
        df['ema_26'] = df['close'].ewm(span=26, adjust=False).mean()
        df['ema_diff_12'] = (df['close'] - df['ema_12']) / df['ema_12']
        df['ema_diff_26'] = (df['close'] - df['ema_26']) / df['ema_26']
        
        # 4. MACD
        df['macd'] = df['ema_12'] - df['ema_26']
        df['macd_signal'] = df['macd'].ewm(span=9, adjust=False).mean()
        df['macd_hist'] = df['macd'] - df['macd_signal']
        
        # 5. RSI
        for period in [6, 14, 24]:
            delta = df['close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
            rs = gain / (loss + 1e-10)
            df[f'rsi_{period}'] = 100 - (100 / (1 + rs))
        
        # 6. 布林带
        for period in [20, 50]:
            sma = df['close'].rolling(period).mean()
            std = df['close'].rolling(period).std()
            df[f'bb_upper_{period}'] = sma + 2 * std
            df[f'bb_lower_{period}'] = sma - 2 * std
            df[f'bb_width_{period}'] = (df[f'bb_upper_{period}'] - df[f'bb_lower_{period}']) / sma
            df[f'bb_position_{period}'] = (df['close'] - df[f'bb_lower_{period}']) / (df[f'bb_upper_{period}'] - df[f'bb_lower_{period}'] + 1e-10)
        
        # 7. ATR
        for period in [7, 14, 21]:
            high_low = df['high'] - df['low']
            high_close = np.abs(df['high'] - df['close'].shift())
            low_close = np.abs(df['low'] - df['close'].shift())
            tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
            df[f'atr_{period}'] = tr.rolling(period).mean()
            df[f'atr_ratio_{period}'] = df[f'atr_{period}'] / df['close']
        
        # 8. 成交量特征
        for period in [5, 10, 20, 50]:
            df[f'volume_ma_{period}'] = df['volume'].rolling(period).mean()
            df[f'volume_ratio_{period}'] = df['volume'] / (df[f'volume_ma_{period}'] + 1e-10)
        
        df['volume_change'] = df['volume'].pct_change()
        
        # 9. 波动率
        for window in [5, 10, 20, 50]:
            df[f'volatility_{window}'] = df['returns_1'].rolling(window).std() * np.sqrt(365*24*60)
        
        # 10. 价格位置
        for window in [20, 50, 100]:
            df[f'high_{window}'] = df['high'].rolling(window).max()
            df[f'low_{window}'] = df['low'].rolling(window).min()
            df[f'position_{window}'] = (df['close'] - df[f'low_{window}']) / (df[f'high_{window}'] - df[f'low_{window}'] + 1e-10)
        
        # 11. K线形态
        df['body_size'] = abs(df['close'] - df['open'])
        df['total_range'] = df['high'] - df['low']
        df['body_ratio'] = df['body_size'] / (df['total_range'] + 1e-10)
        
        # 12. 动量指标
        for period in [5, 10, 20]:
            df[f'momentum_{period}'] = df['close'] - df['close'].shift(period)
            df[f'roc_{period}'] = (df['close'] / df['close'].shift(period) - 1) * 100
        
        # 13. 统计特征
        for window in [20, 50, 100]:
            df[f'mean_{window}'] = df['close'].rolling(window).mean()
            df[f'std_{window}'] = df['close'].rolling(window).std()
            df[f'skew_{window}'] = df['close'].rolling(window).skew()
            df[f'zscore_{window}'] = (df['close'] - df[f'mean_{window}']) / (df[f'std_{window}'] + 1e-10)
        
        # 清理数据
        df = df.replace([np.inf, -np.inf], np.nan)
        df = df.ffill().bfill()
        
        # 保存特征列表
        self.feature_list = [col for col in df.columns if col not in ['open_time', 'open', 'high', 'low', 'close', 'volume']]
        
        return df
    
    def create_labels(self, df, horizon=CONFIG['PREDICTION_HORIZON']):
        """创建标签"""
        df = df.copy()
        
        # 未来收益率
        future_return = df['close'].shift(-horizon) / df['close'] - 1
        
        # 自适应阈值
        volatility = df['returns_1'].rolling(20).std().shift(-horizon)
        threshold = 0.001 * (1 + volatility * 10)
        
        # 创建标签
        df['label'] = (future_return > threshold).astype(int)
        
        return df.dropna()

# ===================== 模型管理模块 =====================
class CompleteModelManager:
    """完整的模型管理器"""
    
    def __init__(self):
        self.models = {}
        self.scaler = RobustScaler()
        self.features = []
        self.performance = {}
        self.best_model = None
    
    def save_models(self):
        """保存所有模型"""
        try:
            model_data = {
                'models': self.models,
                'scaler': self.scaler,
                'features': self.features,
                'performance': self.performance,
                'best_model': self.best_model,
                'saved_at': datetime.now()
            }
            
            model_path = os.path.join(CONFIG['MODEL_DIR'], 'complete_models.pkl')
            with open(model_path, 'wb') as f:
                pickle.dump(model_data, f)
            
            print(f"模型已保存: {model_path}")
            return True
            
        except Exception as e:
            print(f"保存模型失败: {e}")
            return False
    
    def load_models(self):
        """加载模型"""
        model_path = os.path.join(CONFIG['MODEL_DIR'], 'complete_models.pkl')
        
        if not os.path.exists(model_path):
            print(f"模型文件不存在: {model_path}")
            return False
        
        try:
            with open(model_path, 'rb') as f:
                model_data = pickle.load(f)
            
            self.models = model_data.get('models', {})
            self.scaler = model_data.get('scaler', RobustScaler())
            self.features = model_data.get('features', [])
            self.performance = model_data.get('performance', {})
            self.best_model = model_data.get('best_model')
            
            print(f"模型加载成功: {len(self.models)}个子模型")
            print(f"特征数量: {len(self.features)}")
            
            return True
            
        except Exception as e:
            print(f"加载模型失败: {e}")
            return False
    
    def train_models(self, X, y, feature_names):
        """训练所有模型"""
        print(f"开始训练，数据形状: X={X.shape}, y={y.shape}")
        
        if len(X) < 100:
            print("数据不足")
            return False
        
        # 特征选择
        self.features = self._select_features(X, y, feature_names)
        feature_indices = [feature_names.index(f) for f in self.features if f in feature_names]
        X_selected = X[:, feature_indices]
        
        print(f"特征选择后: {len(self.features)}个特征")
        
        # 数据分割
        split_idx = int(len(X_selected) * 0.8)
        X_train, X_test = X_selected[:split_idx], X_selected[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]
        
        # 标准化
        self.scaler.fit(X_train)
        X_train_scaled = self.scaler.transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # 训练各个模型
        self.models = {}
        
        # 1. 随机森林
        print("训练随机森林...")
        rf_model = RandomForestClassifier(
            n_estimators=200,
            max_depth=15,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1,
            class_weight='balanced',
            oob_score=True
        )
        rf_model.fit(X_train_scaled, y_train)
        self.models['random_forest'] = rf_model
        
        # 2. 梯度提升
        print("训练梯度提升...")
        gb_model = GradientBoostingClassifier(
            n_estimators=100,
            learning_rate=0.1,
            max_depth=5,
            random_state=42
        )
        gb_model.fit(X_train_scaled, y_train)
        self.models['gradient_boosting'] = gb_model
        
        # 3. 神经网络
        print("训练神经网络...")
        nn_model = MLPClassifier(
            hidden_layer_sizes=(64, 32),
            activation='relu',
            learning_rate_init=0.001,
            max_iter=300,
            random_state=42,
            early_stopping=True
        )
        nn_model.fit(X_train_scaled, y_train)
        self.models['neural_network'] = nn_model
        
        # 4. 支持向量机
        print("训练支持向量机...")
        svm_model = SVC(
            C=1.0,
            kernel='rbf',
            probability=True,
            random_state=42
        )
        svm_model.fit(X_train_scaled, y_train)
        self.models['svm'] = svm_model
        
        # 5. 逻辑回归
        print("训练逻辑回归...")
        lr_model = LogisticRegression(
            C=1.0,
            random_state=42,
            max_iter=1000,
            class_weight='balanced'
        )
        lr_model.fit(X_train_scaled, y_train)
        self.models['logistic_regression'] = lr_model
        
        # 6. LightGBM
        if LGB_AVAILABLE:
            print("训练LightGBM...")
            lgb_model = LGBMClassifier(
                n_estimators=150,
                learning_rate=0.05,
                random_state=42,
                n_jobs=-1
            )
            lgb_model.fit(X_train_scaled, y_train)
            self.models['lightgbm'] = lgb_model
        
        # 7. XGBoost
        if XGB_AVAILABLE:
            print("训练XGBoost...")
            xgb_model = XGBClassifier(
                n_estimators=150,
                learning_rate=0.05,
                max_depth=6,
                random_state=42,
                n_jobs=-1
            )
            xgb_model.fit(X_train_scaled, y_train)
            self.models['xgboost'] = xgb_model
        
        # 评估模型
        self.performance = {}
        for name, model in self.models.items():
            try:
                if hasattr(model, 'predict_proba'):
                    y_pred_proba = model.predict_proba(X_test_scaled)[:, 1]
                    y_pred = (y_pred_proba > 0.5).astype(int)
                else:
                    y_pred = model.predict(X_test_scaled)
                    y_pred_proba = np.zeros_like(y_pred, dtype=float)
                
                accuracy = np.mean(y_pred == y_test)
                precision = np.sum((y_pred == 1) & (y_test == 1)) / (np.sum(y_pred == 1) + 1e-10)
                recall = np.sum((y_pred == 1) & (y_test == 1)) / (np.sum(y_test == 1) + 1e-10)
                f1 = 2 * precision * recall / (precision + recall + 1e-10)
                
                self.performance[name] = {
                    'accuracy': accuracy,
                    'precision': precision,
                    'recall': recall,
                    'f1': f1
                }
                
                print(f"{name}: 准确率={accuracy:.3f}, F1={f1:.3f}")
                
            except Exception as e:
                print(f"评估模型 {name} 失败: {e}")
        
        # 选择最佳模型
        if self.performance:
            self.best_model = max(self.performance.items(), key=lambda x: x[1]['f1'])[0]
            print(f"最佳模型: {self.best_model}")
        
        # 保存模型
        self.save_models()
        
        return True
    
    def _select_features(self, X, y, feature_names, n_features=50):
        """特征选择"""
        if len(feature_names) <= n_features:
            return feature_names
        
        # 使用随机森林选择特征
        rf = RandomForestClassifier(n_estimators=100, random_state=42)
        rf.fit(X, y)
        
        importances = rf.feature_importances_
        indices = np.argsort(importances)[::-1]
        
        # 选择最重要的特征
        selected_indices = indices[:min(n_features, len(feature_names))]
        selected_features = [feature_names[i] for i in selected_indices]
        
        return selected_features
    
    def predict(self, X_df):
        """进行预测"""
        if not self.models or not self.features:
            return None, 0.5
        
        try:
            # 确保特征存在
            available_features = []
            feature_values = []
            
            for feature in self.features:
                if feature in X_df.columns:
                    value = X_df[feature].iloc[0]
                    if not pd.isna(value):
                        available_features.append(feature)
                        feature_values.append(value)
            
            if len(available_features) < len(self.features) * 0.7:
                print(f"特征匹配不足: {len(available_features)}/{len(self.features)}")
                return None, 0.5
            
            # 准备数据
            X = np.array(feature_values).reshape(1, -1)
            X_scaled = self.scaler.transform(X)
            
            # 使用最佳模型或随机森林
            if self.best_model and self.best_model in self.models:
                model = self.models[self.best_model]
            else:
                model = self.models.get('random_forest')
            
            if not model:
                return None, 0.5
            
            # 预测
            if hasattr(model, 'predict_proba'):
                proba = model.predict_proba(X_scaled)[0]
                if len(proba) == 2:
                    prediction = np.argmax(proba)
                    confidence = np.max(proba)
                else:
                    print(f"概率数组异常: {proba}")
                    return None, 0.5
            else:
                prediction = model.predict(X_scaled)[0]
                confidence = 0.6
            
            # 置信度校准
            confidence = self._calibrate_confidence(confidence)
            
            return int(prediction), float(confidence)
            
        except Exception as e:
            print(f"预测失败: {e}")
            traceback.print_exc()
            return None, 0.5
    
    def _calibrate_confidence(self, confidence):
        """置信度校准"""
        if confidence < 0.5:
            return max(0.5, confidence * 1.2)
        elif confidence > 0.9:
            return min(0.95, confidence * 0.95)
        else:
            return confidence

# ===================== 自适应阈值 =====================
class CompleteAdaptiveThreshold:
    """自适应阈值"""
    
    def __init__(self):
        self.threshold = CONFIG['INITIAL_CONF_THRESHOLD']
        self.win_history = deque(maxlen=50)
        self.conf_history = deque(maxlen=50)
    
    def update(self, correct, confidence):
        """更新阈值"""
        self.win_history.append(correct)
        self.conf_history.append(confidence)
        
        if len(self.win_history) >= 20:
            win_rate = sum(self.win_history) / len(self.win_history)
            
            if win_rate > 0.6:
                self.threshold = max(CONFIG['MIN_CONF_THRESHOLD'], self.threshold - 0.02)
            elif win_rate < 0.4:
                self.threshold = min(CONFIG['MAX_CONF_THRESHOLD'], self.threshold + 0.02)
    
    def get_threshold(self):
        """获取阈值"""
        return self.threshold

# ===================== 主应用 =====================
class CompleteBTCApp:
    """完整的主应用"""
    
    def __init__(self, root):
        self.root = root
        root.title("BTC预测系统 - 完整版")
        root.geometry("1000x750")
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        
        # 初始化组件
        self.fetcher = CompleteDataFetcher()
        self.feature_engineer = CompleteFeatureEngineer()
        self.model_manager = CompleteModelManager()
        self.adaptive_threshold = CompleteAdaptiveThreshold()
        
        # 状态变量
        self.running = False
        self.training = False
        self.queue = queue.Queue()
        
        # 统计
        self.stats = {
            'total': 0,
            'correct': 0,
            'recent_20': deque(maxlen=20),
            'recent_50': deque(maxlen=50),
            'streak_wins': 0,
            'streak_losses': 0,
            'best_streak': 0,
            'worst_streak': 0
        }
        
        # 创建界面
        self.create_ui()
        
        # 加载模型
        self.load_models()
        
        # 启动队列处理
        self.root.after(100, self.process_queue)
        
        self.log("系统初始化完成", "success")
    
    def create_ui(self):
        """创建完整界面"""
        # 主框架
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        # 顶部：价格和预测
        top_frame = ttk.Frame(main_frame)
        top_frame.pack(fill='x', pady=(0, 10))
        
        # 价格
        price_frame = ttk.LabelFrame(top_frame, text="实时价格", padding=10)
        price_frame.pack(side='left', fill='y', padx=5)
        
        self.price_var = tk.StringVar(value="$ --")
        price_label = ttk.Label(price_frame, textvariable=self.price_var,
                               font=('Arial', 28, 'bold'), foreground='#3498db')
        price_label.pack()
        
        # 预测
        pred_frame = ttk.LabelFrame(top_frame, text="预测状态", padding=10)
        pred_frame.pack(side='left', fill='y', padx=20)
        
        self.pred_var = tk.StringVar(value="等待预测")
        self.pred_label = ttk.Label(pred_frame, textvariable=self.pred_var,
                                   font=('Arial', 24, 'bold'), foreground='#f39c12')
        self.pred_label.pack()
        
        self.conf_var = tk.StringVar(value="置信度: --")
        ttk.Label(pred_frame, textvariable=self.conf_var,
                 font=('Arial', 14)).pack(pady=(5, 0))
        
        # 市场状态
        market_frame = ttk.LabelFrame(top_frame, text="市场状态", padding=10)
        market_frame.pack(side='right', fill='y', padx=5)
        
        self.market_var = tk.StringVar(value="未知")
        ttk.Label(market_frame, textvariable=self.market_var,
                 font=('Arial', 16, 'bold'), foreground='#2ecc71').pack()
        
        self.volatility_var = tk.StringVar(value="波动率: --")
        ttk.Label(market_frame, textvariable=self.volatility_var).pack(pady=(5, 0))
        
        # 中间：控制面板
        mid_frame = ttk.Frame(main_frame)
        mid_frame.pack(fill='x', pady=10)
        
        # 左侧：控制按钮
        left_frame = ttk.Frame(mid_frame)
        left_frame.pack(side='left', fill='y')
        
        btn_frame = ttk.LabelFrame(left_frame, text="控制", padding=10)
        btn_frame.pack(fill='y')
        
        buttons = [
            ("▶ 开始预测", self.start, '#27ae60'),
            ("⏸ 停止", self.stop, '#e74c3c'),
            ("🚀 训练模型", self.train, '#3498db'),
            ("🔄 重载模型", self.reload, '#9b59b6'),
            ("📊 性能分析", self.analyze, '#f39c12'),
            ("💾 导出数据", self.export, '#1abc9c'),
            ("⚙️ 高级选项", self.settings, '#7f8c8d'),
        ]
        
        for text, command, color in buttons:
            btn = ttk.Button(btn_frame, text=text, command=command, width=15)
            btn.pack(pady=5)
        
        # 右侧：统计信息
        right_frame = ttk.LabelFrame(mid_frame, text="统计信息", padding=10)
        right_frame.pack(side='right', fill='both', expand=True)
        
        # 创建统计网格
        stats_grid = ttk.Frame(right_frame)
        stats_grid.pack()
        
        stats_configs = [
            ("累计胜率:", "winrate_var"),
            ("最近20次:", "recent20_var"),
            ("最近50次:", "recent50_var"),
            ("当前阈值:", "threshold_var"),
            ("连胜/连败:", "streak_var"),
            ("预测次数:", "pred_count_var"),
            ("模型状态:", "model_status_var"),
            ("最佳模型:", "best_model_var"),
        ]
        
        for i, (label, var_name) in enumerate(stats_configs):
            row = i // 2
            col = (i % 2) * 2
            
            ttk.Label(stats_grid, text=label).grid(row=row, column=col, sticky='w', padx=5, pady=2)
            var = tk.StringVar(value="--")
            setattr(self, var_name, var)
            ttk.Label(stats_grid, textvariable=var, font=('Arial', 10, 'bold'),
                     foreground='#2980b9').grid(row=row, column=col+1, sticky='w', padx=5, pady=2)
        
        # 底部：日志和详细信息
        bottom_frame = ttk.Frame(main_frame)
        bottom_frame.pack(fill='both', expand=True)
        
        # 左侧：日志
        log_frame = ttk.LabelFrame(bottom_frame, text="运行日志", padding=10)
        log_frame.pack(side='left', fill='both', expand=True, padx=(0, 10))
        
        self.log_text = scrolledtext.ScrolledText(log_frame, height=12,
                                                 state='disabled', wrap='word',
                                                 font=('Consolas', 9))
        self.log_text.pack(fill='both', expand=True)
        
        # 右侧：详细信息
        info_frame = ttk.LabelFrame(bottom_frame, text="详细信息", padding=10)
        info_frame.pack(side='right', fill='both', expand=True)
        
        # 倒计时
        countdown_frame = ttk.Frame(info_frame)
        countdown_frame.pack(fill='x', pady=(0, 10))
        
        ttk.Label(countdown_frame, text="倒计时:", font=('Arial', 12)).pack(side='left')
        self.timer_var = tk.StringVar(value="10:00")
        ttk.Label(countdown_frame, textvariable=self.timer_var,
                 font=('Arial', 24, 'bold'), foreground='#e74c3c').pack(side='left', padx=10)
        
        # 预测历史
        history_frame = ttk.LabelFrame(info_frame, text="最近预测", padding=10)
        history_frame.pack(fill='both', expand=True)
        
        self.history_text = scrolledtext.ScrolledText(history_frame, height=6,
                                                     state='disabled', wrap='word',
                                                     font=('Consolas', 9))
        self.history_text.pack(fill='both', expand=True)
        
        # 状态栏
        status_frame = ttk.Frame(self.root)
        status_frame.pack(side='bottom', fill='x', padx=10, pady=5)
        
        self.status_var = tk.StringVar(value="就绪")
        ttk.Label(status_frame, textvariable=self.status_var).pack(side='left', padx=5)
        
        # 系统信息
        self.sys_info_var = tk.StringVar(value="")
        ttk.Label(status_frame, textvariable=self.sys_info_var).pack(side='right', padx=5)
    
    def log(self, message, level="info"):
        """记录日志"""
        colors = {
            'info': 'black',
            'success': '#27ae60',
            'warning': '#f39c12',
            'error': '#e74c3c',
            'prediction': '#2980b9'
        }
        
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        
        print(log_entry)
        
        self.queue.put(('log', (log_entry, colors.get(level, 'black'))))
    
    def update_history(self, entry):
        """更新历史记录"""
        self.queue.put(('history', entry))
    
    def process_queue(self):
        """处理消息队列"""
        try:
            while not self.queue.empty():
                msg_type, data = self.queue.get_nowait()
                
                if msg_type == 'log':
                    text, color = data
                    self.log_text.config(state='normal')
                    self.log_text.insert('end', text + '\n', color)
                    self.log_text.tag_config(color, foreground=color)
                    self.log_text.see('end')
                    self.log_text.config(state='disabled')
                    
                elif msg_type == 'history':
                    self.history_text.config(state='normal')
                    self.history_text.insert('end', data + '\n')
                    self.history_text.see('end')
                    self.history_text.config(state='disabled')
                    
                elif msg_type == 'update':
                    price, prediction, confidence = data
                    self.price_var.set(f"${price:,.2f}")
                    
                    if prediction == 1:
                        self.pred_var.set("📈 看涨")
                        self.pred_label.config(foreground='#2ecc71')
                    elif prediction == 0:
                        self.pred_var.set("📉 看跌")
                        self.pred_label.config(foreground='#e74c3c')
                    else:
                        self.pred_var.set("等待预测")
                        self.pred_label.config(foreground='#f39c12')
                    
                    if confidence:
                        self.conf_var.set(f"置信度: {confidence:.1%}")
                        
                elif msg_type == 'stats':
                    stats = data
                    for key, value in stats.items():
                        if hasattr(self, f"{key}_var"):
                            getattr(self, f"{key}_var").set(value)
                            
                elif msg_type == 'status':
                    self.status_var.set(data)
                    
                elif msg_type == 'market':
                    state, volatility = data
                    self.market_var.set(state)
                    self.volatility_var.set(f"波动率: {volatility:.2%}")
                    
                elif msg_type == 'timer':
                    self.timer_var.set(data)
                    
        except Exception as e:
            print(f"队列处理错误: {e}")
        
        self.root.after(100, self.process_queue)
    
    def load_models(self):
        """加载模型"""
        self.log("正在加载模型...", "info")
        self.status_var.set("加载模型中...")
        
        if self.model_manager.load_models():
            self.model_status_var.set("已加载")
            
            if self.model_manager.best_model:
                self.best_model_var.set(self.model_manager.best_model)
                perf = self.model_manager.performance.get(self.model_manager.best_model, {})
                accuracy = perf.get('accuracy', 0)
                self.log(f"模型加载成功，最佳模型: {self.model_manager.best_model} (准确率: {accuracy:.2%})", "success")
            else:
                self.log("模型加载成功", "success")
        else:
            self.model_status_var.set("未训练")
            self.best_model_var.set("--")
            self.log("未找到训练好的模型，请先训练模型", "warning")
        
        self.status_var.set("就绪")
    
    def train(self):
        """训练模型"""
        if self.training:
            self.log("已经在训练中...", "warning")
            return
        
        def train_thread():
            self.training = True
            self.status_var.set("正在训练模型...")
            self.log("开始训练完整模型...", "info")
            
            try:
                # 获取数据
                df_raw = self.fetcher.get_klines(CONFIG['TRAIN_WINDOW'])
                
                if len(df_raw) < CONFIG['MIN_TRAIN_SAMPLES']:
                    self.log(f"数据不足 ({len(df_raw)} < {CONFIG['MIN_TRAIN_SAMPLES']})", "error")
                    return
                
                # 特征工程
                df_features = self.feature_engineer.create_features(df_raw)
                df_labeled = self.feature_engineer.create_labels(df_features)
                
                if len(df_labeled) < CONFIG['MIN_TRAIN_SAMPLES']:
                    self.log("特征处理后数据不足", "error")
                    return
                
                self.log(f"训练数据: {len(df_labeled)}行, {len(df_labeled.columns)}列", "info")
                
                # 准备数据
                features = self.feature_engineer.feature_list
                X = df_labeled[features].values
                y = df_labeled['label'].values
                
                self.log(f"训练数据形状: X={X.shape}, y={y.shape}, 特征数={len(features)}", "info")
                
                # 训练模型
                success = self.model_manager.train_models(X, y, features)
                
                if success:
                    self.model_status_var.set("已训练")
                    
                    if self.model_manager.best_model:
                        self.best_model_var.set(self.model_manager.best_model)
                        perf = self.model_manager.performance.get(self.model_manager.best_model, {})
                        accuracy = perf.get('accuracy', 0)
                        self.log(f"模型训练完成！最佳模型: {self.model_manager.best_model} (准确率: {accuracy:.2%})", "success")
                    else:
                        self.log("模型训练完成！", "success")
                    
                    # 测试预测
                    self.log("测试模型预测...", "info")
                    test_features = df_labeled.iloc[-1:][self.model_manager.features]
                    prediction, confidence = self.model_manager.predict(test_features)
                    
                    if prediction is not None:
                        self.log(f"测试预测成功！预测: {'涨' if prediction==1 else '跌'}, 置信度: {confidence:.3f}", "success")
                    else:
                        self.log("测试预测失败", "warning")
                    
                    messagebox.showinfo("训练完成", "模型训练成功！")
                else:
                    self.log("模型训练失败", "error")
                    messagebox.showerror("训练失败", "模型训练失败，请检查日志")
                    
            except Exception as e:
                self.log(f"训练过程出错: {e}", "error")
                traceback.print_exc()
                messagebox.showerror("训练错误", f"错误: {str(e)}")
                
            finally:
                self.training = False
                self.status_var.set("就绪")
        
        threading.Thread(target=train_thread, daemon=True).start()
    
    def analyze_market(self, df):
        """分析市场状态"""
        try:
            # 计算波动率
            returns = df['close'].pct_change().tail(50).dropna()
            if len(returns) < 20:
                return "未知", 0.0
            
            volatility = returns.std() * np.sqrt(365*24*60)
            
            # 计算趋势
            prices = df['close'].tail(50).values
            x = np.arange(len(prices))
            slope, _ = np.polyfit(x, prices, 1)
            trend_strength = abs(slope) / np.mean(prices)
            
            # 判断状态
            if volatility > 0.8:
                if trend_strength > 0.001:
                    return "高波动趋势", volatility
                else:
                    return "高波动震荡", volatility
            else:
                if trend_strength > 0.001:
                    if slope > 0:
                        return "上升趋势", volatility
                    else:
                        return "下降趋势", volatility
                else:
                    return "盘整", volatility
                    
        except:
            return "未知", 0.0
    
    def get_current_features(self):
        """获取当前特征"""
        try:
            # 获取数据
            df_raw = self.fetcher.get_klines(100)
            
            if len(df_raw) < 50:
                self.log("数据不足", "warning")
                return None, None
            
            # 分析市场状态
            market_state, volatility = self.analyze_market(df_raw)
            self.queue.put(('market', (market_state, volatility)))
            
            # 特征工程
            df_features = self.feature_engineer.create_features(df_raw)
            
            if len(df_features) < 1:
                self.log("特征处理失败", "warning")
                return None, None
            
            # 获取最新数据
            latest = df_features.iloc[-1:].copy()
            
            return latest, market_state
            
        except Exception as e:
            self.log(f"获取特征失败: {e}", "error")
            return None, None
    
    def make_prediction(self):
        """进行预测"""
        try:
            # 获取特征
            latest_features, market_state = self.get_current_features()
            if latest_features is None:
                return None, 0.5, None
            
            # 预测
            prediction, confidence = self.model_manager.predict(latest_features)
            
            if prediction is not None:
                pred_text = '涨' if prediction == 1 else '跌'
                self.log(f"预测: {pred_text}, 置信度: {confidence:.3f}, 市场: {market_state}", "prediction")
                return prediction, confidence, market_state
            else:
                self.log("模型预测失败", "error")
                return None, 0.5, market_state
                
        except Exception as e:
            self.log(f"预测过程异常: {e}", "error")
            traceback.print_exc()
            return None, 0.5, None
    
    def start(self):
        """开始预测"""
        if self.running:
            self.log("已经在运行中", "warning")
            return
        
        if not self.model_manager.models:
            self.log("请先训练模型", "warning")
            messagebox.showwarning("警告", "请先训练模型！")
            return
        
        self.running = True
        self.status_var.set("正在运行...")
        self.log("开始预测循环", "success")
        
        threading.Thread(target=self.prediction_loop, daemon=True).start()
    
    def prediction_loop(self):
        """预测循环"""
        prediction_count = 0
        
        while self.running:
            try:
                prediction_count += 1
                self.pred_count_var.set(str(prediction_count))
                
                # 获取当前价格
                current_price = self.fetcher.get_realtime_price()
                
                # 进行预测
                prediction, confidence, market_state = self.make_prediction()
                
                # 更新显示
                self.queue.put(('update', (current_price, prediction, confidence)))
                
                # 获取阈值
                current_threshold = self.adaptive_threshold.get_threshold()
                self.threshold_var.set(f"{current_threshold:.1%}")
                
                # 检查置信度
                if prediction is None or confidence < current_threshold:
                    self.log(f"置信度不足 ({confidence:.1%} < {current_threshold:.1%})，跳过本轮", "warning")
                    time.sleep(CONFIG['REFRESH_INTERVAL'])
                    continue
                
                # 记录预测
                pred_text = '涨' if prediction == 1 else '跌'
                timestamp = datetime.now().strftime("%H:%M")
                self.update_history(f"{timestamp} 预测{pred_text} ({confidence:.1%})")
                
                # 开始倒计时
                start_price = current_price
                start_time = time.time()
                
                while time.time() - start_time < CONFIG['COUNTDOWN_SECONDS'] and self.running:
                    # 更新倒计时
                    remaining = int(CONFIG['COUNTDOWN_SECONDS'] - (time.time() - start_time))
                    mins = remaining // 60
                    secs = remaining % 60
                    self.queue.put(('timer', f"{mins:02d}:{secs:02d}"))
                    
                    time.sleep(1)
                
                if not self.running:
                    break
                
                # 获取最终价格
                final_price = self.fetcher.get_realtime_price()
                
                # 判断结果
                actual = 1 if final_price > start_price else 0
                correct = prediction == actual
                change_pct = (final_price / start_price - 1) * 100
                
                # 记录结果
                self.record_result(start_price, final_price, prediction, actual, confidence, market_state, change_pct)
                
                # 更新自适应阈值
                self.adaptive_threshold.update(correct, confidence)
                
                # 更新统计
                self.update_stats(correct)
                
                # 显示结果
                result_text = "正确 ✓" if correct else "错误 ✗"
                result_color = "success" if correct else "error"
                
                self.log(f"结果: {result_text} | 价格: {start_price:.2f} → {final_price:.2f} ({change_pct:+.2f}%) | 市场: {market_state}", result_color)
                self.update_history(f"{timestamp} 结果: {result_text} ({change_pct:+.2f}%)")
                
                # 等待下一轮
                time.sleep(CONFIG['REFRESH_INTERVAL'])
                
            except Exception as e:
                self.log(f"预测循环错误: {e}", "error")
                traceback.print_exc()
                time.sleep(5)
        
        self.log("预测循环已停止", "info")
        self.status_var.set("已停止")
    
    def record_result(self, start_price, final_price, prediction, actual, confidence, market_state, change_pct):
        """记录结果"""
        try:
            new_row = {
                'timestamp': datetime.now(),
                'start_price': start_price,
                'final_price': final_price,
                'prediction': prediction,
                'actual': actual,
                'correct': int(prediction == actual),
                'confidence': confidence,
                'market_state': market_state,
                'change_pct': change_pct
            }
            
            # 保存到CSV
            if os.path.exists(CONFIG['LOG_CSV']):
                df = pd.read_csv(CONFIG['LOG_CSV'])
                df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
            else:
                df = pd.DataFrame([new_row])
            
            df.to_csv(CONFIG['LOG_CSV'], index=False)
            
            # 保存到Excel
            try:
                df.to_excel(CONFIG['LOG_XLSX'], index=False)
            except:
                pass
                
        except Exception as e:
            self.log(f"记录结果失败: {e}", "error")
    
    def update_stats(self, correct):
        """更新统计"""
        self.stats['total'] += 1
        self.stats['recent_20'].append(correct)
        self.stats['recent_50'].append(correct)
        
        if correct:
            self.stats['correct'] += 1
            self.stats['streak_wins'] += 1
            self.stats['streak_losses'] = 0
            self.stats['best_streak'] = max(self.stats['best_streak'], self.stats['streak_wins'])
        else:
            self.stats['streak_losses'] += 1
            self.stats['streak_wins'] = 0
            self.stats['worst_streak'] = max(self.stats['worst_streak'], self.stats['streak_losses'])
        
        # 计算胜率
        win_rate = (self.stats['correct'] / self.stats['total'] * 100) if self.stats['total'] > 0 else 0
        
        recent_20 = (sum(self.stats['recent_20']) / len(self.stats['recent_20']) * 100 
                    if self.stats['recent_20'] else 0)
        
        recent_50 = (sum(self.stats['recent_50']) / len(self.stats['recent_50']) * 100 
                    if self.stats['recent_50'] else 0)
        
        self.queue.put(('stats', {
            'winrate': f"{win_rate:.1f}%",
            'recent20': f"{recent_20:.1f}%" if recent_20 > 0 else "--",
            'recent50': f"{recent_50:.1f}%" if recent_50 > 0 else "--",
            'streak': f"{self.stats['streak_wins']}W/{self.stats['streak_losses']}L"
        }))
    
    def stop(self):
        """停止"""
        self.running = False
        self.status_var.set("已停止")
        self.queue.put(('timer', "10:00"))
        self.log("预测已停止", "info")
    
    def reload(self):
        """重载模型"""
        self.log("重新加载模型...", "info")
        self.load_models()
    
    def analyze(self):
        """分析性能"""
        def analysis_thread():
            try:
                if not os.path.exists(CONFIG['LOG_CSV']):
                    self.log("没有日志数据", "warning")
                    return
                
                df = pd.read_csv(CONFIG['LOG_CSV'])
                
                if len(df) < 10:
                    self.log("数据不足，至少需要10次预测", "warning")
                    return
                
                # 基础统计
                total = len(df)
                correct = df['correct'].sum() if 'correct' in df.columns else 0
                win_rate = correct / total if total > 0 else 0
                
                # 按市场状态分析
                market_stats = {}
                if 'market_state' in df.columns:
                    market_stats = df.groupby('market_state')['correct'].agg(['count', 'mean'])
                    market_stats['mean'] = market_stats['mean'] * 100
                
                # 按置信度分析
                conf_stats = {}
                if 'confidence' in df.columns:
                    df['conf_bin'] = pd.cut(df['confidence'], bins=[0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
                    conf_stats = df.groupby('conf_bin')['correct'].mean() * 100
                
                # 生成报告
                report = [
                    "=" * 50,
                    "性能分析报告",
                    "=" * 50,
                    f"总预测次数: {total}",
                    f"总胜率: {win_rate:.1%} ({correct}/{total})",
                    f"平均置信度: {df['confidence'].mean():.2%}" if 'confidence' in df.columns else "",
                    f"当前阈值: {self.adaptive_threshold.get_threshold():.1%}",
                    "",
                    "按市场状态:",
                ]
                
                for market, stats in market_stats.iterrows():
                    report.append(f"  {market}: {stats['mean']:.1f}% ({stats['count']}次)")
                
                report.extend([
                    "",
                    "按置信度区间:",
                ])
                
                for conf_bin, win_rate in conf_stats.items():
                    report.append(f"  {conf_bin}: {win_rate:.1f}%")
                
                report.extend([
                    "",
                    "建议:",
                    self.get_suggestions(df)
                ])
                
                for line in report:
                    self.log(line, "info")
                    
            except Exception as e:
                self.log(f"性能分析失败: {e}", "error")
        
        threading.Thread(target=analysis_thread, daemon=True).start()
    
    def get_suggestions(self, df):
        """获取建议"""
        if len(df) < 20:
            return "需要更多数据进行分析"
        
        win_rate = df['correct'].mean()
        suggestions = []
        
        if win_rate < 0.5:
            suggestions.append("1. 胜率偏低，建议重新训练模型")
            suggestions.append("2. 增加训练数据量")
            suggestions.append("3. 调整特征工程")
        
        if 'confidence' in df.columns:
            avg_conf = df['confidence'].mean()
            if avg_conf < 0.6:
                suggestions.append("4. 模型置信度偏低，需要特征优化")
            elif avg_conf > 0.8 and win_rate < 0.6:
                suggestions.append("5. 模型可能过拟合，建议增加正则化")
        
        threshold = self.adaptive_threshold.get_threshold()
        if threshold > 0.7:
            suggestions.append("6. 当前阈值较高，可能错过机会")
        elif threshold < 0.55:
            suggestions.append("7. 当前阈值较低，可能存在较多错误")
        
        if len(suggestions) == 0:
            suggestions.append("当前策略表现良好，继续保持！")
        
        return "\n".join(suggestions)
    
    def export(self):
        """导出数据"""
        try:
            if not os.path.exists(CONFIG['LOG_CSV']):
                messagebox.showwarning("导出失败", "没有找到可导出的数据")
                return
            
            filename = filedialog.asksaveasfilename(
                defaultextension=".csv",
                filetypes=[("CSV文件", "*.csv"), ("Excel文件", "*.xlsx"), ("所有文件", "*.*")]
            )
            
            if filename:
                df = pd.read_csv(CONFIG['LOG_CSV'])
                
                if filename.endswith('.xlsx'):
                    df.to_excel(filename, index=False)
                else:
                    df.to_csv(filename, index=False)
                
                self.log(f"数据已导出到: {filename}", "success")
                messagebox.showinfo("导出成功", f"数据已成功导出到:\n{filename}")
                
        except Exception as e:
            self.log(f"导出失败: {e}", "error")
            messagebox.showerror("导出错误", f"导出失败: {str(e)}")
    
    def settings(self):
        """设置"""
        settings_win = tk.Toplevel(self.root)
        settings_win.title("高级设置")
        settings_win.geometry("400x300")
        
        ttk.Label(settings_win, text="高级设置", font=('Arial', 16, 'bold')).pack(pady=10)
        
        # 这里可以添加各种设置选项
        ttk.Label(settings_win, text="设置功能开发中...").pack(pady=20)
        
        ttk.Button(settings_win, text="关闭", command=settings_win.destroy).pack(pady=10)
    
    def on_close(self):
        """关闭"""
        if messagebox.askokcancel("退出", "确定要退出程序吗？"):
            self.running = False
            self.training = False
            time.sleep(0.5)
            self.root.destroy()

# ===================== 主程序 =====================
def main():
    """主函数"""
    print("=" * 60)
    print("BTC预测系统 - 完整修复版")
    print(f"Python版本: {sys.version}")
    print(f"LightGBM可用: {LGB_AVAILABLE}")
    print(f"XGBoost可用: {XGB_AVAILABLE}")
    print("=" * 60)
    
    root = tk.Tk()
    app = CompleteBTCApp(root)
    
    # 居中显示
    root.update_idletasks()
    width = 1000
    height = 750
    x = (root.winfo_screenwidth() // 2) - (width // 2)
    y = (root.winfo_screenheight() // 2) - (height // 2)
    root.geometry(f'{width}x{height}+{x}+{y}')
    
    root.mainloop()

if __name__ == "__main__":
    main()