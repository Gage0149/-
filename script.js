// 全局状态
const AppState = {
    balance: 1000,
    symbol: 'BTCUSDT',
    currentPrice: 0,
    activePositions: [],
    closedPositions: [],
    timeframe: '1m',
    expiry: '1m',
    payoutRate: 0.85,
    maxPositions: 5,
    priceUpdateInterval: null,
    chartUpdateInterval: null,
    expiryCheckInterval: null,
    aiConfig: {
        provider: 'mock',
        apiKey: '',
        model: '',
        threshold: 60
    }
};

// DOM元素
const Elements = {
    balance: document.getElementById('balance-value'),
    symbolName: document.getElementById('symbol-name'),
    priceValue: document.getElementById('price-value'),
    priceChange: document.getElementById('price-change'),
    symbolSelect: document.getElementById('symbol-select'),
    amountInput: document.getElementById('amount-input'),
    payoutValue: document.getElementById('payout-value'),
    openCount: document.getElementById('open-count'),
    closedCount: document.getElementById('closed-count'),
    activeCount: document.getElementById('active-count'),
    positionsList: document.getElementById('positions-list'),
    chartContainer: document.getElementById('trading-chart'),
    liveIndicator: document.getElementById('live-indicator'),
    totalTrades: document.getElementById('total-trades'),
    winRate: document.getElementById('win-rate'),
    netPnl: document.getElementById('net-pnl'),
    aiStatus: document.getElementById('ai-status'),
    aiResult: document.getElementById('ai-result'),
    aiLoading: document.getElementById('ai-loading'),
    aiPrediction: document.getElementById('ai-prediction'),
    aiConfidence: document.getElementById('ai-confidence'),
    aiDetails: document.getElementById('ai-details')
};

let chart = null;
let candleSeries = null;

// 技术指标计算库
const TechIndicators = {
    // 简单移动平均
    SMA: (data, period) => {
        if (data.length < period) return null;
        const sum = data.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    },

    // 指数移动平均
    EMA: (data, period) => {
        if (data.length < period) return null;
        const k = 2 / (period + 1);
        let ema = data[0];
        for (let i = 1; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
        }
        return ema;
    },

    // MACD
    MACD: (data, fast = 12, slow = 26, signal = 9) => {
        if (data.length < slow) return null;
        const emaFast = TechIndicators.EMA(data, fast);
        const emaSlow = TechIndicators.EMA(data, slow);
        const macd = emaFast - emaSlow;
        const signalLine = TechIndicators.EMA(data.slice(-signal), signal);
        return { macd, signal: signalLine, hist: macd - signalLine };
    },

    // RSI
    RSI: (data, period = 14) => {
        if (data.length < period + 1) return null;
        let gains = 0, losses = 0;
        for (let i = data.length - period; i < data.length; i++) {
            const change = data[i] - data[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    },

    // 布林带
    BollingerBands: (data, period = 20, stdDev = 2) => {
        if (data.length < period) return null;
        const sma = TechIndicators.SMA(data, period);
        const variance = data.slice(-period).reduce((acc, price) => {
            return acc + Math.pow(price - sma, 2);
        }, 0) / period;
        const std = Math.sqrt(variance);
        return {
            middle: sma,
            upper: sma + std * stdDev,
            lower: sma - std * stdDev,
            percentB: (data[data.length - 1] - (sma - std * stdDev)) / (2 * std * stdDev)
        };
    },

    // KDJ
    KDJ: (high, low, close, period = 9) => {
        if (close.length < period) return null;
        const n = close.length - 1;
        const highestHigh = Math.max(...high.slice(-period));
        const lowestLow = Math.min(...low.slice(-period));
        const rsv = (close[n] - lowestLow) / (highestHigh - lowestLow) * 100;
        
        let k = 50, d = 50;
        for (let i = period; i < close.length; i++) {
            const hh = Math.max(...high.slice(i - period + 1, i + 1));
            const ll = Math.min(...low.slice(i - period + 1, i + 1));
            const r = (close[i] - ll) / (hh - ll) * 100;
            k = (2/3) * k + (1/3) * r;
            d = (2/3) * d + (1/3) * k;
        }
        const j = 3 * k - 2 * d;
        return { k, d, j };
    },

    // ATR
    ATR: (high, low, close, period = 14) => {
        if (close.length < period + 1) return null;
        const tr = [];
        for (let i = 1; i < close.length; i++) {
            const tr1 = high[i] - low[i];
            const tr2 = Math.abs(high[i] - close[i - 1]);
            const tr3 = Math.abs(low[i] - close[i - 1]);
            tr.push(Math.max(tr1, tr2, tr3));
        }
        return TechIndicators.SMA(tr, period);
    }
};

// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
    console.log('初始化应用...');
    loadFromStorage();
    loadAIConfig();
    initChart();
    bindEvents();
    updatePayoutDisplay();
    updateAllUI();
    
    await Promise.all([
        updatePrice(),
        loadChartData()
    ]);
    
    startTimers();
    console.log('应用初始化完成');
});

