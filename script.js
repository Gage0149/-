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
    expiryCheckInterval: null
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
    netPnl: document.getElementById('net-pnl')
};

let chart = null;
let candleSeries = null;

// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
    console.log('初始化应用...');
    loadFromStorage();
    initChart();
    bindEvents();
    updatePayoutDisplay();
    updateAllUI();
    
    // 首次加载数据
    await Promise.all([
        updatePrice(),
        loadChartData()
    ]);
    
    // 启动定时器
    startTimers();
    
    console.log('应用初始化完成');
});

// 启动所有定时器
function startTimers() {
    // 价格更新（500ms = 实时效果）
    AppState.priceUpdateInterval = setInterval(updatePrice, 500);
    
    // 图表数据更新（每30秒）
    AppState.chartUpdateInterval = setInterval(loadChartData, 30000);
    
    // 到期检查（每秒）
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
            
            // 更新显示
            Elements.priceValue.textContent = newPrice.toFixed(2);
            
            // 计算涨跌幅
            if (prevPrice > 0) {
                const change = ((newPrice - prevPrice) / prevPrice * 100).toFixed(2);
                Elements.priceChange.textContent = `${change >= 0 ? '+' : ''}${change}%`;
                Elements.priceChange.style.color = change >= 0 ? '#00c853' : '#ff5252';
            }
            
            // 更新持仓显示
            updatePositionsUI();
            
            // 脉冲效果
            pulseIndicator();
        }
        
        Elements.liveIndicator.textContent = '● 实时连接中';
        Elements.liveIndicator.style.color = '#00c853';
    } catch (error) {
        console.error('价格更新失败:', error);
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

    // 响应式
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

// 事件绑定
function bindEvents() {
    // 交易对切换
    Elements.symbolSelect.addEventListener('change', async (e) => {
        AppState.symbol = e.target.value;
        Elements.symbolName.textContent = formatSymbol(e.target.value);
        await Promise.all([updatePrice(), loadChartData()]);
    });

    // 时间周期切换
    document.querySelectorAll('#timeframe-tabs .tf-tab').forEach(tab => {
        tab.addEventListener('click', async (e) => {
            document.querySelectorAll('#timeframe-tabs .tf-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            AppState.timeframe = e.target.dataset.tf;
            await loadChartData();
        });
    });

    // 到期时间切换
    document.querySelectorAll('#expiry-buttons .expiry-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#expiry-buttons .expiry-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            AppState.expiry = e.target.dataset.expiry;
        });
    });

    // 金额输入
    Elements.amountInput.addEventListener('input', updatePayoutDisplay);
    
    // 金额预设
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            Elements.amountInput.value = e.target.dataset.amount;
            updatePayoutDisplay();
        });
    });

    // 下单按钮
    document.getElementById('btn-up').addEventListener('click', () => placeOrder('UP'));
    document.getElementById('btn-down').addEventListener('click', () => placeOrder('DOWN'));

    // 顶部按钮
    document.getElementById('reset-btn').addEventListener('click', resetAccount);
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importData);

    // 标签切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            renderPositions();
        });
    });
}

// 下单
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
    
    // 启动倒计时
    startCountdown(position);
    
    updateBalanceDisplay();
    saveToStorage();
    renderPositions();
    updateStats();
    
    showNotification(`✅ 下单成功！${direction === 'UP' ? '看涨' : '看跌'} ${amount} USDT`, 'success');
}

// 计算到期时间
function calculateExpiry(expiry) {
    const minutes = {
        '1m': 1, '5m': 5, '10m': 10, '30m': 30, '1h': 60, '1d': 1440
    };
    return Date.now() + (minutes[expiry] * 60000);
}

// 启动倒计时
function startCountdown(position) {
    const timer = setInterval(() => {
        const timeLeft = position.expiryTime - Date.now();
        const element = document.getElementById(`timer-${position.id}`);
        
        if (element) {
            if (timeLeft > 0) {
                element.textContent = formatTimeLeft(timeLeft);
            } else {
                element.textContent = '结算中...';
            }
        }
    }, 1000);
    
    position._timer = timer;
}

