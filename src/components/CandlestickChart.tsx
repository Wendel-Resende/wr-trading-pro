"use client";

import { useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  CandlestickData, 
  Time, 
  LineData,
  HistogramData 
} from 'lightweight-charts';
import { mt5Service } from '@/services/mt5Service';

interface IndicatorData {
  name: string;
  enabled: boolean;
  color: string;
}

interface CandlestickChartProps {
  data: CandlestickData[];
  symbol?: string;
  height?: number;
  indicators?: IndicatorData[];
  onIndicatorChange?: (indicators: IndicatorData[]) => void;
  showVolume?: boolean;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string) => void;
}

export default function CandlestickChart({ 
  data: initialData,
  symbol: initialSymbol = '', 
  height = 500,
  indicators,
  onIndicatorChange,
  showVolume = false,
  timeframe = '1H',
  onTimeframeChange
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({} as any);
  const [chartData, setChartData] = useState<CandlestickData[]>(initialData || []);
  const [symbol, setSymbol] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorData[]>(indicators || [
    { name: 'MA7', enabled: false, color: '#f59e0b' },
    { name: 'MA21', enabled: false, color: '#8b5cf6' },
    { name: 'MA50', enabled: false, color: '#ec4899' },
    { name: 'RSI', enabled: false, color: '#06b6d4' },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  const timeframes = ['1m', '5m', '15m', '30m', '1H', '4H', '1D'];

  // Buscar dados do MT5 quando símbolo ou timeframe mudar
  useEffect(() => {
    // Se dados iniciais foram fornecidos via props, usar eles
    if (initialData && initialData.length > 0) {
      setChartData(initialData);
      return;
    }

    // Caso contrário, buscar dados do MT5
    if (symbol && mt5Service.getConnectionState().isConnected) {
      setIsLoading(true);
      mt5Service.getChartData(symbol, timeframe, 100);
    }
  }, [symbol, timeframe, initialData]);

  // Atualizar símbolo quando a prop inicialSymbol mudar
  useEffect(() => {
    if (initialSymbol && initialSymbol !== symbol) {
      setSymbol(initialSymbol);
      setInputValue(initialSymbol);
    }
  }, [initialSymbol]);

  // Handler para mudança de símbolo (apenas atualiza o input, não busca dados)
  const handleInputChange = (newSymbol: string) => {
    setInputValue(newSymbol.toUpperCase());
  };

  // Handler para carregar símbolo (Enter ou botão)
  const handleLoadSymbol = () => {
    const upperSymbol = inputValue.toUpperCase().trim();
    if (upperSymbol && mt5Service.getConnectionState().isConnected) {
      setSymbol(upperSymbol);
      setIsLoading(true);
      mt5Service.getChartData(upperSymbol, timeframe, 100);
    }
  };

  // Handler para submissão do formulário (Enter)
  const handleSymbolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLoadSymbol();
  };

  // Listener para dados de gráfico do MT5
  useEffect(() => {
    const handleChartData = (message: any) => {
      console.log('Dados de gráfico recebidos do MT5:', message);
      if (message.data && message.data.candles) {
        const candles: CandlestickData[] = message.data.candles.map((candle: any) => ({
          time: candle.time as Time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }));
        setChartData(candles);
        setIsLoading(false);
      }
    };

    mt5Service.on('CHART_DATA', handleChartData);

    return () => {
      mt5Service.off('CHART_DATA', handleChartData);
    };
  }, []);

  // Listener para ticks do MT5 - atualizar gráfico em tempo real
  useEffect(() => {
    if (!symbol) return;

    const handleTick = (tick: any) => {
      // Verificar se o tick é para o símbolo atual
      if (tick.symbol !== symbol) return;

      console.log('[CandlestickChart] Tick recebido para', symbol, ':', tick);

      setChartData(prevData => {
        if (prevData.length === 0) return prevData;

        // Obter a última candlestick
        const lastCandle = prevData[prevData.length - 1];
        
        // Converter o tempo do tick para timestamp em segundos
        const tickTime = new Date(tick.time).getTime() / 1000;
        
        // Calcular o tempo do candle atual baseado no timeframe
        const timeframeToSeconds: Record<string, number> = {
          '1m': 60,
          '5m': 300,
          '15m': 900,
          '30m': 1800,
          '1H': 3600,
          '4H': 14400,
          '1D': 86400,
        };
        
        const candleDuration = timeframeToSeconds[timeframe] || 3600;
        const currentCandleTime = Math.floor(tickTime / candleDuration) * candleDuration;
        
        // Verificar se o tick está na mesma candle ou em uma nova
        if (currentCandleTime > (lastCandle.time as number)) {
          // Nova candlestick - criar uma nova candle
          const newCandle: CandlestickData & { volume?: number } = {
            time: currentCandleTime as Time,
            open: tick.bid || tick.last,
            high: tick.bid || tick.last,
            low: tick.bid || tick.last,
            close: tick.bid || tick.last,
            volume: tick.volume || 0,
          };
          return [...prevData, newCandle];
        } else {
          // Atualizar candlestick existente
          const price = tick.bid || tick.last;
          const lastCandleWithVolume = lastCandle as any;
          const updatedData = [...prevData];
          updatedData[prevData.length - 1] = {
            ...lastCandle,
            high: Math.max(lastCandle.high, price),
            low: Math.min(lastCandle.low, price),
            close: price,
            volume: (lastCandleWithVolume.volume || 0) + (tick.volume || 0),
          } as CandlestickData & { volume?: number };
          return updatedData;
        }
      });
    };

    mt5Service.on('tick', handleTick);

    return () => {
      mt5Service.off('tick', handleTick);
    };
  }, [symbol, timeframe]);

  // Calcular Médias Móveis
  const calculateSMA = (data: CandlestickData[], period: number): LineData[] => {
    const sma: LineData[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        sma.push({
          time: data[i].time,
          value: 0,
        });
      } else {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += data[i - j].close;
        }
        sma.push({
          time: data[i].time,
          value: sum / period,
        });
      }
    }
    return sma;
  };

  // Calcular RSI
  const calculateRSI = (data: CandlestickData[], period: number = 14): LineData[] => {
    const rsi: LineData[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    const avgGains: number[] = [];
    const avgLosses: number[] = [];

    // Primeira média
    if (gains.length >= period) {
      let sumGains = 0;
      let sumLosses = 0;
      for (let i = 0; i < period; i++) {
        sumGains += gains[i];
        sumLosses += losses[i];
      }
      avgGains.push(sumGains / period);
      avgLosses.push(sumLosses / period);
    }

    // Médias subsequentes
    for (let i = period; i < gains.length; i++) {
      avgGains.push((avgGains[avgGains.length - 1] * (period - 1) + gains[i]) / period);
      avgLosses.push((avgLosses[avgLosses.length - 1] * (period - 1) + losses[i]) / period);
    }

    // Calcular RSI
    for (let i = 0; i < avgGains.length; i++) {
      const rs = avgLosses[i] === 0 ? 100 : avgGains[i] / avgLosses[i];
      rsi.push({
        time: data[i + period].time,
        value: 100 - (100 / (1 + rs)),
      });
    }

    return rsi;
  };

  // Toggle indicador
  const toggleIndicator = (indicatorName: string) => {
    const newIndicators = selectedIndicators.map(ind => 
      ind.name === indicatorName ? { ...ind, enabled: !ind.enabled } : ind
    );
    setSelectedIndicators(newIndicators);
    if (onIndicatorChange) {
      onIndicatorChange(newIndicators);
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0a0a0f' } as any,
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: 'rgba(0, 255, 255, 0.1)' },
        horzLines: { color: 'rgba(0, 255, 255, 0.1)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#00ffff',
          width: 1,
          style: 2,
        },
        horzLine: {
          color: '#00ffff',
          width: 1,
          style: 2,
        },
      },
      rightPriceScale: {
        borderColor: '#1a1a2e',
      },
      timeScale: {
        borderColor: '#1a1a2e',
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
    });

    // Add candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#00ff00',
      downColor: '#ff0000',
      borderDownColor: '#ff0000',
      borderUpColor: '#00ff00',
      wickDownColor: '#ff0000',
      wickUpColor: '#00ff00',
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Add volume series se habilitado
    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    if (showVolume) {
      volumeSeries = chart.addHistogramSeries({
        color: '#00ffff33',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });
      volumeSeriesRef.current = volumeSeries;
    }

    chartRef.current = chart;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [height]);

  // Atualizar dados do gráfico
  useEffect(() => {
    if (!candlestickSeriesRef.current || chartData.length === 0) return;

    candlestickSeriesRef.current.setData(chartData);

    // Atualizar volume
    if (showVolume && volumeSeriesRef.current) {
      const volumeData: HistogramData[] = chartData.map(candle => ({
        time: candle.time,
        value: (candle as any).volume || 0,
        color: candle.close >= candle.open ? '#00ff0055' : '#ff000055',
      }));
      volumeSeriesRef.current.setData(volumeData);
    }

    // Atualizar médias móveis e outros indicadores
    selectedIndicators.forEach(indicator => {
      if (indicator.enabled) {
        if (indicator.name.startsWith('MA')) {
          const period = parseInt(indicator.name.replace('MA', ''));
          const smaData = calculateSMA(chartData, period);
          
          if (!indicatorSeriesRef.current[indicator.name]) {
            const lineSeries = chartRef.current?.addLineSeries({
              color: indicator.color,
              lineWidth: 2,
              title: indicator.name,
            });
            if (lineSeries) {
              indicatorSeriesRef.current[indicator.name] = lineSeries;
            }
          }
          
          indicatorSeriesRef.current[indicator.name]?.setData(smaData);
        } else if (indicator.name === 'RSI') {
          const rsiData = calculateRSI(chartData);
          
          if (!indicatorSeriesRef.current['RSI']) {
            const lineSeries = chartRef.current?.addLineSeries({
              color: indicator.color,
              lineWidth: 2,
              title: 'RSI',
              priceScaleId: 'rsi',
            });
            if (lineSeries) {
              lineSeries.priceScale().applyOptions({
                scaleMargins: {
                  top: 0.8,
                  bottom: 0,
                },
              });
              indicatorSeriesRef.current['RSI'] = lineSeries;
            }
          }
          
          indicatorSeriesRef.current['RSI']?.setData(rsiData);
        }
      } else {
        // Esconder indicadores desabilitados
        if (indicatorSeriesRef.current[indicator.name]) {
          indicatorSeriesRef.current[indicator.name]?.applyOptions({ visible: false });
        }
      }
    });
  }, [chartData, selectedIndicators, showVolume]);

  return (
    <div className="relative w-full">
      {/* Header com símbolo e controles */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          {/* Símbolo - Input editável */}
          <form onSubmit={handleSymbolSubmit} className="flex items-center gap-2">
            <div className="bg-cyber-dark/80 px-3 py-1 rounded border border-cyber-cyan/30 flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="ATIVO"
                className="bg-transparent font-orbitron text-sm text-cyber-cyan w-24 outline-none uppercase placeholder:text-gray-500"
                maxLength={10}
              />
              <button
                type="submit"
                className="text-cyber-cyan hover:text-white transition-colors"
                title="Carregar ativo"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </form>

          {/* Timeframes */}
          {onTimeframeChange && (
            <div className="flex gap-1 bg-cyber-dark/80 px-2 py-1 rounded border border-cyber-border/50">
              {timeframes.map(tf => (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange(tf)}
                  className={`px-2 py-1 rounded text-xs font-space transition-colors ${
                    timeframe === tf
                      ? 'bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50'
                      : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-dark/50'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Controles de indicadores */}
        <div className="flex items-center gap-2 bg-cyber-dark/80 px-3 py-1 rounded border border-cyber-border/50">
          <span className="text-xs text-gray-400 font-space mr-2">Indicadores:</span>
          {selectedIndicators.map(indicator => (
            <button
              key={indicator.name}
              onClick={() => toggleIndicator(indicator.name)}
              className={`px-2 py-1 rounded text-xs font-space transition-all ${
                indicator.enabled
                  ? 'bg-opacity-80 border border-cyber-cyan/50'
                  : 'text-gray-500 hover:text-gray-400'
              }`}
              style={{
                backgroundColor: indicator.enabled ? indicator.color + '33' : undefined,
                color: indicator.enabled ? indicator.color : undefined,
              }}
            >
              {indicator.name}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfico */}
      <div ref={chartContainerRef} className="w-full" style={{ height: `${height}px` }}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-cyber-cyan font-space">Carregando dados do MT5...</div>
          </div>
        )}
      </div>

      {/* Legenda de Volume */}
      {showVolume && (
        <div className="absolute bottom-2 right-2 bg-cyber-dark/80 px-2 py-1 rounded border border-cyber-cyan/30 flex items-center gap-2">
          <div className="w-3 h-1 bg-green-400/50"></div>
          <span className="text-xs text-gray-400 font-space">Volume</span>
        </div>
      )}
    </div>
  );
}
