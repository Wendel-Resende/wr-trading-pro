'use client';

import React, { useState, useEffect } from 'react';
import { StockMonitoringInput, StockMonitoring } from '@/types/stock-monitoring';

interface StockMonitoringFormProps {
  stock?: StockMonitoring;
  onSubmit: (data: StockMonitoringInput) => Promise<void>;
  onCancel: () => void;
}

export default function StockMonitoringForm({ stock, onSubmit, onCancel }: StockMonitoringFormProps) {
  const [formData, setFormData] = useState<StockMonitoringInput>({
    assetId: stock?.assetId || '',
    stockType: stock?.stockType || 'ON',
    composition: stock?.composition || 1,
    payoutEstatuto: stock?.payoutEstatuto || undefined,
    dyMedia3Anos: stock?.dyMedia3Anos || undefined,
    gatilhoROE: stock?.gatilhoROE || undefined,
    gatilhoVPA: stock?.gatilhoVPA || undefined,
    gatilhoLPA: stock?.gatilhoLPA || undefined,
    precoTetoReajustado: stock?.precoTetoReajustado || undefined,
    metaPapeis: stock?.metaPapeis || 0,
    patrimonioLiquido: stock?.patrimonioLiquido || undefined,
    lucroLiquido: stock?.lucroLiquido || undefined,
    acoesEmitidas: stock?.acoesEmitidas ? Number(stock.acoesEmitidas) : undefined,
    vpa: stock?.vpa || undefined,
    pVpa: stock?.pVpa || undefined,
    lpa: stock?.lpa || undefined,
    precoLucro: stock?.precoLucro || undefined,
    roe: stock?.roe || undefined,
    previsaoDividendoAnual: stock?.previsaoDividendoAnual || undefined,
    precoAtual: stock?.precoAtual || undefined,
    quantidadeAdquirida: stock?.quantidadeAdquirida || 0,
    valorInvestido: stock?.valorInvestido || undefined,
    precoMedioCompra: stock?.precoMedioCompra || undefined,
    observacoes: stock?.observacoes || '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await onSubmit(formData);
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar monitoramento');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    let processedValue = value;
    
    // Converte código da ação para maiúsculas automaticamente
    if (name === 'assetId' && value) {
      processedValue = value.toUpperCase();
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: processedValue === '' ? undefined : 
              ['assetId', 'stockType', 'observacoes'].includes(name) ? processedValue :
              name === 'stockType' ? processedValue :
              parseFloat(processedValue),
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Dados do Ativo */}
      <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">Dados do Ativo</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Código da Ação * (ex: PETR4, VALE3)
            </label>
            <input
              type="text"
              name="assetId"
              value={formData.assetId}
              onChange={handleChange}
              placeholder="Digite o código da ação..."
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors uppercase"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Tipo de Ação *
            </label>
            <select
              name="stockType"
              value={formData.stockType}
              onChange={handleChange}
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
              required
            >
              <option value="ON">ON</option>
              <option value="PN">PN</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Preço Atual
            </label>
            <input
              type="number"
              name="precoAtual"
              value={formData.precoAtual || ''}
              onChange={handleChange}
              step="0.01"
              placeholder="0.00"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Composição
            </label>
            <input
              type="number"
              name="composition"
              value={formData.composition}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Dados de Dividendos */}
      <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-pink mb-4">Dados de Dividendos</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Payout do Estatuto (%)
            </label>
            <input
              type="number"
              name="payoutEstatuto"
              value={formData.payoutEstatuto || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              DY Média 3 Anos (%)
            </label>
            <input
              type="number"
              name="dyMedia3Anos"
              value={formData.dyMedia3Anos || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Previsão Dividendo Anual
            </label>
            <input
              type="number"
              name="previsaoDividendoAnual"
              value={formData.previsaoDividendoAnual || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Gatilhos de Compra */}
      <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-purple mb-4">Gatilhos de Compra</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Gatilho ROE (%)
            </label>
            <input
              type="number"
              name="gatilhoROE"
              value={formData.gatilhoROE || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Gatilho VPA
            </label>
            <input
              type="number"
              name="gatilhoVPA"
              value={formData.gatilhoVPA || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Gatilho LPA
            </label>
            <input
              type="number"
              name="gatilhoLPA"
              value={formData.gatilhoLPA || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Dados Financeiros */}
      <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">Dados Financeiros</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Patrimônio Líquido
            </label>
            <input
              type="number"
              name="patrimonioLiquido"
              value={formData.patrimonioLiquido || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Lucro Líquido
            </label>
            <input
              type="number"
              name="lucroLiquido"
              value={formData.lucroLiquido || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Ações Emitidas
            </label>
            <input
              type="number"
              name="acoesEmitidas"
              value={formData.acoesEmitidas || ''}
              onChange={handleChange}
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Valor Investido *
            </label>
            <input
              type="number"
              name="valorInvestido"
              value={formData.valorInvestido || ''}
              onChange={handleChange}
              step="0.01"
              placeholder="0.00"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Quantidade Adquirida
            </label>
            <input
              type="number"
              name="quantidadeAdquirida"
              value={formData.quantidadeAdquirida || 0}
              onChange={handleChange}
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Preço Médio de Compra (Calculado Automaticamente)
            </label>
            <input
              type="number"
              name="precoMedioCompra"
              value={formData.precoMedioCompra || ''}
              onChange={handleChange}
              step="0.01"
              placeholder="0.00"
              className="w-full bg-cyber-dark/50 border border-cyber-border/50 rounded-lg px-4 py-2 text-gray-400 font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
              disabled
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              VPA
            </label>
            <input
              type="number"
              name="vpa"
              value={formData.vpa || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              P/VPA
            </label>
            <input
              type="number"
              name="pVpa"
              value={formData.pVpa || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              LPA
            </label>
            <input
              type="number"
              name="lpa"
              value={formData.lpa || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Preço/Lucro
            </label>
            <input
              type="number"
              name="precoLucro"
              value={formData.precoLucro || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              ROE (%)
            </label>
            <input
              type="number"
              name="roe"
              value={formData.roe || ''}
              onChange={handleChange}
              step="0.01"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
              Meta de Papéis
            </label>
            <input
              type="number"
              name="metaPapeis"
              value={formData.metaPapeis || 0}
              onChange={handleChange}
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Preço Teto Reajustado */}
      <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-pink mb-4">Preço de Venda</h3>
        <div>
          <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
            Preço Teto Reajustado
          </label>
          <input
            type="number"
            name="precoTetoReajustado"
            value={formData.precoTetoReajustado || ''}
            onChange={handleChange}
            step="0.01"
            className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
          />
        </div>
      </div>

      {/* Observações */}
      <div>
        <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
          Observações
        </label>
        <textarea
          name="observacoes"
          value={formData.observacoes}
          onChange={handleChange}
          rows={3}
          className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
        />
      </div>

      {/* Botões */}
      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="cyber-button cyber-button-secondary"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="cyber-button cyber-button-primary disabled:opacity-50"
        >
          {loading ? 'Salvando...' : stock ? 'Atualizar' : 'Criar'}
        </button>
      </div>
    </form>
  );
}