// 启动定时器
function startTimers() {
    AppState.priceUpdateInterval = setInterval(updatePrice, 500);
    AppState.chartUpdateInterval = setInterval(loadChartData, 30000);
    AppState.expiryCheckInterval = setInterval(checkExpiries, 1000);
}

// 获取实时价格
async function updatePrice() {
    try {
        const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${AppState.symbol}`);
        const data = await response.json();
        const newPrice = parseFloat(data.price);
        
        if (newPrice !== AppState.currentPrice) {
            const prevPrice = AppState.currentPrice;
            AppState.currentPrice = newPrice;
            Elements.priceValue.textContent = newPrice.toFixed(2);
            
            if (prevPrice > 0) {
                const change = ((newPrice - prevPrice) / prevPrice * 100).toFixed(2);
                Elements.priceChange.textContent = `${change >= 0 ? '+' : ''}${change}%`;
                Elements.priceChange.style.color = change >= 0 ? '#00c853' : '#ff5252';
            }
            
            updatePositionsUI();
            pulseIndicator();
        }
        
        Elements.liveIndicator.textContent = '● 实时连接中';
        Elements.liveIndicator.style.color = '#00c853';
    } catch (error) {
        Elements.liveIndicator.textContent = '● 连接失败';
        Elements.liveIndicator.style.color = '#ff5252';
    }
}

// 初始化图表
function initChart() {
    chart = LightweightCharts.createChart(Elements.chartContainer, {
        layout: { background: { color: '#1e1e1e' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#2b2b43' }, horzLines: { color: '#2b2b43' } },
        width: Elements.chartContainer.clientWidth,
        height: 400,
        timeScale: { timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#2b2b43' }
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#00c853', downColor: '#ff5252',
        borderUpColor: '#00c853', borderDownColor: '#ff5252',
        wickUpColor: '#00c853', wickDownColor: '#ff5252'
    });

    window.addEventListener('resize', () => {
        chart.applyOptions({ width: Elements.chartContainer.clientWidth });
    });
}

// 加载图表数据
async function loadChartData() {
    try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${AppState.symbol}&interval=${AppState.timeframe}&limit=100`);
        const data = await response.json();
        
        const candles = data.map(kline => ({
            time: kline[0] / 1000,
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4])
        }));
        
        candleSeries.setData(candles);
    } catch (error) {
        console.error('K线数据加载失败:', error);
    }
}

// 获取订单簿数据
async function getOrderBookData() {
    try {
        const response = await fetch(`https://api.binance.com/api/v3/depth?symbol=${AppState.symbol}&limit=20`);
        const data = await response.json();
        return {
            bids: data.bids.slice(0, 10).map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) })),
            asks: data.asks.slice(0, 10).map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }))
        };
    } catch (error) {
        console.error('订单簿数据获取失败:', error);
        return null;
    }
}

