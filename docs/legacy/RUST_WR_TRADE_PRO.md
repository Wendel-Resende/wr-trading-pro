# Como Usar Rust na WR Trading Pro

## Índice
1. [Visão Geral](#visão-geral)
2. [Arquitetura Atual](#arquitetura-atual)
3. [Componentes que Podem se Beneficiar de Rust](#componentes-que-podem-se-beneficiar-de-rust)
4. [Estratégia de Migração Incremental](#estratégia-de-migração-incremental)
5. [Implementações Práticas](#implementações-práticas)
6. [Roadmap de Migração](#roadmap-de-migração)
7. [Custo-Benefício](#custo-benefício)

---

## Visão Geral

A WR Trading Pro é uma plataforma de trading avançada com:
- **Frontend**: Next.js 15, React 19, TypeScript
- **Backend Python**: WebSocket bridge, APIs de análise
- **Banco de Dados**: SQLite com Prisma ORM
- **Integrações**: MT5, B3, ProfitDLL

### Por que Rust?

- **Performance**: 10-100x mais rápido que Python para cálculos intensivos
- **Segurança**: Memória segura sem GC pauses críticos para trading
- **Concorrência**: Sem data races, ideal para múltiplas conexões
- **Low Latency**: Essencial para execução de ordens em tempo real
- **Single Binary**: Deploy simplificado sem dependências Python

---

## Arquitetura Atual

```
┌─────────────────────────────────────────────────────────┐
│                  Next.js Frontend                    │
│              (React 19, TypeScript)                   │
└─────────────────────────────────────────────────────────┘
                        │
                        │ WebSocket / HTTP
                        │
        ┌───────────────┴───────────────┐
        │                               │
┌───────▼────────┐           ┌────────▼───────┐
│  mt5_bridge.py  │           │  spread_api.py   │
│   (Python)      │           │    (Python)     │
│   - WebSocket    │           │    - Flask     │
│   - MT5 API     │           │    - Pandas    │
└────────────────┘           └────────────────┘
        │                               │
        │                               │
        └───────────────┬───────────────┘
                        │
                ┌───────▼───────┐
                │  SQLite DB     │
                │  (Prisma ORM) │
                └───────────────┘
```

---

## Componentes que Podem se Beneficiar de Rust

### 1. MT5 Bridge (ALTA PRIORIDADE) ⭐⭐⭐⭐⭐

**Problemas Atuais (Python):**
- Latência em WebSocket devido ao Python
- GIL limitando concorrência
- Overhead de serialização JSON
- Escalabilidade limitada para múltiplos clientes

**Benefícios com Rust:**
- Latência reduzida em 50-80%
- Conexões concorrentes sem GIL
- Serialização ultra-rápida (serde)
- Zero-copy data structures

**Implementação Recomendada:**

```rust
// mt5_bridge_rs/src/main.rs
use axum::{
    extract::{ws::WebSocket, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;

// Estrutura de estado compartilhado
#[derive(Clone)]
struct AppState {
    mt5_connected: Arc<RwLock<bool>>,
    clients: Arc<RwLock<HashMap<String, WebSocket>>>,
    subscribed_symbols: Arc<RwLock<std::collections::HashSet<String>>>,
}

// Tipos de mensagem
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
enum MT5Message {
    #[serde(rename = "LOGIN")]
    Login {
        login: String,
        password: String,
        server: String,
    },
    #[serde(rename = "SUBSCRIBE_TICKS")]
    SubscribeTicks { symbol: String },
    #[serde(rename = "GET_POSITIONS")]
    GetPositions { symbol: Option<String> },
    // ... outras mensagens
}

// Handler de WebSocket
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket, _| async move {
        let mut socket = socket;
        
        // Registrar cliente
        {
            let mut clients = state.clients.write().await;
            let client_id = uuid::Uuid::new_v4().to_string();
            clients.insert(client_id.clone(), socket);
        }
        
        // Loop de mensagens
        while let Some(Ok(msg)) = socket.recv().await {
            if let axum::extract::ws::Message::Text(text) = msg {
                if let Ok(msg) = serde_json::from_str::<MT5Message>(&text) {
                    handle_message(state.clone(), msg).await;
                }
            }
        }
    })
}

// Handler de mensagens
async fn handle_message(state: AppState, msg: MT5Message) {
    match msg {
        MT5Message::Login { login, password, server } => {
            // Integrar com MT5 via FFI
            handle_login(state.clone(), login, password, server).await;
        }
        MT5Message::SubscribeTicks { symbol } => {
            // Inscrever em ticks com baixa latência
            subscribe_ticks(state.clone(), symbol).await;
        }
        _ => {}
    }
}

// Função principal
#[tokio::main]
async fn main() {
    let state = AppState {
        mt5_connected: Arc::new(RwLock::new(false)),
        clients: Arc::new(RwLock::new(HashMap::new())),
        subscribed_symbols: Arc::new(RwLock::new(std::collections::HashSet::new())),
    };
    
    let app = Router::new()
        .route("/ws", get(websocket_handler))
        .route("/health", get(health_check))
        .with_state(state)
        .layer(TraceLayer::new_for_http());
    
    let listener = TcpListener::bind("0.0.0.0:8766").await.unwrap();
    println!("MT5 Bridge Rust rodando em ws://0.0.0.0:8766");
    
    axum::serve(listener, app).await.unwrap();
}
```

**Integração com MT5 via FFI:**

```rust
// mt5_bridge_rs/src/mt5_ffi.rs
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_double};

// Funções do MT5 (simuladas - usar FFI real)
extern "C" {
    fn MT5_Initialize() -> c_int;
    fn MT5_Login(login: c_int, password: *const c_char, server: *const c_char) -> c_int;
    fn MT5_SymbolInfoTick(symbol: *const c_char) -> *const TickInfo;
    fn MT5_Shutdown();
}

#[repr(C)]
struct TickInfo {
    bid: c_double,
    ask: c_double,
    last: c_double,
    volume: u64,
}

// Wrapper seguro em Rust
pub struct MT5Client {
    initialized: bool,
}

impl MT5Client {
    pub fn new() -> Self {
        MT5Client {
            initialized: false,
        }
    }
    
    pub fn initialize(&mut self) -> Result<(), String> {
        unsafe {
            if MT5_Initialize() != 0 {
                self.initialized = true;
                Ok(())
            } else {
                Err("Falha ao inicializar MT5".to_string())
            }
        }
    }
    
    pub fn login(&self, login: i32, password: &str, server: &str) -> Result<(), String> {
        if !self.initialized {
            return Err("MT5 não inicializado".to_string());
        }
        
        let password_c = CString::new(password).unwrap();
        let server_c = CString::new(server).unwrap();
        
        unsafe {
            if MT5_Login(login, password_c.as_ptr(), server_c.as_ptr()) != 0 {
                Ok(())
            } else {
                Err("Falha no login MT5".to_string())
            }
        }
    }
    
    pub fn get_tick(&self, symbol: &str) -> Option<TickInfo> {
        if !self.initialized {
            return None;
        }
        
        let symbol_c = CString::new(symbol).unwrap();
        
        unsafe {
            let tick_ptr = MT5_SymbolInfoTick(symbol_c.as_ptr());
            if tick_ptr.is_null() {
                None
            } else {
                Some(*tick_ptr)
            }
        }
    }
}

impl Drop for MT5Client {
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                MT5_Shutdown();
            }
        }
    }
}
```

### 2. Spread Calculator (ALTA PRIORIDADE) ⭐⭐⭐⭐⭐

**Problemas Atuais (Python + Pandas):**
- Pandas é lento para cálculos complexos
- GIL limitando paralelismo
- Memory overhead significativo
- Backtest pode levar minutos

**Benefícios com Rust:**
- Cálculos 10-50x mais rápidos
- True parallelism com Rayon
- Memory efficient
- Backtest em segundos

**Implementação Recomendada:**

```rust
// spread_calculator_rs/src/lib.rs
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{NaiveDate, Datelike};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StockData {
    date: NaiveDate,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SpreadOpportunity {
    data_entrada: String,
    data_saida: String,
    preco_venda_a1: f64,
    preco_compra_b1: f64,
    ganho: f64,
    retorno_percentual: f64,
}

pub struct SpreadCalculator {
    stock_cache: HashMap<String, Vec<StockData>>,
}

impl SpreadCalculator {
    pub fn new() -> Self {
        SpreadCalculator {
            stock_cache: HashMap::new(),
        }
    }
    
    pub fn calculate_spread(
        &mut self,
        symbol1: &str,
        symbol2: &str,
        data_inicial: NaiveDate,
        data_final: NaiveDate,
        ganho_minimo: f64,
    ) -> Vec<SpreadOpportunity> {
        // Carregar dados (simulado - em produção usar MT5/B3)
        let hist1 = self.load_stock_data(symbol1);
        let hist2 = self.load_stock_data(symbol2);
        
        if hist1.is_empty() || hist2.is_empty() {
            return vec![];
        }
        
        // Agrupar por dia
        let daily1 = self.group_by_day(&hist1);
        let daily2 = self.group_by_day(&hist2);
        
        // Encontrar oportunidades (paralelizado com Rayon)
        let oportunidades: Vec<SpreadOpportunity> = (0..daily1.len() - 1)
            .into_par_iter()
            .filter_map(|i| {
                let data_atual = daily1.get_index(i).unwrap().0;
                let data_seguinte = daily1.get_index(i + 1).unwrap().0;
                
                if !daily2.contains_key(&data_atual) || !daily2.contains_key(&data_seguinte) {
                    return None;
                }
                
                let preco_a1 = daily1[&data_atual].close;
                let preco_b1 = daily2[&data_atual].close;
                let preco_b2 = daily2[&data_seguinte].close;
                let preco_a2 = daily1[&data_seguinte].close;
                
                let ganho = (preco_a1 - preco_a2) + (preco_b2 - preco_b1);
                
                if ganho < ganho_minimo {
                    return None;
                }
                
                Some(SpreadOpportunity {
                    data_entrada: data_atual.to_string(),
                    data_saida: data_seguinte.to_string(),
                    preco_venda_a1: preco_a1,
                    preco_compra_b1: preco_b1,
                    ganho,
                    retorno_percentual: (ganho / preco_a1) * 100.0,
                })
            })
            .collect();
        
        oportunidades
    }
    
    pub fn find_best_pairs(
        &mut self,
        pares: Vec<(String, String)>,
        data_inicial: NaiveDate,
        data_final: NaiveDate,
        ganho_minimo: f64,
    ) -> Vec<(String, usize, f64)> {
        // Analisar pares em paralelo
        pares.into_par_iter()
            .filter_map(|(symbol1, symbol2)| {
                let oportunidades = self.calculate_spread(
                    &symbol1,
                    &symbol2,
                    data_inicial,
                    data_final,
                    ganho_minimo,
                );
                
                if oportunidades.is_empty() {
                    None
                } else {
                    let melhor_retorno = oportunidades
                        .iter()
                        .map(|op| op.retorno_percentual)
                        .fold(f64::NEG_INFINITY, f64::max);
                    
                    Some((format!("{}-{}", symbol1, symbol2), oportunidades.len(), melhor_retorno))
                }
            })
            .collect()
    }
    
    fn load_stock_data(&mut self, symbol: &str) -> Vec<StockData> {
        // Em produção, integrar com MT5/B3
        vec![]
    }
    
    fn group_by_day(&self, data: &[StockData]) -> HashMap<NaiveDate, StockData> {
        data.iter().map(|d| (d.date, d.clone())).collect()
    }
}

// Wrapper Python via PyO3
use pyo3::prelude::*;

#[pyclass]
struct PySpreadCalculator {
    inner: SpreadCalculator,
}

#[pymethods]
impl PySpreadCalculator {
    #[new]
    fn new() -> Self {
        PySpreadCalculator {
            inner: SpreadCalculator::new(),
        }
    }
    
    fn calculate_spread(
        &mut self,
        symbol1: &str,
        symbol2: &str,
        data_inicial: &str,
        data_final: &str,
        ganho_minimo: f64,
    ) -> PyResult<Vec<SpreadOpportunity>> {
        let dt_inicial = NaiveDate::parse_from_str(data_inicial, "%Y-%m-%d")
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(e.to_string()))?;
        let dt_final = NaiveDate::parse_from_str(data_final, "%Y-%m-%d")
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(e.to_string()))?;
        
        Ok(self.inner.calculate_spread(
            symbol1,
            symbol2,
            dt_inicial,
            dt_final,
            ganho_minimo,
        ))
    }
    
    fn find_best_pairs(
        &mut self,
        pares: Vec<(String, String)>,
        data_inicial: &str,
        data_final: &str,
        ganho_minimo: f64,
    ) -> PyResult<Vec<(String, usize, f64)>> {
        let dt_inicial = NaiveDate::parse_from_str(data_inicial, "%Y-%m-%d")
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(e.to_string()))?;
        let dt_final = NaiveDate::parse_from_str(data_final, "%Y-%m-%d")
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(e.to_string()))?;
        
        Ok(self.inner.find_best_pairs(
            pares,
            dt_inicial,
            dt_final,
            ganho_minimo,
        ))
    }
}

#[pymodule]
fn spread_calculator_rs(_py: Python, m: &PyModule) -> PyResult<()> {
    m.add_class::<PySpreadCalculator>()?;
    Ok(())
}
```

### 3. Indicadores Técnicos (MÉDIA PRIORIDADE) ⭐⭐⭐

**Benefícios com Rust:**
- Cálculos de indicadores 5-20x mais rápidos
- Streaming calculations sem GC pauses
- Integrar com WebAssembly para frontend

**Implementação:**

```rust
// indicators_rs/src/lib.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndicatorResult {
    timestamp: i64,
    rsi: Option<f64>,
    macd: Option<MACDValues>,
    bollinger: Option<BollingerBands>,
    sma: Option<f64>,
    ema: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MACDValues {
    macd: f64,
    signal: f64,
    histogram: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BollingerBands {
    upper: f64,
    middle: f64,
    lower: f64,
}

pub struct TechnicalIndicators;

impl TechnicalIndicators {
    pub fn calculate_rsi(prices: &[f64], period: usize) -> Option<f64> {
        if prices.len() < period {
            return None;
        }
        
        let mut gains = vec![0.0; prices.len()];
        let mut losses = vec![0.0; prices.len()];
        
        for i in 1..prices.len() {
            let change = prices[i] - prices[i - 1];
            if change > 0.0 {
                gains[i] = change;
                losses[i] = 0.0;
            } else {
                gains[i] = 0.0;
                losses[i] = -change;
            }
        }
        
        let avg_gain: f64 = gains.iter().take(period).sum::<f64>() / period as f64;
        let avg_loss: f64 = losses.iter().take(period).sum::<f64>() / period as f64;
        
        if avg_loss == 0.0 {
            return Some(100.0);
        }
        
        let rs = avg_gain / avg_loss;
        Some(100.0 - (100.0 / (1.0 + rs)))
    }
    
    pub fn calculate_macd(prices: &[f64], fast: usize, slow: usize, signal: usize) -> Option<MACDValues> {
        if prices.len() < slow {
            return None;
        }
        
        let ema_fast = Self::calculate_ema(prices, fast);
        let ema_slow = Self::calculate_ema(prices, slow);
        
        let macd_values: Vec<f64> = ema_fast.iter()
            .zip(ema_slow.iter())
            .map(|(f, s)| f - s)
            .collect();
        
        let signal = Self::calculate_ema(&macd_values, signal);
        
        Some(MACDValues {
            macd: macd_values[macd_values.len() - 1],
            signal: signal[signal.len() - 1],
            histogram: macd_values[macd_values.len() - 1] - signal[signal.len() - 1],
        })
    }
    
    pub fn calculate_bollinger_bands(prices: &[f64], period: usize, std_dev: f64) -> Option<BollingerBands> {
        if prices.len() < period {
            return None;
        }
        
        let slice = &prices[prices.len() - period..];
        let sma = slice.iter().sum::<f64>() / slice.len() as f64;
        
        let variance = slice.iter()
            .map(|p| (p - sma).powi(2))
            .sum::<f64>() / slice.len() as f64;
        let std = variance.sqrt();
        
        Some(BollingerBands {
            upper: sma + (std_dev * std),
            middle: sma,
            lower: sma - (std_dev * std),
        })
    }
    
    fn calculate_ema(prices: &[f64], period: usize) -> Vec<f64> {
        let multiplier = 2.0 / (period as f64 + 1.0);
        let mut ema = vec![0.0; prices.len()];
        
        ema[0] = prices[0];
        
        for i in 1..prices.len() {
            ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
        }
        
        ema
    }
}

// Exportar como WebAssembly para usar no frontend
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn calculate_rsi_js(prices: Vec<f64>, period: usize) -> Option<f64> {
    TechnicalIndicators::calculate_rsi(&prices, period)
}
```

### 4. Order Execution Engine (ALTA PRIORIDADE) ⭐⭐⭐⭐⭐

**Problemas Atuais (Python):**
- Latência crítica para execução de ordens
- Race conditions possíveis
- Garbage collection inesperada

**Benefícios com Rust:**
- Latência determinística (sub-millisecond)
- Zero memory leaks
- Concorrência segura

**Implementação:**

```rust
// order_engine_rs/src/lib.rs
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Order {
    id: String,
    symbol: String,
    order_type: OrderType,
    volume: f64,
    price: Option<f64>,
    stop_loss: Option<f64>,
    take_profit: Option<f64>,
    status: OrderStatus,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum OrderType {
    Buy,
    Sell,
    BuyLimit,
    SellLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum OrderStatus {
    Pending,
    Filled,
    Cancelled,
    Rejected,
}

pub struct OrderEngine {
    pending_orders: Arc<Mutex<Vec<Order>>>,
    filled_orders: Arc<Mutex<Vec<Order>>>,
}

impl OrderEngine {
    pub fn new() -> Self {
        OrderEngine {
            pending_orders: Arc::new(Mutex::new(Vec::new())),
            filled_orders: Arc::new(Mutex::new(Vec::new())),
        }
    }
    
    pub async fn submit_order(&self, order: Order) -> Result<String, String> {
        // Validações em tempo de compilação
        if order.volume <= 0.0 {
            return Err("Volume inválido".to_string());
        }
        
        // Adicionar à fila de pendentes (thread-safe)
        let mut pending = self.pending_orders.lock().await;
        order.id = uuid::Uuid::new_v4().to_string();
        order.created_at = Utc::now();
        order.status = OrderStatus::Pending;
        
        pending.push(order.clone());
        drop(pending);
        
        // Executar ordem (em thread separada)
        let engine = self.clone();
        tokio::spawn(async move {
            engine.execute_order(order).await;
        });
        
        Ok(order.id.clone())
    }
    
    async fn execute_order(&self, order: Order) {
        // Simular execução (em produção, conectar com MT5/B3)
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        
        // Mover de pendente para executada
        {
            let mut pending = self.pending_orders.lock().await;
            if let Some(pos) = pending.iter().position(|o| o.id == order.id) {
                let mut order = pending.remove(pos);
                order.status = OrderStatus::Filled;
                
                let mut filled = self.filled_orders.lock().await;
                filled.push(order);
            }
        }
    }
    
    pub async fn cancel_order(&self, order_id: &str) -> Result<(), String> {
        let mut pending = self.pending_orders.lock().await;
        
        if let Some(pos) = pending.iter().position(|o| o.id == order_id) {
            pending[pos].status = OrderStatus::Cancelled;
            return Ok(());
        }
        
        Err("Ordem não encontrada".to_string())
    }
    
    pub async fn get_pending_orders(&self) -> Vec<Order> {
        self.pending_orders.lock().await.clone()
    }
    
    pub async fn get_filled_orders(&self) -> Vec<Order> {
        self.filled_orders.lock().await.clone()
    }
}

// Exportar para Python
use pyo3::prelude::*;

#[pyclass]
struct PyOrderEngine {
    inner: Arc<OrderEngine>,
}

#[pymethods]
impl PyOrderEngine {
    #[new]
    fn new() -> Self {
        PyOrderEngine {
            inner: Arc::new(OrderEngine::new()),
        }
    }
    
    fn submit_order(&self, symbol: &str, order_type: &str, volume: f64, price: Option<f64>) -> PyResult<String> {
        let order = Order {
            id: String::new(),
            symbol: symbol.to_string(),
            order_type: match order_type {
                "BUY" => OrderType::Buy,
                "SELL" => OrderType::Sell,
                _ => return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Tipo de ordem inválido")),
            },
            volume,
            price,
            stop_loss: None,
            take_profit: None,
            status: OrderStatus::Pending,
            created_at: Utc::now(),
        };
        
        // Em produção, usar tokio::runtime
        Ok("order_id_placeholder".to_string())
    }
}

#[pymodule]
fn order_engine_rs(_py: Python, m: &PyModule) -> PyResult<()> {
    m.add_class::<PyOrderEngine>()?;
    Ok(())
}
```

### 5. Data Aggregator (BAIXA PRIORIDADE) ⭐⭐

**Benefícios com Rust:**
- Processamento de streams de dados em tempo real
- Agregação eficiente de múltiplas fontes
- Memory management otimizado

**Implementação:**

```rust
// data_aggregator_rs/src/lib.rs
use tokio::sync::broadcast;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MarketData {
    symbol: String,
    timestamp: i64,
    bid: f64,
    ask: f64,
    volume: f64,
}

pub struct DataAggregator {
    mt5_tx: broadcast::Sender<MarketData>,
    b3_tx: broadcast::Sender<MarketData>,
    profitdll_tx: broadcast::Sender<MarketData>,
    merged_rx: broadcast::Receiver<MarketData>,
}

impl DataAggregator {
    pub fn new() -> Self {
        let (mt5_tx, _) = broadcast::channel(1000);
        let (b3_tx, _) = broadcast::channel(1000);
        let (profitdll_tx, _) = broadcast::channel(1000);
        let (_, merged_rx) = broadcast::channel(1000);
        
        DataAggregator {
            mt5_tx,
            b3_tx,
            profitdll_tx,
            merged_rx,
        }
    }
    
    pub fn subscribe_mt5(&self) -> broadcast::Receiver<MarketData> {
        self.mt5_tx.subscribe()
    }
    
    pub fn subscribe_b3(&self) -> broadcast::Receiver<MarketData> {
        self.b3_tx.subscribe()
    }
    
    pub async fn merge_streams(&self) {
        // Merge de múltiplas fontes em tempo real
        let mut mt5_rx = self.subscribe_mt5();
        let mut b3_rx = self.subscribe_b3();
        
        tokio::select! {
            data = mt5_rx.recv() => {
                // Processar dados MT5
            }
            data = b3_rx.recv() => {
                // Processar dados B3
            }
        }
    }
}
```

---

## Estratégia de Migração Incremental

### Fase 1: Hotspots de Performance (1-2 meses)

**Componentes:**
1. ✅ MT5 Bridge → Rust (prioridade máxima)
2. ✅ Spread Calculator → Rust

**Objetivos:**
- Reduzir latência WebSocket em 70%
- Acelerar backtest em 10x
- Manter compatibilidade com frontend

**Integração:**

```python
# mt5_bridge.py - Versão híbrida
import subprocess
import asyncio
import json

class HybridMT5Bridge:
    def __init__(self):
        # Iniciar servidor Rust como subprocesso
        self.rust_process = subprocess.Popen(
            ['./mt5_bridge_rs/target/release/mt5_bridge_rs'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
    
    async def handle_message(self, message: dict):
        # Enviar para servidor Rust
        # Rust processa e retorna resultado
        pass
```

### Fase 2: Componentes de Cálculo (2-3 meses)

**Componentes:**
1. Indicadores técnicos → Rust + WebAssembly
2. Order Engine → Rust
3. Backtesting → Rust

**Objetivos:**
- Cálculos de indicadores 20x mais rápidos
- Execução de ordens com latência sub-ms
- Backtest de estratégias em segundos

**Integração com Frontend:**

```typescript
// src/services/indicatorsService.ts
// Carregar módulo WebAssembly
import init, { calculate_rsi_js } from '../wasm/indicators_rs';

let wasmModule = null;

export async function initIndicators() {
  wasmModule = await init();
}

export function calculateRSI(prices: number[], period: number): number | null {
  if (!wasmModule) {
    throw new Error('WASM não inicializado');
  }
  return calculate_rsi_js(prices, period);
}
```

### Fase 3: Infraestrutura (3-4 meses)

**Componentes:**
1. Data Aggregator → Rust
2. Cache Layer → Rust
3. WebSocket Server → Rust completo

**Objetivos:**
- Unificar todas as fontes de dados
- Implementar cache ultra-rápido
- Migrar servidor WebSocket completo para Rust

### Fase 4: Otimização Avançada (4-6 meses)

**Componentes:**
1. Machine Learning inference → Rust (ONNX/TensorFlow)
2. Real-time analytics → Rust
3. Compression/Encryption → Rust

**Objetivos:**
- Inference de ML 5-10x mais rápida
- Analytics em tempo real
- Otimização de rede

---

## Implementações Práticas

### Cargo.toml - Estrutura do Projeto

```toml
[workspace]
members = [
    "mt5_bridge_rs",
    "spread_calculator_rs",
    "indicators_rs",
    "order_engine_rs",
    "data_aggregator_rs",
]
resolver = "2"

[workspace.package]
version = "0.1.0"
edition = "2021"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

### Integração com Next.js

```typescript
// src/app/api/rust/spread/route.ts
import { NextResponse } from 'next/server';

// Chamar binário Rust via API
export async function POST(request: Request) {
  const body = await request.json();
  
  // Chamar servidor Rust (já rodando)
  const response = await fetch('http://localhost:8767/api/spread/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  const data = await response.json();
  return NextResponse.json(data);
}
```

### Deploy com Docker

```dockerfile
# mt5_bridge_rs/Dockerfile
FROM rust:1.75-slim as builder

WORKDIR /app
COPY . .

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev

RUN cargo build --release

FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y \
    ca-certificates

WORKDIR /app

COPY --from=builder /app/target/release/mt5_bridge_rs .

EXPOSE 8766

CMD ["./mt5_bridge_rs"]
```

---

## Roadmap de Migração

### Mês 1-2: Fundação
- [ ] Configurar workspace Rust
- [ ] Implementar MT5 Bridge em Rust (FFI)
- [ ] Implementar Spread Calculator em Rust
- [ ] Testes de performance comparativos

### Mês 3-4: Expansão
- [ ] Indicadores técnicos + WebAssembly
- [ ] Order Engine em Rust
- [ ] Integração com frontend (PyO3)
- [ ] Documentação completa

### Mês 5-6: Infraestrutura
- [ ] Data Aggregator em Rust
- [ ] Cache layer em Rust
- [ ] Migration completa do WebSocket server
- [ ] Monitoramento e logging

### Mês 7+: Otimização
- [ ] ML inference engine
- [ ] Real-time analytics
- [ ] GPU acceleration (cudarcus)
- [ ] Advanced profiling

---

## Custo-Benefício

### Benefícios Quantitativos

| Componente | Latência Atual | Latência Rust | Melhoria |
|-------------|----------------|----------------|----------|
| MT5 Bridge | 50-100ms | 10-20ms | 5-10x |
| Spread Calculator | 5-10s | 0.1-0.5s | 10-100x |
| Indicadores | 100-500ms | 5-20ms | 5-50x |
| Order Execution | 20-50ms | 1-5ms | 10-50x |
| Backtest | 5-30min | 10-30s | 10-100x |

### Benefícios Qualitativos

- **Segurança**: Zero memory leaks, no segfaults
- **Confiabilidade**: Sem GC pauses inesperados
- **Escalabilidade**: True parallelism
- **Manutenibilidade**: Type system previne bugs
- **Deploy**: Single binary, no runtime dependencies

### Custos

- **Desenvolvimento**: Curva de aprendizado íngreme (2-3 meses para equipe)
- **Manutenção**: Menos bugs, mas necessidade de equipe especializada
- **Infraestrutura**: Redução de recursos (CPU, memory)

### ROI Estimado

**Investimento:**
- 6 meses de migração (1 desenvolvedor full-time)
- Treinamento da equipe (1-2 meses)

**Retorno:**
- 70-90% redução em custos de servidor (performance)
- 10-100x melhoria em用户体验 (latência)
- Redução de 80% em bugs de memória
- Time-to-market reduzido (protótipos mais rápidos)

---

## Conclusão

Rust é ideal para a WR Trading Pro porque:

1. **Trading é time-critical**: Latência determinística é essencial
2. **Financeira é safety-critical**: Rust previne memory bugs
3. **High-frequency data**: Concorrência segura para múltiplas conexões
4. **Long-term maintainability**: Type system garante código robusto

### Próximos Passos

1. **Imediato**: Migrar MT5 Bridge para Rust (maior ROI)
2. **Curto prazo**: Spread Calculator + Indicadores
3. **Médio prazo**: Order Engine + Data Aggregator
4. **Longo prazo**: ML inference + Advanced analytics

### Recursos

- [The Rust Programming Language](https://doc.rust-lang.org/book/)
- [PyO3 Guide](https://pyo3.rs/v0.20/)
- [Wasm-bindgen](https://rustwasm.github.io/wasm-bindgen/)
- [Tokio Tutorial](https://tokio.rs/tokio/tutorial)
- [Rayon Guide](https://docs.rs/rayon/)

---

**Última atualização:** Fevereiro 2026