// 检查到期
function checkExpiries() {
    const now = Date.now();
    let hasChanges = false;

    for (let i = AppState.activePositions.length - 1; i >= 0; i--) {
        const pos = AppState.activePositions[i];
        if (pos.expiryTime <= now) {
            settlePosition(pos);
            AppState.activePositions.splice(i, 1);
            
            // 清除定时器
            if (pos._timer) {
                clearInterval(pos._timer);
            }
            
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

// 结算订单
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

// 渲染持仓
function renderPositions() {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    const positions = activeTab === 'open' ? AppState.activePositions : AppState.closedPositions;
    
    Elements.openCount.textContent = AppState.activePositions.length;
    Elements.closedCount.textContent = AppState.closedPositions.length;
    Elements.activeCount.textContent = `${AppState.activePositions.length}/${AppState.maxPositions}`;
    
    Elements.positionsList.innerHTML = '';
    
    if (positions.length === 0) {
        Elements.positionsList.innerHTML = `
            <div class="empty-state">
                <p>${activeTab === 'open' ? '暂无进行中的订单' : '暂无历史订单'}</p>
            </div>
        `;
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
            const profit = pos.result === 'WIN' ? 
                `+${(pos.amount * AppState.payoutRate).toFixed(2)}` : 
                `-${pos.amount.toFixed(2)}`;
            
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
                <div class="settled-time">
                    ${new Date(pos.settledAt).toLocaleString()}
                </div>
            `;
        }
        
        Elements.positionsList.appendChild(el);
    });
}

// 更新持仓UI
function updatePositionsUI() {
    AppState.activePositions.forEach(pos => {
        const priceEl = document.querySelector(`#timer-${pos.id}`)?.parentElement?.querySelector('.current-price');
        if (priceEl && pos.symbol === AppState.symbol) {
            priceEl.textContent = AppState.currentPrice.toFixed(2);
        }
    });
}

// 更新统计
function updateStats() {
    const total = AppState.closedPositions.length;
    const wins = AppState.closedPositions.filter(p => p.result === 'WIN').length;
    const losses = total - wins;
    
    const winAmount = AppState.closedPositions
        .filter(p => p.result === 'WIN')
        .reduce((sum, p) => sum + (p.amount * AppState.payoutRate), 0);
    
    const lossAmount = AppState.closedPositions
        .filter(p => p.result === 'LOSE')
        .reduce((sum, p) => sum + p.amount, 0);
    
    const netPnl = winAmount - lossAmount;
    const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;

    Elements.totalTrades.textContent = total;
    Elements.winRate.textContent = `${winRate}%`;
    Elements.netPnl.textContent = `${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT`;
    Elements.netPnl.style.color = netPnl >= 0 ? '#00c853' : '#ff5252';
    Elements.activeCount.textContent = `${AppState.activePositions.length}/${AppState.maxPositions}`;
}

// 更新余额
function updateBalanceDisplay() {
    Elements.balance.textContent = `${AppState.balance.toFixed(2)} USDT`;
}

// 更新预期收益
function updatePayoutDisplay() {
    const amount = parseFloat(Elements.amountInput.value) || 0;
    Elements.payoutValue.textContent = `${(amount * AppState.payoutRate).toFixed(2)} USDT`;
}

// 格式化时间
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

// 通知
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

// 数据持久化
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
    }
}

// 重置账户
function resetAccount() {
    if (confirm('⚠️ 确定要重置账户吗？所有数据将被清空！')) {
        // 清除所有定时器
        clearInterval(AppState.priceUpdateInterval);
        clearInterval(AppState.chartUpdateInterval);
        clearInterval(AppState.expiryCheckInterval);
        AppState.activePositions.forEach(p => p._timer && clearInterval(p._timer));
        
        localStorage.removeItem('binance_simulator_final');
        location.reload();
    }
}

// 导出数据
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
        '盈亏': pos.result === 'WIN' ? 
            `+${(pos.amount * AppState.payoutRate).toFixed(2)}` : 
            `-${pos.amount.toFixed(2)}`,
        '结算时间': new Date(pos.settledAt).toLocaleString()
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '交易记录');
    XLSX.writeFile(wb, `交易记录_${new Date().toISOString().slice(0,10)}.xlsx`);
    
    showNotification('✅ 导出成功！', 'success');
}

// 导入数据
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

// 更新所有UI
function updateAllUI() {
    updateBalanceDisplay();
    renderPositions();
    updateStats();
}