// 获取资金费率
async function getFundingRate() {
    try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${AppState.symbol}&limit=1`);
        const data = await response.json();
        return data[0] ? parseFloat(data[0].fundingRate) * 100 : 0;
    } catch (error) {
        console.error('资金费率获取失败:', error);
        return 0;
    }
}

// 计算所有技术指标
async function calculateAllIndicators() {
    const klines = await fetch(`https://api.binance.com/api/v3/klines?symbol=${AppState.symbol}&interval=${AppState.timeframe}&limit=100`)
        .then(r => r.json())
        .then(data => data.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        })));
    
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    
    return {
        currentPrice: AppState.currentPrice,
        ma5: TechIndicators.SMA(closes, 5),
        ma10: TechIndicators.SMA(closes, 10),
        ma20: TechIndicators.SMA(closes, 20),
        macd: TechIndicators.MACD(closes),
        boll: TechIndicators.BollingerBands(closes),
        rsi: TechIndicators.RSI(closes),
        kdj: TechIndicators.KDJ(highs, lows, closes),
        atr: TechIndicators.ATR(highs, lows, closes),
        fundingRate: await getFundingRate(),
        orderBook: await getOrderBookData(),
        recentVolume: klines.slice(-5).map(k => k.volume),
        timestamp: Date.now()
    };
}

// AI分析功能
async function performAIAnalysis() {
    const expiryTime = AppState.expiry;
    const currentPrice = AppState.currentPrice;
    
    // 显示加载状态
    Elements.aiLoading.style.display = 'block';
    Elements.aiResult.style.display = 'none';
    Elements.aiStatus.textContent = '正在收集市场数据...';
    
    try {
        // 收集所有数据
        const indicators = await calculateAllIndicators();
        
        // 构建prompt
        const prompt = buildAnalysisPrompt(indicators, expiryTime, currentPrice);
        
        // 调用AI API
        Elements.aiStatus.textContent = 'AI正在分析中...';
        const analysis = await callAIAPI(prompt);
        
        // 显示结果
        displayAIResult(analysis);
        
    } catch (error) {
        console.error('AI分析失败:', error);
        Elements.aiStatus.textContent = '分析失败，请检查API配置';
        Elements.aiLoading.style.display = 'none';
        showNotification('❌ AI分析失败', 'error');
    }
}

// 构建分析Prompt
function buildAnalysisPrompt(indicators, expiryTime, currentPrice) {
    const expiryMinutes = {
        '1m': 1, '5m': 5, '10m': 10, '30m': 30, '1h': 60, '1d': 1440
    }[expiryTime];
    
    const orderBookPressure = indicators.orderBook ? 
        `订单簿压力: 买盘总量=${indicators.orderBook.bids.reduce((s, b) => s + b.qty, 0).toFixed(2)}, 
         卖盘总量=${indicators.orderBook.asks.reduce((s, a) => s + a.qty, 0).toFixed(2)}` : '订单簿数据不可用';
    
    return `你是一位专业的加密货币分析师。请基于以下数据，预测${expiryMinutes}分钟后的价格走势。

当前价格: ${currentPrice.toFixed(2)} USDT

技术指标:
- MA5: ${indicators.ma5?.toFixed(2) || 'N/A'}, MA10: ${indicators.ma10?.toFixed(2) || 'N/A'}, MA20: ${indicators.ma20?.toFixed(2) || 'N/A'}
- MACD: DIF=${indicators.macd?.macd?.toFixed(2) || 'N/A'}, DEA=${indicators.macd?.signal?.toFixed(2) || 'N/A'}, Histogram=${indicators.macd?.hist?.toFixed(2) || 'N/A'}
- BOLL: 上轨=${indicators.boll?.upper?.toFixed(2) || 'N/A'}, 中轨=${indicators.boll?.middle?.toFixed(2) || 'N/A'}, 下轨=${indicators.boll?.lower?.toFixed(2) || 'N/A'}, %B=${(indicators.boll?.percentB * 100).toFixed(2) || 'N/A'}%
- RSI: ${indicators.rsi?.toFixed(2) || 'N/A'}
- KDJ: K=${indicators.kdj?.k?.toFixed(2) || 'N/A'}, D=${indicators.kdj?.d?.toFixed(2) || 'N/A'}, J=${indicators.kdj?.j?.toFixed(2) || 'N/A'}
- ATR: ${indicators.atr?.toFixed(2) || 'N/A'}

市场数据:
- 资金费率: ${indicators.fundingRate.toFixed(6)}%
- ${orderBookPressure}
- 最近5根K线成交量: ${indicators.recentVolume.map(v => v.toFixed(2)).join(', ')}

请提供:
1. 预测结果: 价格会上涨还是下跌
2. 可信度: 百分比(50-90%)
3. 详细分析: 综合以上指标的解释

输出格式:
预测: [上涨/下跌]
可信度: [XX]%
分析: [详细解释]`;
}

