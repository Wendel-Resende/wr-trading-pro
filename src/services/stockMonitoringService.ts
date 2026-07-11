import { PrismaClient } from '@prisma/client';
import { StockMonitoring, StockMonitoringInput, StockMonitoringUpdate, DividendMap, DividendMapInput } from '@/types/stock-monitoring';

const prisma = new PrismaClient();

export class StockMonitoringService {
  
  // ===== CRUD =====

  /**
   * Listar todos os monitoramentos de ações
   */
  async getAll(): Promise<StockMonitoring[]> {
    const stocks = await prisma.stockMonitoring.findMany({
      include: {
        asset: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
    return stocks as StockMonitoring[];
  }

  /**
   * Buscar monitoramento por ID
   */
  async getById(id: string): Promise<StockMonitoring | null> {
    const stock = await prisma.stockMonitoring.findUnique({
      where: { id },
      include: {
        asset: true,
      },
    });
    return stock as StockMonitoring | null;
  }

  /**
   * Buscar monitoramento por assetId
   */
  async getByAssetId(assetId: string): Promise<StockMonitoring | null> {
    const stock = await prisma.stockMonitoring.findFirst({
      where: { assetId },
      include: {
        asset: true,
      },
    });
    return stock as StockMonitoring | null;
  }

  /**
   * Criar novo monitoramento de ação
   */
  async create(input: StockMonitoringInput): Promise<StockMonitoring> {
    const stock = await prisma.stockMonitoring.create({
      data: {
        ...input,
        metaPapeis: input.metaPapeis ?? 0,
        composition: input.composition ?? 1,
      },
      include: {
        asset: true,
      },
    });

    // Atualizar status inicial
    await this.updateStatus(stock.id);

    return stock as StockMonitoring;
  }

  /**
   * Atualizar monitoramento existente
   */
  async update(id: string, data: StockMonitoringUpdate): Promise<StockMonitoring> {
    const stock = await prisma.stockMonitoring.update({
      where: { id },
      data,
      include: {
        asset: true,
      },
    });

    // Recalcular métricas dependentes
    await this.updateCalculations(id);

    // Atualizar status
    await this.updateStatus(id);

    return stock as StockMonitoring;
  }

  /**
   * Deletar monitoramento
   */
  async delete(id: string): Promise<void> {
    await prisma.stockMonitoring.delete({
      where: { id },
    });
  }

  // ===== CÁLCULOS =====

  /**
   * Calcular Preço Teto
   * Fórmula: DY MÉDIA 3 ANOS / 0,08
   */
  calcularPrecoTeto(dyMedia3Anos: number): number {
    if (!dyMedia3Anos || dyMedia3Anos === 0) return 0;
    return dyMedia3Anos / 0.08;
  }

  /**
   * Calcular Preço Teto Reajustado
   * Fórmula:
   * - Se VPA >= Preço Teto: (VPA - Preço Teto) / 2 + Preço Teto
   * - Se VPA < Preço Teto: 0
   */
  calcularPrecoTetoReajustado(vpa: number, precoTeto: number): number {
    if (!vpa || !precoTeto || precoTeto === 0) return 0;
    
    if (vpa >= precoTeto) {
      return (vpa - precoTeto) / 2 + precoTeto;
    }
    
    return 0;
  }

  /**
   * Calcular Preço Médio de Compra
   * Fórmula: Valor Investido / Quantidade de Ações
   */
  calcularPrecoMedioCompra(valorInvestido: number, quantidade: number): number {
    if (!quantidade || quantidade === 0) return 0;
    return valorInvestido / quantidade;
  }

  /**
   * Calcular Investimento Necessário para Meta
   * Fórmula: (Meta Papeis - Quant. Adquirida) × Preço Teto
   */
  calcularInvestimentoNecessarioParaMeta(metaPapeis: number, quantidadeAdquirida: number, precoTeto: number): number {
    if (!metaPapeis || !quantidadeAdquirida || !precoTeto || precoTeto === 0) return 0;
    const diferenca = metaPapeis - quantidadeAdquirida;
    return diferenca * precoTeto;
  }

  /**
   * Calcular Yield on Cost
   * Fórmula: (Dividendo Anual / Valor Investido) * 100
   */
  calcularYieldOnCost(dividendoAnual: number, valorInvestido: number): number {
    if (!valorInvestido || valorInvestido === 0) return 0;
    return (dividendoAnual / valorInvestido) * 100;
  }

  /**
   * Calcular Participação na Carteira
   * Fórmula: (Valor da Posição / Valor Total da Carteira) * 100
   */
  calcularParticipacaoCarteira(valorPosicao: number, valorCarteiraTotal: number): number {
    if (!valorCarteiraTotal || valorCarteiraTotal === 0) return 0;
    return (valorPosicao / valorCarteiraTotal) * 100;
  }

  /**
   * Calcular VPA (Valor Patrimonial por Ação)
   * Fórmula: Patrimônio Líquido / Ações Emitidas
   */
  calcularVPA(patrimonioLiquido: number, acoesEmitidas: bigint): number {
    if (!patrimonioLiquido || !acoesEmitidas || acoesEmitidas === BigInt(0)) return 0;
    const acoesNum = Number(acoesEmitidas);
    if (acoesNum === 0) return 0;
    return patrimonioLiquido / acoesNum;
  }

  /**
   * Calcular LPA (Lucro por Ação)
   * Fórmula: Lucro Líquido / Ações Emitidas
   */
  calcularLPA(lucroLiquido: number, acoesEmitidas: bigint): number {
    if (!lucroLiquido || !acoesEmitidas || acoesEmitidas === BigInt(0)) return 0;
    const acoesNum = Number(acoesEmitidas);
    if (acoesNum === 0) return 0;
    return lucroLiquido / acoesNum;
  }

  /**
   * Calcular P/VPA (Preço sobre Valor Patrimonial)
   * Fórmula: Preço Atual / VPA
   */
  calcularPVPA(precoAtual: number, vpa: number): number {
    if (!precoAtual || !vpa || vpa === 0) return 0;
    return precoAtual / vpa;
  }

  /**
   * Calcular P/L (Preço sobre Lucro)
   * Fórmula: Preço Atual / LPA
   */
  calcularPL(precoAtual: number, lpa: number): number {
    if (!precoAtual || !lpa || lpa === 0) return 0;
    return precoAtual / lpa;
  }

  /**
   * Calcular ROE (Return on Equity)
   * Fórmula: Lucro Líquido / Patrimônio Líquido
   */
  calcularROE(lucroLiquido: number, patrimonioLiquido: number): number {
    if (!lucroLiquido || !patrimonioLiquido || patrimonioLiquido === 0) return 0;
    return (lucroLiquido / patrimonioLiquido) * 100; // Retorna em porcentagem
  }

  /**
   * Atualizar todos os cálculos de um monitoramento
   */
  async updateCalculations(id: string): Promise<void> {
    const stock = await prisma.stockMonitoring.findUnique({
      where: { id },
    });

    if (!stock) return;

    const updates: any = {};

    // PRIMEIRO: Calcular indicadores base (VPA, LPA, ROE)
    // Calcular VPA se tiver patrimônio líquido e ações emitidas
    if (stock.patrimonioLiquido && stock.acoesEmitidas) {
      updates.vpa = this.calcularVPA(stock.patrimonioLiquido, stock.acoesEmitidas);
    }

    // Calcular LPA se tiver lucro líquido e ações emitidas
    if (stock.lucroLiquido && stock.acoesEmitidas) {
      updates.lpa = this.calcularLPA(stock.lucroLiquido, stock.acoesEmitidas);
    }

    // Calcular ROE se tiver lucro líquido e patrimônio líquido
    if (stock.lucroLiquido && stock.patrimonioLiquido) {
      updates.roe = this.calcularROE(stock.lucroLiquido, stock.patrimonioLiquido);
    }

    // SEGUNDO: Calcular Preço Teto
    // Calcular Preço Teto se tiver DY Médio 3 Anos
    if (stock.dyMedia3Anos) {
      updates.precoTeto = this.calcularPrecoTeto(stock.dyMedia3Anos);
    }

    // TERCEIRO: Calcular Preço Teto Reajustado (depende de VPA e Preço Teto)
    // Verificar VPA atualizado ou existente no banco
    const vpaAtual = updates.vpa || stock.vpa;
    const precoTetoAtual = updates.precoTeto || stock.precoTeto;
    
    if (vpaAtual && precoTetoAtual) {
      updates.precoTetoReajustado = this.calcularPrecoTetoReajustado(vpaAtual, precoTetoAtual);
    }

    // QUARTO: Calcular Preço Médio de Compra
    // Calcular Preço Médio de Compra se tiver Valor Investido e Quantidade
    if (stock.valorInvestido && stock.quantidadeAdquirida) {
      updates.precoMedioCompra = this.calcularPrecoMedioCompra(stock.valorInvestido, stock.quantidadeAdquirida);
    }

    // Calcular Investimento Necessário para Meta se tiver Meta, Quantidade e Preço Teto
    const precoTetoParaMeta = updates.precoTeto || stock.precoTeto;
    if (stock.metaPapeis && stock.quantidadeAdquirida && precoTetoParaMeta) {
      updates.investimentoNecessarioParaMeta = this.calcularInvestimentoNecessarioParaMeta(
        stock.metaPapeis,
        stock.quantidadeAdquirida,
        precoTetoParaMeta
      );
    }

    // QUINTO: Calcular Yield on Cost
    // Calcular Yield on Cost se tiver previsão de dividendo e valor investido
    if (stock.previsaoDividendoAnual && stock.valorInvestido) {
      updates.yieldOnCost = this.calcularYieldOnCost(
        stock.previsaoDividendoAnual,
        stock.valorInvestido
      );
    }

    // SEXTO: Calcular P/VPA e P/L (dependem de preço atual)
    // Calcular P/VPA se tiver preço atual e VPA
    const vpaParaPVPA = updates.vpa || stock.vpa;
    if (stock.precoAtual && vpaParaPVPA) {
      updates.pVpa = this.calcularPVPA(stock.precoAtual, vpaParaPVPA);
    }

    // Calcular P/L se tiver preço atual e LPA
    const lpaParaPL = updates.lpa || stock.lpa;
    if (stock.precoAtual && lpaParaPL) {
      updates.precoLucro = this.calcularPL(stock.precoAtual, lpaParaPL);
    }

    // Atualizar valor da carteira se tiver preço atual e quantidade
    if (stock.precoAtual && stock.quantidadeAdquirida) {
      updates.valorCarteira = stock.precoAtual * stock.quantidadeAdquirida;
      
      // Calcular resultado se tiver preço médio
      if (stock.precoMedioCompra) {
        const valorTotalAtual = updates.valorCarteira;
        const valorTotalCompra = stock.precoMedioCompra * stock.quantidadeAdquirida;
        updates.resultado = valorTotalAtual - valorTotalCompra;
      }
    }

    // Atualizar se houver mudanças
    if (Object.keys(updates).length > 0) {
      await prisma.stockMonitoring.update({
        where: { id },
        data: updates,
      });
    }
  }

  /**
   * Atualizar status do monitoramento baseado nos gatilhos
   */
  async updateStatus(id: string): Promise<void> {
    const stock = await prisma.stockMonitoring.findUnique({
      where: { id },
    });

    if (!stock) return;

    let status: 'COMPRA' | 'VENDA' | 'NEUTRO' | 'ATENCAO' = 'NEUTRO';

    // Lógica de determinação de status
    if (!stock.precoAtual) {
      status = 'ATENCAO';
    } else if (stock.precoTeto && stock.precoAtual <= stock.precoTeto) {
      status = 'COMPRA';
    } else if (stock.precoTetoReajustado && stock.precoAtual > stock.precoTetoReajustado) {
      status = 'VENDA';
    }

    // Verificar gatilhos de ROE
    if (stock.roe !== null && stock.roe !== undefined && stock.gatilhoROE) {
      if (stock.roe < stock.gatilhoROE) {
        status = 'ATENCAO';
      }
    }

    // Verificar gatilhos de VPA
    if (stock.vpa !== null && stock.vpa !== undefined && stock.gatilhoVPA) {
      if (stock.vpa > stock.gatilhoVPA) {
        status = 'ATENCAO';
      }
    }

    // Verificar gatilhos de LPA
    if (stock.lpa !== null && stock.lpa !== undefined && stock.gatilhoLPA) {
      if (stock.lpa < stock.gatilhoLPA) {
        status = 'ATENCAO';
      }
    }

    await prisma.stockMonitoring.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Atualizar preço atual e recalcular métricas
   */
  async updatePrecoAtual(id: string, precoAtual: number): Promise<StockMonitoring> {
    await prisma.stockMonitoring.update({
      where: { id },
      data: { precoAtual },
    });

    await this.updateCalculations(id);
    await this.updateStatus(id);

    const stock = await prisma.stockMonitoring.findUnique({
      where: { id },
      include: { asset: true },
    });

    return stock as StockMonitoring;
  }

  /**
   * Atualizar dados de posição do MT5
   */
  async updatePosicao(
    id: string,
    quantidade: number,
    precoMedio: number
  ): Promise<StockMonitoring> {
    const stock = await prisma.stockMonitoring.findUnique({
      where: { id },
    });

    if (!stock) throw new Error('Stock monitoring not found');

    const valorInvestido = quantidade * precoMedio;

    await prisma.stockMonitoring.update({
      where: { id },
      data: {
        quantidadeAdquirida: quantidade,
        precoMedioCompra: precoMedio,
        valorInvestido,
      },
    });

    await this.updateCalculations(id);

    const updated = await prisma.stockMonitoring.findUnique({
      where: { id },
      include: { asset: true },
    });

    return updated as StockMonitoring;
  }

  /**
   * Calcular participações na carteira para todas as ações
   */
  async calcularTodasParticipacoes(): Promise<void> {
    const stocks = await prisma.stockMonitoring.findMany({
      where: {
        valorCarteira: {
          not: null,
        },
      },
    });

    const valorTotalCarteira = stocks.reduce((sum, stock) => 
      sum + (stock.valorCarteira || 0), 0
    );

    if (valorTotalCarteira === 0) return;

    for (const stock of stocks) {
      const participacao = this.calcularParticipacaoCarteira(
        stock.valorCarteira || 0,
        valorTotalCarteira
      );

      await prisma.stockMonitoring.update({
        where: { id: stock.id },
        data: { participacaoCarteira: participacao },
      });
    }
  }

  // ===== MAPA DE DIVIDENDOS =====

  /**
   * Criar mapa de dividendos
   */
  async createDividendMap(input: DividendMapInput): Promise<DividendMap> {
    const total = (input.jan || 0) + (input.fev || 0) + (input.mar || 0) +
                  (input.abr || 0) + (input.mai || 0) + (input.jun || 0) +
                  (input.jul || 0) + (input.ago || 0) + (input.set || 0) +
                  (input.out || 0) + (input.nov || 0) + (input.dez || 0);

    const dividendMap = await prisma.dividendMap.create({
      data: {
        ...input,
        total,
      },
      include: {
        stock: {
          include: {
            asset: true,
          },
        },
      },
    });

    // Atualizar previsão de dividendo anual no monitoramento
    await prisma.stockMonitoring.update({
      where: { id: input.stockId },
      data: { previsaoDividendoAnual: total },
    });

    return dividendMap as DividendMap;
  }

  /**
   * Buscar mapa de dividendos por stockId e ano
   */
  async getDividendMap(stockId: string, ano: number): Promise<DividendMap | null> {
    const dividendMap = await prisma.dividendMap.findUnique({
      where: {
        stockId_ano: {
          stockId,
          ano,
        },
      },
      include: {
        stock: {
          include: {
            asset: true,
          },
        },
      },
    });

    return dividendMap as DividendMap | null;
  }

  /**
   * Listar todos os mapas de dividendos de um stock
   */
  async getDividendMapsByStock(stockId: string): Promise<DividendMap[]> {
    const dividendMaps = await prisma.dividendMap.findMany({
      where: { stockId },
      orderBy: {
        ano: 'desc',
      },
      include: {
        stock: {
          include: {
            asset: true,
          },
        },
      },
    });

    return dividendMaps as DividendMap[];
  }

  /**
   * Atualizar mapa de dividendos
   */
  async updateDividendMap(
    id: string,
    data: Partial<DividendMapInput>
  ): Promise<DividendMap> {
    const total = (data.jan || 0) + (data.fev || 0) + (data.mar || 0) +
                  (data.abr || 0) + (data.mai || 0) + (data.jun || 0) +
                  (data.jul || 0) + (data.ago || 0) + (data.set || 0) +
                  (data.out || 0) + (data.nov || 0) + (data.dez || 0);

    const dividendMap = await prisma.dividendMap.update({
      where: { id },
      data: {
        ...data,
        total,
      },
      include: {
        stock: {
          include: {
            asset: true,
          },
        },
      },
    });

    // Atualizar previsão de dividendo anual no monitoramento
    if (dividendMap.stockId) {
      await prisma.stockMonitoring.update({
        where: { id: dividendMap.stockId },
        data: { previsaoDividendoAnual: total },
      });
    }

    return dividendMap as DividendMap;
  }

  /**
   * Deletar mapa de dividendos
   */
  async deleteDividendMap(id: string): Promise<void> {
    await prisma.dividendMap.delete({
      where: { id },
    });
  }

  // ===== RELATÓRIOS =====

  /**
   * Obter resumo da carteira de ações
   */
  async getCarteiraResumo() {
    const stocks = await prisma.stockMonitoring.findMany({
      include: {
        asset: true,
      },
    });

    const totalInvestido = stocks.reduce((sum, s) => sum + (s.valorInvestido || 0), 0);
    const valorAtual = stocks.reduce((sum, s) => sum + (s.valorCarteira || 0), 0);
    const resultadoTotal = stocks.reduce((sum, s) => sum + s.resultado, 0);
    const dividendosAnuais = stocks.reduce((sum, s) => sum + (s.previsaoDividendoAnual || 0), 0);

    return {
      totalAcoes: stocks.length,
      totalInvestido,
      valorAtual,
      resultadoTotal,
      dividendosAnuais,
      yieldCarteira: totalInvestido > 0 ? (dividendosAnuais / totalInvestido) * 100 : 0,
    };
  }

  /**
   * Buscar ações por status
   */
  async getByStatus(status: 'COMPRA' | 'VENDA' | 'NEUTRO' | 'ATENCAO'): Promise<StockMonitoring[]> {
    const stocks = await prisma.stockMonitoring.findMany({
      where: { status },
      include: {
        asset: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return stocks as StockMonitoring[];
  }

  // ===== ALERTAS =====

  /**
   * Criar alerta de ação
   */
  async createAlert(data: {
    stockId: string;
    type: 'PRICE' | 'DIVIDEND' | 'STATUS' | 'PORTFOLIO';
    condition: 'above' | 'below' | 'equals' | 'changed_to';
    value?: number;
    targetValue?: number;
    message: string;
    severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  }) {
    return prisma.stockAlert.create({
      data: {
        stockId: data.stockId,
        type: data.type,
        condition: data.condition,
        value: data.value,
        targetValue: data.targetValue,
        message: data.message,
        severity: data.severity || 'INFO',
      },
      include: {
        stock: {
          include: {
            asset: true,
          },
        },
      },
    });
  }

  /**
   * Buscar alertas por stockId
   */
  async getAlertsByStock(stockId: string) {
    return prisma.stockAlert.findMany({
      where: { stockId },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        stock: {
          include: {
            asset: true,
          },
        },
      },
    });
  }

  /**
   * Buscar todos os alertas
   */
  async getAllAlerts(options?: {
    unreadOnly?: boolean;
    type?: 'PRICE' | 'DIVIDEND' | 'STATUS' | 'PORTFOLIO';
    severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  }) {
    const where: any = {};

    if (options?.unreadOnly) {
      where.isRead = false;
    }

    if (options?.type) {
      where.type = options.type;
    }

    if (options?.severity) {
      where.severity = options.severity;
    }

    return prisma.stockAlert.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        stock: {
          include: {
            asset: true,
          },
        },
      },
    });
  }

  /**
   * Marcar alerta como lido
   */
  async markAlertAsRead(id: string) {
    return prisma.stockAlert.update({
      where: { id },
      data: { isRead: true },
    });
  }

  /**
   * Marcar todos os alertas como lidos
   */
  async markAllAlertsAsRead() {
    return prisma.stockAlert.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });
  }

  /**
   * Atualizar alerta
   */
  async updateAlert(id: string, data: {
    isActive?: boolean;
    isRead?: boolean;
    triggeredAt?: Date;
  }) {
    return prisma.stockAlert.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletar alerta
   */
  async deleteAlert(id: string) {
    return prisma.stockAlert.delete({
      where: { id },
    });
  }

  /**
   * Verificar alertas de preço
   * Chamado quando o preço de uma ação é atualizado
   */
  async checkPriceAlerts(stockId: string, currentPrice: number) {
    const alerts = await prisma.stockAlert.findMany({
      where: {
        stockId,
        type: 'PRICE',
        isActive: true,
        isRead: false,
      },
    });

    const triggeredAlerts = [];

    for (const alert of alerts) {
      let shouldTrigger = false;

      if (alert.condition === 'above' && alert.targetValue && currentPrice > alert.targetValue) {
        shouldTrigger = true;
      } else if (alert.condition === 'below' && alert.targetValue && currentPrice < alert.targetValue) {
        shouldTrigger = true;
      } else if (alert.condition === 'equals' && alert.targetValue && currentPrice === alert.targetValue) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        await prisma.stockAlert.update({
          where: { id: alert.id },
          data: {
            isRead: false,
            triggeredAt: new Date(),
            isActive: false, // Desativar alerta de uma vez
          },
        });
        triggeredAlerts.push(alert);
      }
    }

    return triggeredAlerts;
  }

  /**
   * Verificar alertas de status
   * Chamado quando o status de uma ação muda
   */
  async checkStatusAlerts(stockId: string, newStatus: string) {
    const alerts = await prisma.stockAlert.findMany({
      where: {
        stockId,
        type: 'STATUS',
        condition: 'changed_to',
        value: newStatus === 'COMPRA' ? 1 : newStatus === 'VENDA' ? 2 : newStatus === 'ATENCAO' ? 3 : 0,
        isActive: true,
        isRead: false,
      },
    });

    const triggeredAlerts = [];

    for (const alert of alerts) {
      await prisma.stockAlert.update({
        where: { id: alert.id },
        data: {
          isRead: false,
          triggeredAt: new Date(),
          isActive: false,
        },
      });
      triggeredAlerts.push(alert);
    }

    return triggeredAlerts;
  }

  /**
   * Obter resumo de alertas
   */
  async getAlertSummary() {
    const [total, unread, critical, warning, info, recent] = await Promise.all([
      prisma.stockAlert.count(),
      prisma.stockAlert.count({ where: { isRead: false } }),
      prisma.stockAlert.count({ where: { severity: 'CRITICAL', isRead: false } }),
      prisma.stockAlert.count({ where: { severity: 'WARNING', isRead: false } }),
      prisma.stockAlert.count({ where: { severity: 'INFO', isRead: false } }),
      prisma.stockAlert.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          stock: {
            include: {
              asset: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      unread,
      critical,
      warning,
      info,
      recent,
    };
  }

  // ===== RELATÓRIOS =====

  /**
   * Criar relatório
   */
  async createReport(data: {
    name: string;
    type: 'PORTFOLIO' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATUS';
    startDate: Date;
    endDate: Date;
    data: any;
    generatedBy?: string;
  }) {
    return prisma.stockReport.create({
      data: {
        name: data.name,
        type: data.type,
        startDate: data.startDate,
        endDate: data.endDate,
        data: JSON.stringify(data.data),
        generatedBy: data.generatedBy || 'Sistema',
      },
    });
  }

  /**
   * Buscar relatório por ID
   */
  async getReportById(id: string) {
    const report = await prisma.stockReport.findUnique({
      where: { id },
    });

    if (report) {
      return {
        ...report,
        data: JSON.parse(report.data),
      };
    }

    return null;
  }

  /**
   * Listar relatórios
   */
  async getReports(options?: {
    type?: 'PORTFOLIO' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATUS';
  }) {
    const where: any = {};

    if (options?.type) {
      where.type = options.type;
    }

    const reports = await prisma.stockReport.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return reports.map(report => ({
      ...report,
      data: JSON.parse(report.data),
    }));
  }

  /**
   * Deletar relatório
   */
  async deleteReport(id: string) {
    return prisma.stockReport.delete({
      where: { id },
    });
  }

  /**
   * Gerar relatório de carteira
   */
  async generatePortfolioReport() {
    const stocks = await prisma.stockMonitoring.findMany({
      include: {
        asset: true,
        dividendMaps: true,
      },
    });

    const totalValue = stocks.reduce((sum, s) => sum + (s.valorCarteira || 0), 0);
    const totalInvested = stocks.reduce((sum, s) => sum + (s.valorInvestido || 0), 0);
    const totalProfit = stocks.reduce((sum, s) => sum + s.resultado, 0);

    // Top performers
    const topPerformers = stocks
      .filter(s => s.resultado > 0)
      .sort((a, b) => b.resultado - a.resultado)
      .slice(0, 5)
      .map(s => ({
        symbol: s.asset.symbol,
        profit: s.resultado,
        profitPercentage: s.valorInvestido ? (s.resultado / s.valorInvestido) * 100 : 0,
      }));

    // Worst performers
    const worstPerformers = stocks
      .filter(s => s.resultado < 0)
      .sort((a, b) => a.resultado - b.resultado)
      .slice(0, 5)
      .map(s => ({
        symbol: s.asset.symbol,
        profit: s.resultado,
        profitPercentage: s.valorInvestido ? (s.resultado / s.valorInvestido) * 100 : 0,
      }));

    // Diversificação por ação
    const byStock = stocks.map(s => ({
      symbol: s.asset.symbol,
      value: s.valorCarteira || 0,
      percentage: totalValue > 0 ? ((s.valorCarteira || 0) / totalValue) * 100 : 0,
    })).sort((a, b) => b.value - a.value);

    return {
      totalValue,
      totalInvested,
      totalProfit,
      totalProfitPercentage: totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0,
      stockCount: stocks.length,
      diversification: {
        bySector: {},
        byStock,
      },
      topPerformers,
      worstPerformers,
    };
  }

  /**
   * Gerar relatório de dividendos
   */
  async generateDividendReport() {
    const stocks = await prisma.stockMonitoring.findMany({
      where: {
        previsaoDividendoAnual: {
          not: null,
        },
      },
      include: {
        asset: true,
        dividendMaps: {
          where: {
            ano: new Date().getFullYear(),
          },
        },
      },
    });

    const totalReceived = 0; // Aqui seria calculado com histórico real
    const projectedAnnual = stocks.reduce((sum, s) => sum + (s.previsaoDividendoAnual || 0), 0);
    const totalInvested = stocks.reduce((sum, s) => sum + (s.valorInvestido || 0), 0);

    const byStock = stocks.map(s => ({
      symbol: s.asset.symbol,
      totalReceived: 0,
      projected: s.previsaoDividendoAnual || 0,
      yield: s.valorInvestido ? ((s.previsaoDividendoAnual || 0) / s.valorInvestido) * 100 : 0,
    }));

    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const monthKeys = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
      
      return {
        month: monthNames[i],
        total: stocks.reduce((sum, s) => {
          const map = s.dividendMaps[0];
          if (map) {
            const monthKey = monthKeys[i];
            return sum + (map[monthKey] as number || 0);
          }
          return sum;
        }, 0),
      };
    });

    return {
      totalReceived,
      projectedAnnual,
      dividendYield: totalInvested > 0 ? (projectedAnnual / totalInvested) * 100 : 0,
      yieldOnCost: 0, // Seria calculado com custo médio
      byStock,
      byMonth,
      dividendMap: {},
    };
  }

  /**
   * Gerar relatório de status
   */
  async generateStatusReport() {
    const stocks = await prisma.stockMonitoring.findMany({
      include: {
        asset: true,
      },
    });

    const totalStocks = stocks.length;
    const buySignals = stocks.filter(s => s.status === 'COMPRA').length;
    const sellSignals = stocks.filter(s => s.status === 'VENDA').length;
    const neutral = stocks.filter(s => s.status === 'NEUTRO').length;
    const attention = stocks.filter(s => s.status === 'ATENCAO').length;

    const byStatus = ['COMPRA', 'VENDA', 'NEUTRO', 'ATENCAO'].map(status => ({
      status,
      count: stocks.filter(s => s.status === status).length,
      percentage: totalStocks > 0 ? (stocks.filter(s => s.status === status).length / totalStocks) * 100 : 0,
      stocks: stocks
        .filter(s => s.status === status)
        .map(s => ({
          symbol: s.asset.symbol,
          name: s.asset.name,
          currentPrice: s.precoAtual || 0,
          recommendation: s.status,
        })),
    }));

    const [critical, warning, info] = await Promise.all([
      prisma.stockAlert.count({ where: { severity: 'CRITICAL', isRead: false } }),
      prisma.stockAlert.count({ where: { severity: 'WARNING', isRead: false } }),
      prisma.stockAlert.count({ where: { severity: 'INFO', isRead: false } }),
    ]);

    return {
      totalStocks,
      buySignals,
      sellSignals,
      neutral,
      attention,
      byStatus,
      alertCount: {
        critical,
        warning,
        info,
      },
    };
  }
}

// Singleton
let stockMonitoringServiceInstance: StockMonitoringService | null = null;

export const StockMonitoringServiceSingleton = {
  getInstance: (): StockMonitoringService => {
    if (!stockMonitoringServiceInstance) {
      stockMonitoringServiceInstance = new StockMonitoringService();
    }
    return stockMonitoringServiceInstance;
  },
};
