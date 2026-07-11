# 🚀 Modo Avançado de Treinamento - WR Trading Pro

## 📋 Visão Geral

O modo avançado de treinamento utiliza o script `train_xgboost_simple.py` para criar modelos de Machine Learning profissionais com todas as melhores práticas da indústria. Este modo está disponível exclusivamente para modelos de árvore: **Random Forest**, **XGBoost** e **LightGBM**.

## ✨ Funcionalidades Avançadas

### 1. Validação de Estacionariedade
- Teste ADF (Augmented Dickey-Fuller) para verificar se a série temporal é estacionária
- Diferenciação automática se necessário
- Garante que os dados atendam aos pressupostos dos modelos ML

### 2. Seleção Inteligente de Features
- Reduz de 146 para 40 features automaticamente
- Usa múltiplos métodos de seleção:
  - **Feature Importance** do modelo
  - **Mutual Information**
  - **Permutation Importance**
- Mantém apenas as features mais relevantes
- Reduz overfitting e tempo de treinamento

### 3. Prevenção de Data Leakage
- Normalização ROBUSTA APÓS o split
- Usa `RobustScaler` em vez de `StandardScaler`
- Evita contaminação dos dados de teste com estatísticas de treino
- Garante avaliação mais realista

### 4. Walk-Forward com Embargo
- Validação temporal estrita
- 500 candles de treino, 100 de teste
- Embargo de 50 candles entre folds
- Simula condições reais de trading

### 5. Comparação vs Baseline
- Compara o modelo com estratégias simples:
  - Buy & Hold
  - SMA Crossover
  - RSI Strategy
- Prova que o modelo agrega valor

### 6. Regularização L1/L2
- Penalização automática de features irrelevantes
- Evita overfitting
- Melhora generalização

### 7. Early Stopping
- Para treinamento automaticamente quando performance para de melhorar
- Economiza tempo
- Evita overfitting

### 8. Tuning com Optuna (Opcional)
- Otimização automática de hiperparâmetros
- Busca inteligente no espaço de parâmetros
- Encontra os melhores hiperparâmetros automaticamente

### 9. Ensemble de Modelos (Opcional)
- Combina múltiplos modelos em um
- Melhora estabilidade e performance
- Reduz variância das previsões

## 📖 Como Usar

### Via Linha de Comando

```bash
python run_ml_training.py \
  --symbol EURUSD \
  --timeframe H1 \
  --ml-algorithm xgboost \
  --use-advanced \
  --max-features 40
```

**Com Optuna (tuning automático):**

```bash
python run_ml_training.py \
  --symbol EURUSD \
  --timeframe H1 \
  --ml-algorithm xgboost \
  --use-advanced \
  --max-features 40 \
  --use-optuna \
  --n-trials 100
```

**Com Ensemble:**

```bash
python run_ml_training.py \
  --symbol EURUSD \
  --timeframe H1 \
  --ml-algorithm xgboost \
  --use-advanced \
  --max-features 40 \
  --use-ensemble
```

**Tudo junto (Máxima performance):**

```bash
python run_ml_training.py \
  --symbol EURUSD \
  --timeframe H1 \
  --ml-algorithm xgboost \
  --n-estimators 300 \
  --max-depth 8 \
  --learning-rate 0.05 \
  --use-advanced \
  --max-features 40 \
  --use-optuna \
  --n-trials 100 \
  --use-ensemble
```

### Via API (Frontend)

Envie uma requisição POST para `http://127.0.0.1:8767/api/ml/train`:

```json
{
  "symbol": "EURUSD",
  "timeframe": "H1",
  "model_type": "price_predictor",
  "ml_algorithm": "xgboost",
  "n_estimators": 300,
  "max_depth": 8,
  "learning_rate": 0.05,
  "use_advanced": true,
  "max_features": 40,
  "use_optuna": false,
  "n_trials": 100,
  "use_ensemble": false
}
```

**Exemplo cURL:**

```bash
curl -X POST http://127.0.0.1:8767/api/ml/train \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "timeframe": "H1",
    "model_type": "price_predictor",
    "ml_algorithm": "xgboost",
    "n_estimators": 300,
    "max_depth": 8,
    "learning_rate": 0.05,
    "use_advanced": true,
    "max_features": 40,
    "use_optuna": true,
    "n_trials": 100,
    "use_ensemble": true
  }'
```

## ⚙️ Parâmetros do Modo Avançado

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|---------|-----------|
| `--use-advanced` | Boolean | false | Ativa o modo avançado |
| `--max-features` | Int | 40 | Número máximo de features após seleção |
| `--use-optuna` | Boolean | false | Ativa tuning automático com Optuna |
| `--n-trials` | Int | 50 | Número de trials Optuna para buscar melhores parâmetros |
| `--use-ensemble` | Boolean | false | Cria ensemble de modelos |