// 调用AI API
async function callAIAPI(prompt) {
    // 模拟模式
    if (AppState.aiConfig.provider === 'mock' || !AppState.aiConfig.apiKey) {
        return generateMockAnalysis();
    }
    
    const providers = {
        openai: { url: 'https://api.openai.com/v1/chat/completions', model: AppState.aiConfig.model || 'gpt-4-turbo-preview' },
        anthropic: { url: 'https://api.anthropic.com/v1/messages', model: AppState.aiConfig.model || 'claude-3-sonnet-20240229' },
        moonshot: { url: 'https://api.moonshot.cn/v1/chat/completions', model: AppState.aiConfig.model || 'moonshot-v1-8k' },
        zhipu: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: AppState.aiConfig.model || 'glm-4' }
    };
    
    const provider = providers[AppState.aiConfig.provider];
    if (!provider) throw new Error('不支持的AI提供商');
    
    const headers = {
        'Authorization': `Bearer ${AppState.aiConfig.apiKey}`,
        'Content-Type': 'application/json'
    };
    
    // 特殊处理Anthropic
    if (AppState.aiConfig.provider === 'anthropic') {
        headers['x-api-key'] = AppState.aiConfig.apiKey;
        delete headers['Authorization'];
    }
    
    const body = AppState.aiConfig.provider === 'anthropic' ? {
        model: provider.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
    } : {
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1024
    };
    
    const response = await fetch(provider.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    
    if (!response.ok) {
        throw new Error(`API调用失败: ${response.status}`);
    }
    
    const data = await response.json();
    const content = AppState.aiConfig.provider === 'anthropic' ? 
        data.content[0].text : data.choices[0].message.content;
    
    return parseAIResponse(content);
}

// 解析AI响应
function parseAIResponse(content) {
    const lines = content.split('\n').filter(line => line.trim());
    const result = { direction: '下跌', confidence: 50, details: '' };
    
    for (const line of lines) {
        if (line.includes('预测:') || line.includes('预测结果:')) {
            result.direction = line.includes('上涨') ? '上涨' : '下跌';
        } else if (line.includes('可信度:') || line.includes('置信度:')) {
            const match = line.match(/(\d+)/);
            if (match) result.confidence = parseInt(match[1]);
        } else if (line.includes('分析:') || line.includes('详细分析:')) {
            result.details = line.replace('分析:', '').replace('详细分析:', '').trim() || content;
        }
    }
    
    if (!result.details) result.details = content;
    
    return result;
}

// 模拟AI分析（演示用）
function generateMockAnalysis() {
    const random = Math.random();
    const direction = random > 0.5 ? '上涨' : '下跌';
    const confidence = 50 + Math.floor(Math.random() * 40);
    
    // 基于当前价格生成合理的技术分析
    const currentPrice = AppState.currentPrice;
    const targetPrice = direction === '上涨' ? 
        (currentPrice * 1.002).toFixed(2) : 
        (currentPrice * 0.998).toFixed(2);
    
    const expiryMinutes = {
        '1m': 1, '5m': 5, '10m': 10, '30m': 30, '1h': 60, '1d': 1440
    }[AppState.expiry];
    
    return {
        direction,
        confidence,
        details: `基于模拟分析，${expiryMinutes}分钟后价格预计${direction}至${targetPrice}。当前价格${currentPrice.toFixed(2)}，技术指标显示${direction}趋势。`
    };
}

