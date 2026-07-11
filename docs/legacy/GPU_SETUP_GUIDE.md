# 🎮 Guia de Configuração de GPU para TensorFlow

## 📊 Status Atual

✅ **GPU Detectada**: NVIDIA GeForce RTX 4060  
✅ **Driver NVIDIA**: Versão 591.59  
✅ **CUDA Support**: CUDA 13.1  
❌ **TensorFlow GPU**: Não detectada

## 🔧 Problema

O TensorFlow 2.20.0 instalado não tem suporte a CUDA/GPU. O TensorFlow requer a versão correta do CUDA Toolkit para funcionar.

## 💡 Soluções

### Solução 1: Usar TensorFlow 2.20.0 com CUDA Manual (Recomendado)

Como o TensorFlow 2.20.0 já está instalado, você precisa instalar o CUDA Toolkit e cuDNN manualmente:

**Passo 1: Baixar e Instalar CUDA Toolkit 12.4**

1. Acesse: https://developer.nvidia.com/cuda-downloads
2. Selecione:
   - Operating System: Windows
   - Architecture: x86_64
   - Version: 11
   - Installer Type: exe (local)
3. Baixe e instale o CUDA Toolkit 12.4

**Passo 2: Baixar e Instalar cuDNN 9.0**

1. Acesse: https://developer.nvidia.com/cudnn
2. Faça login ou cadastro gratuito
3. Baixe o cuDNN para CUDA 12.x (versão 9.0 ou compatível)
4. Extraia os arquivos e copie para a pasta CUDA (geralmente `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4`):
   - Copie `bin/*` para `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin\`
   - Copie `include/*` para `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\include\`
   - Copie `lib/*` para `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\lib\`

**Passo 3: Adicionar ao PATH do Windows**

1. Pressione `Win + R`, digite `sysdm.cpl` e Enter
2. Aba "Avançado" > "Variáveis de Ambiente"
3. Em "Variáveis do Sistema", edite `Path` e adicione:
   - `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin`
   - `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\libnvvp`

**Passo 4: Reiniciar e Testar**

```bash
# Reinicie o terminal/PowerShell
deactivate
conda activate IA_Day_Trading
python check_gpu.py
```

### Solução 2: Usar TensorFlow com DirectML (Alternativa - Mais Simples)

O DirectML é uma API da Microsoft que permite usar a GPU NVIDIA sem precisar instalar CUDA completo. É mais simples mas pode ser um pouco mais lento que CUDA.

**Passo 1: Instalar o pacote TensorFlow-DirectML**

```bash
pip uninstall tensorflow -y
pip install tensorflow-directml
```

**Passo 2: Testar a GPU**

Crie um script de teste `test_directml.py`:

```python
import tensorflow as tf

# Verificar se DirectML está disponível
print("TensorFlow versão:", tf.__version__)
print("Dispositivos:", tf.config.list_physical_devices())

# Forçar uso de GPU se disponível
try:
    # DirectML automaticamente usará a GPU se disponível
    a = tf.random.normal([1000, 1000])
    b = tf.random.normal([1000, 1000])
    c = tf.matmul(a, b)
    print("✅ GPU DirectML funcionando!")
except Exception as e:
    print("❌ Erro:", e)
```

Execute:
```bash
python test_directml.py
```

**Vantagens do DirectML:**
- ✅ Não precisa instalar CUDA Toolkit
- ✅ Não precisa configurar variáveis de ambiente
- ✅ Funciona com sua RTX 4060
- ⚠️  Pode ser 20-30% mais lento que CUDA

**Desvantagens:**
- ⚠️  Menos documentação e suporte
- ⚠️  Alguns recursos avançados podem não funcionar

### Solução 3: Continuar com CPU (Opção mais simples)

Se você não quiser configurar GPU agora, o sistema ML funciona perfeitamente com CPU. O treinamento será mais lento mas funcional.

**Para otimizar o desempenho em CPU:**

```python
import os
# Otimizar para CPU (já está configurado no seu TensorFlow)
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '1'
```

**Tempo estimado de treinamento com CPU:**
- Modelo LSTM simples: 5-10 minutos
- Modelo LSTM complexo: 20-30 minutos
- Ainda viável para desenvolvimento e testes

## 🧪 Após a Configuração

Execute o script de verificação novamente:

```bash
python check_gpu.py
```

Você deverá ver algo como:

```
✅ GPU detectada!
   Dispositivo: /physical_device:GPU:0
   Tipo: GPU
   Memória growth: HABILITADO

💡 TensorFlow está configurado para usar a GPU!
```

## 🚀 Benefícios da GPU

Com a GPU habilitada, o treinamento de modelos será:

- **10-50x mais rápido** para treinamento de redes neurais
- **Processamento paralelo** de batches
- **Capacidade de usar modelos maiores** com mais camadas

### Comparação de Desempenho

| Operação | CPU | GPU (RTX 4060) | Speedup |
|----------|-----|----------------|---------|
| LSTM (100 épocas) | ~15 min | ~30 seg | 30x |
| Forward pass | ~500 ms | ~10 ms | 50x |
| Backpropagation | ~800 ms | ~20 ms | 40x |

## ⚙️ Configuração Adicional (Opcional)

Para otimizar ainda mais o uso da GPU, adicione ao início dos seus scripts:

```python
import tensorflow as tf

# Configurar memória da GPU (cresce conforme necessário)
gpus = tf.config.list_physical_devices('GPU')
if gpus:
    try:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
    except RuntimeError as e:
        print(e)

# Desativar avisos do oneDNN (opcional)
import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
```

## 🔍 Troubleshooting

### TensorFlow ainda não detecta a GPU

1. **Verificar versões instaladas**:
   ```bash
   pip show tensorflow
   nvidia-smi
   ```

2. **Verificar variáveis de ambiente**:
   ```bash
   echo %CUDA_PATH%
   echo %PATH%
   ```

3. **Reiniciar o ambiente virtual**:
   ```bash
   deactivate
   conda activate IA_Day_Trading
   ```

### Erro "CUDA out of memory"

Soluções:
- Reduzir o batch size no treinamento
- Limpar memória GPU antes de treinar:
  ```python
  import tensorflow as tf
  tf.keras.backend.clear_session()
  ```

### Erro "Could not load dynamic library"

Verifique se o CUDA está instalado no PATH do sistema.

## 📚 Recursos Adicionais

- [Documentação TensorFlow GPU](https://www.tensorflow.org/install/pip#windows_wsl_2)
- [CUDA Toolkit Download](https://developer.nvidia.com/cuda-downloads)
- [cuDNN Download](https://developer.nvidia.com/cudnn)
- [Compatibilidade TensorFlow-CUDA](https://www.tensorflow.org/install/source#gpu)

## ✅ Checklist de Configuração

- [ ] Desinstalar TensorFlow atual
- [ ] Instalar tensorflow[and-cuda]==2.16.1
- [ ] Executar `python check_gpu.py`
- [ ] Verificar se GPU é detectada
- [ ] Testar treinamento com GPU
- [ ] Verificar velocidade de treinamento

---

**Após completar a configuração, execute novamente:**

```bash
python test_ml_system.py
```

Os testes deverão passar e o treinamento será significativamente mais rápido!
