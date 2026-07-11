/**
 * Agents API Route - WR Trading Pro
 * Multi-agent trading system with LLM integration
 *
 * POST /api/agents
 *   - suggest-operation: Analisa mercado e sugere operacao (single LLM)
 *   - suggest-operation-pipeline: Analisa via pipeline multi-agent Python
 *   - Uses OpenAI, Ollama local, or mock responses
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';

const agentState = {
  director: { status: 'ready' as const, lastRun: null as string | null },
  quant: { status: 'ready' as const, lastRun: null as string | null },
};

interface OperationSuggestion {
  action: 'BUY' | 'SELL' | 'HOLD';
  ticker: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  quantity: number;
  risk_score: number;
  confidence: number;
  rationale: string;
  timestamp: string;
}

interface MarketData {
  price: number;
  bid: number;
  ask: number;
  previousClose: number;
  change?: number;
  changePercent?: number;
}

/**
 * Generate mock operation suggestion (fallback)
 */
function getMockSuggestion(ticker: string, marketData: MarketData): OperationSuggestion {
  const price = marketData.price || 38.50;
  const change = marketData.changePercent || 0;

  let action: 'BUY' | 'SELL' | 'HOLD';
  let confidence: number;
  let rationale: string;

  if (change < -2) {
    action = 'BUY';
    confidence = 0.65;
    rationale = `Queda de ${change.toFixed(2)}% identificada. Possivel sobre-venda.`;
  } else if (change > 2) {
    action = 'SELL';
    confidence = 0.60;
    rationale = `Alta de ${change.toFixed(2)}%. Possivel realizacao.`;
  } else {
    action = 'HOLD';
    confidence = 0.50;
    rationale = `Variacao de ${change.toFixed(2)}%. Sem sinal claro.`;
  }

  const riskScore = action === 'BUY' ? 0.40 : action === 'SELL' ? 0.50 : 0.25;

  return {
    action,
    ticker,
    entry_price: price,
    stop_loss: action === 'BUY' ? price * 0.97 : action === 'SELL' ? price * 1.03 : price * 0.98,
    take_profit: action === 'BUY' ? price * 1.06 : action === 'SELL' ? price * 0.94 : price * 1.03,
    quantity: 100,
    risk_score: riskScore,
    confidence,
    rationale,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate real suggestion using LLM (single call)
 */
async function getLlmSuggestion(
  ticker: string,
  marketData: MarketData,
  llmMode: string,
  apiKey: string,
  localUrl: string,
  localModel: string
): Promise<OperationSuggestion> {
  const price = marketData.price || 38.50;
  const change = marketData.changePercent || 0;
  const bid = marketData.bid || price;
  const ask = marketData.ask || price;
  const spread = ask - bid;

  const prompt = `Voce e um analista de trading profissional para o mercado brasileiro (B3).

Analise o ativo ${ticker} com os seguintes dados de mercado:

DADOS ATUAIS:
- Preco Atual: R$ ${price.toFixed(2)}
- Bid: R$ ${bid.toFixed(2)}
- Ask: R$ ${ask.toFixed(2)}
- Spread: R$ ${spread.toFixed(2)}
- Fechamento Anterior: R$ ${(marketData.previousClose || price).toFixed(2)}
- Variacao: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%

Com base nessa informacao, faca uma analise tecnica basica e sugira uma operacao (BUY, SELL ou HOLD) com precisoes de preco de entrada, stop loss e take profit.

Analise tambem:
- Suporte e resistencia
- Momento (alta/baixa)
- Risco/Retorno

Responda APENAS com JSON valido neste formato exato, sem nenhum texto adicional:
{
  "action": "BUY" | "SELL" | "HOLD",
  "entry_price": numero,
  "stop_loss": numero,
  "take_profit": numero,
  "quantity": numero,
  "risk_score": numero entre 0 e 1,
  "confidence": numero entre 0 e 1,
  "rationale": "explicacao em portugues com sua analise"
}`;

  let response;

  if (llmMode === 'openai' && apiKey) {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';

    try {
      const parsed = JSON.parse(content);
      return {
        ...parsed,
        ticker,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return getMockSuggestion(ticker, marketData);
    }

  } else if (llmMode === 'local' && localUrl) {
    response = await fetch(`${localUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: localModel || 'ministral-3:8b',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.message?.content || '{}';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }

    try {
      const parsed = JSON.parse(content);
      return {
        ...parsed,
        ticker,
        timestamp: new Date().toISOString(),
      };
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      return getMockSuggestion(ticker, marketData);
    }
  }

  return getMockSuggestion(ticker, marketData);
}

/**
 * Run multi-agent pipeline via Python subprocess
 * Note: Pipeline is slow (~2-3 min for full multi-agent analysis)
 */
async function runPipeline(
  ticker: string,
  marketData: MarketData,
  model: string
): Promise<OperationSuggestion> {
  const projectRoot = process.cwd();
  const wrapperPath = join(projectRoot, 'agents', 'pipeline_wrapper.py');
  const fs = require('fs');
  const os = require('os');

  const inputData = {
    ticker: ticker.toUpperCase(),
    market_data: marketData,
    model: model || 'ministral-3:8b',
  };

  // Write input to temp file to avoid stdin encoding issues on Windows
  const tmpFile = join(os.tmpdir(), `pipeline_${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(inputData));

  return new Promise((resolve, reject) => {
    // Pipeline timeout: 5 minutes
    const timeoutMs = 5 * 60 * 1000;
    let timeoutId: ReturnType<typeof setTimeout>;

    const python = spawn('python', [wrapperPath, tmpFile], {
      cwd: projectRoot,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    // Auto-timeout after 5 minutes
    timeoutId = setTimeout(() => {
      python.kill();
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error('Pipeline timeout after 5 minutos'));
    }, timeoutMs);

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        try { fs.unlinkSync(tmpFile); } catch {}
        reject(new Error(`Pipeline failed with code ${code}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);

        if (result.error) {
          throw new Error(result.error);
        }

        try { fs.unlinkSync(tmpFile); } catch {}

        // Pipeline returns direct fields - use them directly
        resolve({
          action: result.action || 'HOLD',
          ticker: result.ticker || ticker,
          entry_price: result.entry_price || marketData.price || 0,
          stop_loss: result.stop_loss || marketData.price * 0.97,
          take_profit: result.take_profit || marketData.price * 1.06,
          quantity: result.quantity || 100,
          risk_score: result.risk_score || 0.5,
          confidence: result.confidence || 0.5,
          rationale: typeof result.rationale === 'string' ? result.rationale : JSON.stringify(result.rationale || 'Análise via pipeline multi-agent'),
          timestamp: result.timestamp || new Date().toISOString(),
        });
      } catch (parseError) {
        try { fs.unlinkSync(tmpFile); } catch {}
        reject(new Error('Failed to parse pipeline output'));
      }
    });

    python.on('error', (err) => {
      clearTimeout(timeoutId);
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error(`Failed to spawn pipeline: ${err.message}`));
    });
  });
}

function extractAction(result: any): 'BUY' | 'SELL' | 'HOLD' | null {
  // Tentar extrair action de diferentes formatos de output
  const str = JSON.stringify(result).toUpperCase();
  if (str.includes('"BUY"') || str.includes("'BUY'")) return 'BUY';
  if (str.includes('"SELL"') || str.includes("'SELL'")) return 'SELL';
  if (str.includes('"HOLD"') || str.includes("'HOLD'")) return 'HOLD';
  return null;
}

function extractPrice(result: any, type: 'entry' | 'stop' | 'target'): number | null {
  const str = JSON.stringify(result);
  const patterns: Record<string, RegExp[]> = {
    entry: [/entry[_\s]?price["\s:]+(\d+[.,]?\d*)/i, /price["\s:]+(\d+[.,]?\d*)/i],
    stop: [/stop[_\s]?loss["\s:]+(\d+[.,]?\d*)/i, /stop_loss["\s:]+(\d+[.,]?\d*)/i],
    target: [/take[_\s]?profit["\s:]+(\d+[.,]?\d*)/i, /target["\s:]+(\d+[.,]?\d*)/i],
  };

  for (const regex of patterns[type] || []) {
    const match = str.match(regex);
    if (match) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return null;
}

function extractQuantity(result: any): number | null {
  const str = JSON.stringify(result);
  const match = str.match(/quantity["\s:]+(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function extractRiskScore(result: any): number | null {
  const str = JSON.stringify(result);
  const match = str.match(/risk[_\s]?score["\s:]+(0[.,]?\d*|1[.,]?0*)/i);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

function extractConfidence(result: any): number | null {
  const str = JSON.stringify(result);
  const match = str.match(/confidence["\s:]+(0[.,]?\d*|1[.,]?0*)/i);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

function extractRationale(result: any): string | null {
  const str = JSON.stringify(result);
  const match = str.match(/rationale["\s:]+["']([^"']+)["']/i);
  return match ? match[1] : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ticker, market_data, api_key, llm_mode, local_url, local_model } = body;

    // Status check
    if (action === 'status') {
      return NextResponse.json({
        success: true,
        data: {
          status: 'ready',
          llm_mode: llm_mode || 'mock',
          available_models: ['mock', 'openai', 'local'],
          available_pipelines: ['single', 'multi-agent'],
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Suggest operation (single LLM call)
    if (action === 'suggest-operation') {
      if (!ticker) {
        return NextResponse.json(
          { error: 'ticker is required' },
          { status: 400 }
        );
      }

      const marketData: MarketData = market_data || { price: 0, bid: 0, ask: 0, previousClose: 0 };
      const mode = llm_mode || 'mock';

      let suggestion: OperationSuggestion;

      if (mode === 'mock') {
        suggestion = getMockSuggestion(ticker.toUpperCase(), marketData);
      } else {
        try {
          suggestion = await getLlmSuggestion(
            ticker.toUpperCase(),
            marketData,
            mode,
            api_key || '',
            local_url || 'http://localhost:11434',
            local_model || 'ministral-3:8b'
          );
        } catch (error: any) {
          suggestion = getMockSuggestion(ticker.toUpperCase(), marketData);
          suggestion.rationale = `(LLM indisponivel: ${error.message}) ${suggestion.rationale}`;
        }
      }

      agentState.director.lastRun = new Date().toISOString();

      return NextResponse.json({ success: true, data: suggestion });
    }

    // Suggest operation via multi-agent pipeline
    if (action === 'suggest-operation-pipeline') {
      if (!ticker) {
        return NextResponse.json(
          { error: 'ticker is required' },
          { status: 400 }
        );
      }

      const marketData: MarketData = market_data || { price: 0, bid: 0, ask: 0, previousClose: 0 };
      const model = local_model || 'ministral-3:8b';

      try {
        const suggestion = await runPipeline(ticker.toUpperCase(), marketData, model);
        agentState.director.lastRun = new Date().toISOString();
        return NextResponse.json({ success: true, data: suggestion });
      } catch (error: any) {
        console.error('Pipeline error:', error);
        // Fallback to single LLM call
        try {
          const fallback = await getLlmSuggestion(
            ticker.toUpperCase(),
            marketData,
            'local',
            '',
            local_url || 'http://localhost:11434',
            model
          );
          fallback.rationale = `(Pipeline indisponivel: ${error.message}) ${fallback.rationale}`;
          return NextResponse.json({ success: true, data: fallback });
        } catch {
          const mock = getMockSuggestion(ticker.toUpperCase(), marketData);
          mock.rationale = `(Pipeline e LLM indisponiveis) ${mock.rationale}`;
          return NextResponse.json({ success: true, data: mock });
        }
      }
    }

    return NextResponse.json(
      { error: 'Unknown action. Use: suggest-operation, suggest-operation-pipeline, status' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Agents API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      status: 'ready',
      modes: ['mock', 'openai', 'local'],
      pipelines: ['single', 'multi-agent'],
      default_local_model: 'ministral-3:8b',
      available_local_models: ['ministral-3:8b', 'gemma4:e2b', 'qwen3.5:0.8b'],
      endpoints: {
        POST: {
          'suggest-operation': 'Analisa e sugere operacao (single LLM)',
          'suggest-operation-pipeline': 'Analisa via pipeline multi-agent Python',
          status: 'Check agent status',
        },
      },
      timestamp: new Date().toISOString(),
    },
  });
}