// 显示AI分析结果
function displayAIResult(analysis) {
    Elements.aiLoading.style.display = 'none';
    Elements.aiResult.style.display = 'block';
    
    const expiryMinutes = {
        '1m': 1, '5m': 5, '10m': 10, '30m': 30, '1h': 60, '1d': 1440
    }[AppState.expiry];
    
    const targetPrice = analysis.direction === '上涨' ? 
        (AppState.currentPrice * 1.002).toFixed(2) : 
        (AppState.currentPrice * 0.998).toFixed(2);
    
    Elements.aiPrediction.innerHTML = `
        <span class="prediction-icon">${analysis.direction === '上涨' ? '📈' : '📉'}</span>
        <span>${expiryMinutes}分钟后价格将${analysis.direction === '上涨' ? '高于' : '低于'} ${targetPrice}</span>
    `;
    Elements.aiPrediction.className = `ai-prediction ${analysis.direction === '上涨' ? 'up' : 'down'}`;
    
    Elements.aiConfidence.innerHTML = `
        <span>可信度: </span>
        <span class="confidence-bar">
            <span class="confidence-fill" style="width: ${analysis.confidence}%"></span>
        </span>
        <span class="confidence-text">${analysis.confidence}%</span>
    `;
    
    Elements.aiDetails.innerHTML = `
        <h4>详细分析:</h4>
        <p>${analysis.details}</p>
        <div class="ai-disclaimer">
            ⚠️ 本分析由AI生成，仅供参考，不构成投资建议。加密货币市场波动剧烈，请谨慎决策。
        </div>
    `;
    
    Elements.aiStatus.textContent = '分析完成';
    
    // 如果可信度超过阈值，显示提示
    if (analysis.confidence >= AppState.aiConfig.threshold) {
        showNotification(`🤖 AI预测: ${analysis.direction} (可信度: ${analysis.confidence}%)`, 'success');
    }
}

// 事件绑定
function bindEvents() {
    // AI配置弹窗
    const aiConfigBtn = document.getElementById('ai-config-btn');
    const aiConfigModal = document.getElementById('ai-config-modal');
    const modalClose = document.getElementById('modal-close');
    const saveAIConfig = document.getElementById('save-ai-config');
    
    aiConfigBtn.addEventListener('click', () => {
        aiConfigModal.style.display = 'flex';
        loadAIConfigForm();
    });
    
    modalClose.addEventListener('click', () => {
        aiConfigModal.style.display = 'none';
    });
    
    saveAIConfig.addEventListener('click', saveAIConfigSettings);
    
    // AI分析按钮
    document.getElementById('btn-analyze').addEventListener('click', performAIAnalysis);
    
    // 交易相关事件
    Elements.symbolSelect.addEventListener('change', async (e) => {
        AppState.symbol = e.target.value;
        Elements.symbolName.textContent = formatSymbol(e.target.value);
        await Promise.all([updatePrice(), loadChartData()]);
    });

    document.querySelectorAll('#timeframe-tabs .tf-tab').forEach(tab => {
        tab.addEventListener('click', async (e) => {
            document.querySelectorAll('#timeframe-tabs .tf-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            AppState.timeframe = e.target.dataset.tf;
            await loadChartData();
        });
    });

    document.querySelectorAll('#expiry-buttons .expiry-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#expiry-buttons .expiry-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            AppState.expiry = e.target.dataset.expiry;
        });
    });

    Elements.amountInput.addEventListener('input', updatePayoutDisplay);
    
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            Elements.amountInput.value = e.target.dataset.amount;
            updatePayoutDisplay();
        });
    });

    document.getElementById('btn-up').addEventListener('click', () => placeOrder('UP'));
    document.getElementById('btn-down').addEventListener('click', () => placeOrder('DOWN'));

    document.getElementById('reset-btn').addEventListener('click', resetAccount);
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importData);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            renderPositions();
        });
    });
}