## 📊 Comparação: Modo Padrão vs Avançado

| Característica | Modo Padrão | Modo Avançado |
|---------------|--------------|----------------|
| Features | 146 (todas) | 40 (selecionadas) |
| Data Leakage | Possível | Prevenido |
| Validação | Random split | Walk-Forward |
| Normalização | Antes do split | Depois do split |
| Regularização | Básica | L1/L2 |
| Early Stopping | Sim | Sim |
| Estacionariedade | Não testada | Testada e tratada |
| Comparação Baseline | Não | Sim |
| Tuning Hiperparâmetros | Manual | Automático (Optuna) |
| Ensemble | Não | Sim |

## 🎯 Quando Usar o Modo Avançado

### ✅ Use o Modo Avançado quando:
- Quer máxima performance do modelo
- Tem tempo para treinamento mais longo
- Quer resultados mais robustos
- Quer usar as melhores práticas da indústria
- Vamos usar o modelo em produção real

### ❌ Use o Modo Padrão quando:
- Quer um treinamento rápido
- Está testando/prototipando
- Não tem tempo para tuning
- Quer apenas verificar se o modelo funciona

## 📈 Exemplo de Output

```
================================================================================
🚀 MODO AVANÇADO ATIVADO
================================================================================

⚙️  Usando funcionalidades avançadas:
   ✅ Validação de estacionariedade
   ✅ Seleção inteligente de features (146 → 40)
   ✅ Normalização após split (data leakage prevention)
   ✅ Walk-Forward com embargo
   ✅ Comparação vs baseline
   ✅ Seleção de features com múltiplos métodos
   ✅ Regularização L1/L2
   ✅ Early stopping
   ✅ Tuning com Optuna (100 trials)
   ✅ Ensemble de modelos

📝 Redirecionando para train_xgboost_simple.py...
================================================================================
```

## 🔧 Requisitos

### Python Packages

```bash
pip install optuna scikit-learn xgboost lightgbm
```

### Para Optuna (opcional mas recomendado)

```bash
pip install optuna
```

## 💡 Dicas de Performance

### 1. Número de Features
- **40 features**: Bom equilíbrio entre performance e tempo
- **50 features**: Melhor performance, mais tempo
- **30 features**: Mais rápido, performance um pouco menor

### 2. Optuna Trials
- **50 trials**: Rápido, boa melhoria
- **100 trials**: Recomendado, melhor melhoria
- **200+ trials**: Máxima melhoria, muito tempo

### 3. Ensemble
- Use `--use-ensemble` para produção
- Cria 5 modelos e combina as previsões
- Aumenta estabilidade significativamente

## ⏱️ Tempos de Treinamento Estimados

| Configuração | H1 (5 anos) | H4 (5 anos) | D1 (5 anos) |
|--------------|---------------|--------------|--------------|
| Padrão | 2-5 min | 3-7 min | 5-10 min |
| Avançado | 5-15 min | 8-20 min | 12-25 min |
| Avançado + Optuna (50) | 15-30 min | 20-40 min | 30-50 min |
| Avançado + Optuna (100) | 30-60 min | 40-80 min | 60-100 min |
| Avançado + Optuna + Ensemble | 45-90 min | 60-120 min | 90-150 min |

## 🚨 Limitações

1. **Apenas modelos de árvore**: Random Forest, XGBoost, LightGBM
2. **Não funciona com LSTM**: LSTM usa abordagem diferente
3. **Não funciona com classificação de tendência**: Apenas price_predictor
4. **Requer mais tempo**: Treinamento é mais longo
5. **Requer mais memória**: Para Optuna e Ensemble

## 📚 Referências

- [XGBoost Documentation](https://xgboost.readthedocs.io/)
- [LightGBM Documentation](https://lightgbm.readthedocs.io/)
- [Optuna Documentation](https://optuna.readthedocs.io/)
- [Scikit-learn Feature Selection](https://scikit-learn.org/stable/modules/feature_selection.html)

## 🆘 Troubleshooting

### Optuna não está funcionando
```bash
# Instalar Optuna
pip install optuna
```

### Erro de memória no Ensemble
```bash
# Reduza o número de modelos no ensemble
# Edite train_xgboost_simple.py e reduza n_ensemble_models
```

### Treinamento muito lento
```bash
# Reduza o número de trials Optuna
python run_ml_training.py --use-advanced --use-optuna --n-trials 20
```

## 📞 Suporte

Se tiver dúvidas ou problemas:
1. Verifique o arquivo `train_xgboost_simple.py` para detalhes da implementação
2. Consulte os logs de treinamento
3. Revise a documentação dos pacotes usados

---

**Desenvolvido para WR Trading Pro** 🚀