// AI配置相关函数
function loadAIConfig() {
    const saved = localStorage.getItem('ai_config');
    if (saved) {
        AppState.aiConfig = JSON.parse(saved);
    }
}

function loadAIConfigForm() {
    const config = AppState.aiConfig;
    document.getElementById('ai-provider').value = config.provider;
    document.getElementById('api-key').value = config.apiKey || '';
    document.getElementById('model-name').value = config.model || '';
    document.getElementById('confidence-threshold').value = config.threshold;
}

function saveAIConfigSettings() {
    AppState.aiConfig = {
        provider: document.getElementById('ai-provider').value,
        apiKey: document.getElementById('api-key').value,
        model: document.getElementById('model-name').value,
        threshold: parseInt(document.getElementById('confidence-threshold').value)
    };
    
    localStorage.setItem('ai_config', JSON.stringify(AppState.aiConfig));
    document.getElementById('ai-config-modal').style.display = 'none';
    showNotification('✅ AI配置已保存', 'success');
}

// 下单、持仓管理、数据持久化等函数（与之前相同，省略重复代码）...
// [保持之前的placeOrder, calculateExpiry, startCountdown, checkExpiries, settlePosition, renderPositions等函数不变]

// 为节省空间，以下是关键函数的简化版本
function placeOrder(direction) {
    if (AppState.activePositions.length >= AppState.maxPositions) {
        showNotification(`❌ 最多只能持有${AppState.maxPositions}个订单`, 'error');
        return;
    }
    const amount = parseFloat(Elements.amountInput.value);
    if (isNaN(amount) || amount < 5) {
        showNotification('⚠️ 最小下单金额为 5 USDT', 'warning');
        return;
    }
    if (amount > AppState.balance) {
        showNotification('⚠️ 余额不足！', 'warning');
        return;
    }
    if (AppState.currentPrice === 0) {
        showNotification('⚠️ 价格加载中，请稍候', 'warning');
        return;
    }
    AppState.balance -= amount;
    const position = {
        id: Date.now().toString(),
        symbol: AppState.symbol,
        direction: direction,
        amount: amount,
        entryPrice: AppState.currentPrice,
        expiryTime: calculateExpiry(AppState.expiry),
        status: 'OPEN',
        createdAt: Date.now()
    };
    AppState.activePositions.push(position);
    startCountdown(position);
    updateBalanceDisplay();
    saveToStorage();
    renderPositions();
    updateStats();
    showNotification(`✅ 下单成功！${direction === 'UP' ? '看涨' : '看跌'} ${amount} USDT`, 'success');
}

function calculateExpiry(expiry) {
    const minutes = { '1m': 1, '5m': 5, '10m': 10, '30m': 30, '1h': 60, '1d': 1440 };
    return Date.now() + (minutes[expiry] * 60000);
}

function startCountdown(position) {
    const timer = setInterval(() => {
        const timeLeft = position.expiryTime - Date.now();
        const element = document.getElementById(`timer-${position.id}`);
        if (element) {
            element.textContent = formatTimeLeft(timeLeft);
        }
    }, 1000);
    position._timer = timer;
}

function checkExpiries() {
    const now = Date.now();
    let hasChanges = false;
    for (let i = AppState.activePositions.length - 1; i >= 0; i--) {
        const pos = AppState.activePositions[i];
        if (pos.expiryTime <= now) {
            settlePosition(pos);
            AppState.activePositions.splice(i, 1);
            if (pos._timer) clearInterval(pos._timer);
            hasChanges = true;
        }
    }
    if (hasChanges) {
        updateBalanceDisplay();
        saveToStorage();
        renderPositions();
        updateStats();
    }
}

function settlePosition(position) {
    const currentPrice = AppState.currentPrice;
    let result = 'LOSE';
    if (position.direction === 'UP' && currentPrice > position.entryPrice) {
        result = 'WIN';
    } else if (position.direction === 'DOWN' && currentPrice < position.entryPrice) {
        result = 'WIN';
    }
    if (result === 'WIN') {
        AppState.balance += position.amount * (1 + AppState.payoutRate);
    }
    position.status = 'CLOSED';
    position.result = result;
    position.closePrice = currentPrice;
    position.settledAt = Date.now();
    AppState.closedPositions.unshift(position);
}

function renderPositions() {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    const positions = activeTab === 'open' ? AppState.activePositions : AppState.closedPositions;
    Elements.openCount.textContent = AppState.activePositions.length;
    Elements.closedCount.textContent = AppState.closedPositions.length;
    Elements.activeCount.textContent = `${AppState.activePositions.length}/${AppState.maxPositions}`;
    Elements.positionsList.innerHTML = '';
    if (positions.length === 0) {
        Elements.positionsList.innerHTML = `<div class="empty-state"><p>${activeTab === 'open' ? '暂无进行中的订单' : '暂无历史订单'}</p></div>`;
        return;
    }
    positions.forEach(pos => {
        const el = document.createElement('div');
        el.className = `position-card ${pos.status.toLowerCase()} ${pos.result?.toLowerCase() || ''}`;
        if (activeTab === 'open') {
            const timeLeft = Math.max(0, pos.expiryTime - Date.now());
            const progress = Math.max(0, (timeLeft / (pos.expiryTime - pos.createdAt)) * 100);
            el.innerHTML = `
                <div class="position-header">
                    <span class="symbol">${pos.symbol}</span>
                    <span class="direction ${pos.direction}">${pos.direction === 'UP' ? '📈 看涨' : '📉 看跌'}</span>
                </div>
                <div class="position-details">
                    <div>入场价: <strong>${pos.entryPrice.toFixed(2)}</strong></div>
                    <div>当前价: <strong class="current-price">${AppState.currentPrice.toFixed(2)}</strong></div>
                </div>
                <div class="position-amount">
                    投入: <strong>${pos.amount} USDT</strong>
                </div>
                <div class="position-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <span class="time-left" id="timer-${pos.id}">${formatTimeLeft(timeLeft)}</span>
                </div>
            `;
        } else {
            const profit = pos.result === 'WIN' ? `+${(pos.amount * AppState.payoutRate).toFixed(2)}` : `-${pos.amount.toFixed(2)}`;
            el.innerHTML = `
                <div class="position-header">
                    <span class="symbol">${pos.symbol}</span>
                    <span class="result ${pos.result}">${pos.result}</span>
                </div>
                <div class="position-details">
                    <div>入场: ${pos.entryPrice.toFixed(2)}</div>
                    <div>结算: ${pos.closePrice.toFixed(2)}</div>
                </div>
                <div class="position-amount">
                    盈亏: <strong class="${pos.result === 'WIN' ? 'profit' : 'loss'}">${profit} USDT</strong>
                </div>
                <div class="settled-time">${new Date(pos.settledAt).toLocaleString()}</div>
            `;
        }
        Elements.positionsList.appendChild(el);
    });
}

function updatePositionsUI() {
    AppState.activePositions.forEach(pos => {
        const priceEl = document.querySelector(`#timer-${pos.id}`)?.parentElement?.querySelector('.current-price');
        if (priceEl && pos.symbol === AppState.symbol) {
            priceEl.textContent = AppState.currentPrice.toFixed(2);
        }
    });
}

function updateStats() {
    const total = AppState.closedPositions.length;
    const wins = AppState.closedPositions.filter(p => p.result === 'WIN').length;
    const losses = total - wins;
    const winAmount = AppState.closedPositions.filter(p => p.result === 'WIN').reduce((sum, p) => sum + (p.amount * AppState.payoutRate), 0);
    const lossAmount = AppState.closedPositions.filter(p => p.result === 'LOSE').reduce((sum, p) => sum + p.amount, 0);
    const netPnl = winAmount - lossAmount;
    const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;
    Elements.totalTrades.textContent = total;
    Elements.winRate.textContent = `${winRate}%`;
    Elements.netPnl.textContent = `${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT`;
    Elements.netPnl.style.color = netPnl >= 0 ? '#00c853' : '#ff5252';
    Elements.activeCount.textContent = `${AppState.activePositions.length}/${AppState.maxPositions}`;
}

function updateBalanceDisplay() {
    Elements.balance.textContent = `${AppState.balance.toFixed(2)} USDT`;
}

function updatePayoutDisplay() {
    const amount = parseFloat(Elements.amountInput.value) || 0;
    Elements.payoutValue.textContent = `${(amount * AppState.payoutRate).toFixed(2)} USDT`;
}

function formatTimeLeft(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
}

function formatSymbol(symbol) {
    return symbol.replace('USDT', '/USDT');
}

function pulseIndicator() {
    Elements.liveIndicator.style.opacity = '0.3';
    setTimeout(() => Elements.liveIndicator.style.opacity = '1', 200);
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function saveToStorage() {
    const data = {
        balance: AppState.balance,
        activePositions: AppState.activePositions.map(p => {
            const { _timer, ...rest } = p;
            return rest;
        }),
        closedPositions: AppState.closedPositions
    };
    localStorage.setItem('binance_simulator_final', JSON.stringify(data));
}

function loadFromStorage() {
    const saved = localStorage.getItem('binance_simulator_final');
    if (saved) {
        const data = JSON.parse(saved);
        AppState.balance = data.balance || 1000;
        AppState.activePositions = data.activePositions || [];
        AppState.closedPositions = data.closedPositions || [];
        AppState.activePositions.forEach(pos => {
            if (pos.expiryTime > Date.now()) {
                startCountdown(pos);
            }
        });
    }
}

function resetAccount() {
    if (confirm('⚠️ 确定要重置账户吗？所有数据将被清空！')) {
        clearInterval(AppState.priceUpdateInterval);
        clearInterval(AppState.chartUpdateInterval);
        clearInterval(AppState.expiryCheckInterval);
        AppState.activePositions.forEach(p => p._timer && clearInterval(p._timer));
        localStorage.removeItem('binance_simulator_final');
        location.reload();
    }
}

function exportData() {
    if (AppState.closedPositions.length === 0) {
        showNotification('暂无数据可导出', 'warning');
        return;
    }
    const exportData = AppState.closedPositions.map(pos => ({
        'ID': pos.id,
        '交易对': pos.symbol,
        '方向': pos.direction,
        '金额': pos.amount,
        '入场价': pos.entryPrice.toFixed(2),
        '结算价': pos.closePrice.toFixed(2),
        '结果': pos.result,
        '盈亏': pos.result === 'WIN' ? `+${(pos.amount * AppState.payoutRate).toFixed(2)}` : `-${pos.amount.toFixed(2)}`,
        '结算时间': new Date(pos.settledAt).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '交易记录');
    XLSX.writeFile(wb, `交易记录_${new Date().toISOString().slice(0,10)}.xlsx`);
    showNotification('✅ 导出成功！', 'success');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            const imported = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row[0] && (row[7] === 'WIN' || row[7] === 'LOSE')) {
                    imported.push({
                        id: row[0].toString(),
                        symbol: row[1],
                        direction: row[2],
                        amount: parseFloat(row[3]),
                        entryPrice: parseFloat(row[4]),
                        closePrice: parseFloat(row[5]),
                        result: row[7],
                        status: 'CLOSED',
                        createdAt: new Date().toISOString(),
                        settledAt: new Date(row[8]).getTime() || Date.now()
                    });
                }
            }
            const existingIds = new Set(AppState.closedPositions.map(p => p.id));
            let added = 0;
            imported.forEach(pos => {
                if (!existingIds.has(pos.id)) {
                    AppState.closedPositions.push(pos);
                    added++;
                }
            });
            saveToStorage();
            updateAllUI();
            showNotification(`✅ 成功导入 ${added} 条记录！`, 'success');
        } catch (error) {
            console.error('导入失败:', error);
            showNotification('❌ 导入失败，请检查文件格式', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function updateAllUI() {
    updateBalanceDisplay();
    renderPositions();
    updateStats();
}
