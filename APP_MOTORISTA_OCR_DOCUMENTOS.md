# 📸 APP MOTORISTA - OCR DE DOCUMENTOS (CNH + CRLV)

## 🎯 OBJETIVO

**Facilitar cadastro usando OCR para capturar dados automaticamente:**
- 📄 **CNH** (Carteira Nacional de Habilitação)
- 🚗 **CRLV** (Certificado de Registro e Licenciamento de Veículo)

---

## ✅ BENEFÍCIOS DO OCR

### **Para o Motorista:**
- ✅ **Cadastro super rápido** (30 segundos vs 5 minutos)
- ✅ **Sem digitação** (só revisar)
- ✅ **Sem erros de digitação**
- ✅ **Experiência moderna e profissional**

### **Para a Empresa:**
- ✅ **Dados mais precisos**
- ✅ **Menos retrabalho** (corrigir erros)
- ✅ **Validação automática** (CPF, placas, etc)
- ✅ **Imagens dos documentos armazenadas**

---

## 📄 CNH - CAMPOS A EXTRAIR

### **Dados da CNH (Frente):**
```
┌─────────────────────────────────┐
│  REPÚBLICA FEDERATIVA DO BRASIL │
│  CARTEIRA NACIONAL DE HABILITAÇÃO│
├─────────────────────────────────┤
│ Nome: JOÃO DA SILVA SANTOS      │ ✅ Extrair
│ CPF: 123.456.789-00             │ ✅ Extrair
│ Data Nasc: 15/03/1985           │ ✅ Extrair
│ Filiação: MARIA SANTOS          │ ✅ Extrair
│ RG: 1.234.567-8 SSP/PR          │ ✅ Extrair
│                                  │
│ N° Registro: 12345678901        │ ✅ Extrair (NÚMERO CNH)
│ 1ª Hab: 10/05/2003              │ ✅ Extrair
│ Validade: 15/03/2030            │ ✅ Extrair
│ Categoria: AB                   │ ✅ Extrair
│                                  │
│ [FOTO DO MOTORISTA]              │
└─────────────────────────────────┘
```

### **Dados da CNH (Verso):**
```
┌─────────────────────────────────┐
│ Local de Emissão: CURITIBA/PR   │ ✅ Extrair (opcional)
│ Data Emissão: 16/03/2020        │ ✅ Extrair (opcional)
│                                  │
│ Observações:                     │
│ - EAR (Exerce Atividade         │
│   Remunerada)                   │ ✅ Extrair (se tiver)
└─────────────────────────────────┘
```

### **Campos Obrigatórios:**
1. ✅ **Número da CNH** (11 dígitos)
2. ✅ **Nome Completo**
3. ✅ **CPF**
4. ✅ **Data de Nascimento**
5. ✅ **Categoria** (A, B, AB, C, D, E, etc)
6. ✅ **Data de Validade**
7. ✅ **Data da Primeira Habilitação**

---

## 🚗 CRLV - CAMPOS A EXTRAIR

### **Dados do CRLV:**
```
┌─────────────────────────────────┐
│ CERTIFICADO DE REGISTRO E       │
│ LICENCIAMENTO DE VEÍCULO        │
├─────────────────────────────────┤
│ RENAVAM: 12345678901            │ ✅ Extrair
│ Placa: ABC-1234                 │ ✅ Extrair
│                                  │
│ Marca/Modelo: VOLVO/FH 540      │ ✅ Extrair
│ Ano Fab/Mod: 2020/2021          │ ✅ Extrair
│ Cor: BRANCA                     │ ✅ Extrair
│ Combustível: DIESEL             │ ✅ Extrair
│ Categoria: CAMINHÃO             │ ✅ Extrair
│                                  │
│ Chassi: 9BW...                  │ ✅ Extrair
│                                  │
│ Proprietário:                    │
│ JOÃO DA SILVA SANTOS            │ ✅ Validar (mesmo da CNH)
│ CPF: 123.456.789-00             │ ✅ Validar
│                                  │
│ Município: CURITIBA/PR          │ ✅ Extrair
│                                  │
│ Capacidade: 23.000 kg           │ ✅ Extrair
│                                  │
│ Exercício: 2024                 │ ✅ Extrair
└─────────────────────────────────┘
```

### **Campos Obrigatórios:**
1. ✅ **Placa** (AAA-1234 ou AAA1A23)
2. ✅ **RENAVAM** (11 dígitos)
3. ✅ **Marca/Modelo**
4. ✅ **Ano Fabricação/Modelo**
5. ✅ **Categoria** (Caminhão, Carreta, etc)
6. ✅ **Capacidade** (kg)
7. ✅ **CPF do Proprietário** (validar se é o mesmo)

---

## 🔧 TECNOLOGIAS DE OCR

### **Opção 1: Tesseract.js** ⭐ RECOMENDADO (Grátis)
- ✅ **Grátis e Open Source**
- ✅ Funciona no navegador (JavaScript)
- ✅ Offline (após baixar modelos)
- ✅ Boa precisão para textos simples
- ⚠️ Precisa pré-processamento de imagem
- ⚠️ ~80-85% de precisão (documentos brasileiros)

**Uso:**
```javascript
import Tesseract from 'tesseract.js';

const { data: { text } } = await Tesseract.recognize(
  imagemCNH,
  'por', // Português
  {
    logger: m => console.log(m) // Progress
  }
);
```

---

### **Opção 2: Google Cloud Vision API** (Pago - Mais Preciso)
- ✅ **Muito preciso** (~95%+)
- ✅ Detecta campos automaticamente
- ✅ Suporta documentos brasileiros
- ✅ API REST simples
- ⚠️ **Custo:** $1.50 por 1000 imagens
- ⚠️ Precisa internet

**Preço:**
- Primeiras 1.000 imagens/mês: **GRÁTIS**
- Depois: $1.50 por 1.000 imagens
- **Exemplo:** 100 cadastros/mês = GRÁTIS

---

### **Opção 3: AWS Textract** (Pago - Especializado)
- ✅ Especializado em documentos
- ✅ Detecta campos e estrutura
- ✅ Boa precisão (~92%)
- ⚠️ **Custo:** $1.50 por 1000 páginas
- ⚠️ Mais complexo de configurar

---

### **Opção 4: Mindee (Especializado em CNH/CRLV)** 💰
- ✅ **Especializado em documentos brasileiros**
- ✅ **Muito preciso** para CNH/CRLV (~98%)
- ✅ Extrai campos automaticamente
- ✅ API simples
- ⚠️ **Custo:** $29/mês (500 docs)
- ⚠️ Depois: $0.06 por documento

---

### **🎯 RECOMENDAÇÃO: Híbrido**

**FASE 1 (MVP):** Tesseract.js
- Grátis
- Funciona offline
- Boa precisão

**FASE 2 (Produção):** Google Vision API
- Muito mais preciso
- Custo baixo (1000 grátis/mês)
- Fácil de integrar

---

## 📸 FLUXO DO USUÁRIO (UX)

### **1. Cadastrar CNH:**

```
┌─────────────────────────────┐
│  📄 Cadastro - CNH          │
├─────────────────────────────┤
│                             │
│  [📷 Tirar Foto da CNH]     │ ← Botão grande
│                             │
│  Posicione a CNH em uma     │
│  superfície plana e bem     │
│  iluminada.                 │
│                             │
│  ✓ Frente do documento      │
│  ✓ Foto nítida              │
│  ✓ Sem reflexos             │
└─────────────────────────────┘

         ↓ Tira foto

┌─────────────────────────────┐
│  Processando...             │
│  🔄 Lendo documento...      │
│                             │
│  [Barra de progresso]       │
└─────────────────────────────┘

         ↓ OCR processa

┌─────────────────────────────┐
│  ✅ Dados Extraídos         │
│  Revise os dados:           │
├─────────────────────────────┤
│ Nome: JOÃO DA SILVA SANTOS  │
│ [✏️ Editar]                 │
│                             │
│ CPF: 123.456.789-00 ✓       │
│                             │
│ Nº CNH: 12345678901         │
│ [✏️ Editar]                 │
│                             │
│ Categoria: AB ✓             │
│                             │
│ Validade: 15/03/2030 ✓      │
│                             │
│ Data Nasc: 15/03/1985       │
│ [✏️ Editar]                 │
├─────────────────────────────┤
│ [✓ Confirmar Dados]         │
│ [⟲ Tirar Nova Foto]        │
└─────────────────────────────┘
```

### **2. Cadastrar Veículo (CRLV):**

```
┌─────────────────────────────┐
│  🚗 Cadastro - Veículo      │
├─────────────────────────────┤
│                             │
│  [📷 Tirar Foto do CRLV]    │
│                             │
│  Posicione o documento      │
│  completo na foto.          │
└─────────────────────────────┘

         ↓ OCR

┌─────────────────────────────┐
│  ✅ Veículo Identificado    │
├─────────────────────────────┤
│ Placa: ABC-1234             │
│ [✏️ Editar]                 │
│                             │
│ RENAVAM: 12345678901        │
│                             │
│ Marca/Modelo:               │
│ VOLVO FH 540                │
│ [✏️ Editar]                 │
│                             │
│ Ano: 2020/2021              │
│                             │
│ Categoria: CAMINHÃO         │
│ [📋 Selecionar Tipo]        │
│                             │
│ Capacidade: 23000 kg        │
│ [✏️ Editar]                 │
├─────────────────────────────┤
│ [✓ Confirmar Dados]         │
└─────────────────────────────┘
```

---

## 🖼️ PRÉ-PROCESSAMENTO DE IMAGEM

**Antes de enviar para OCR, melhorar a qualidade:**

### **1. Ajustes Automáticos:**
```javascript
async function preprocessarImagem(imagemBase64) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.src = imagemBase64;
  await img.decode();
  
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
  
  // 1. Converter para escala de cinza
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const avg = (imageData.data[i] + imageData.data[i+1] + imageData.data[i+2]) / 3;
    imageData.data[i] = imageData.data[i+1] = imageData.data[i+2] = avg;
  }
  
  // 2. Aumentar contraste
  const contrast = 1.5;
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = ((imageData.data[i] - 128) * contrast) + 128;
    imageData.data[i+1] = ((imageData.data[i+1] - 128) * contrast) + 128;
    imageData.data[i+2] = ((imageData.data[i+2] - 128) * contrast) + 128;
  }
  
  // 3. Threshold (binarização)
  const threshold = 128;
  for (let i = 0; i < imageData.data.length; i += 4) {
    const v = imageData.data[i] > threshold ? 255 : 0;
    imageData.data[i] = imageData.data[i+1] = imageData.data[i+2] = v;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
```

### **2. Dicas para o Usuário:**
- ✅ Foto em superfície plana
- ✅ Boa iluminação (sem sombras)
- ✅ Sem reflexos/brilho
- ✅ Documento completo na foto
- ✅ Foto nítida (não tremida)

---

## 🧠 EXTRAÇÃO INTELIGENTE (REGEX)

### **CNH - Padrões:**
```javascript
const patterns = {
  // Número CNH: 11 dígitos
  numeroCNH: /\b\d{11}\b/,
  
  // CPF: 123.456.789-00 ou 12345678900
  cpf: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
  
  // Data: 15/03/2030
  data: /\b\d{2}\/\d{2}\/\d{4}\b/,
  
  // Categoria: AB, C, D, E, etc
  categoria: /\b[A-E]{1,3}\b/,
  
  // Nome: tudo em maiúsculas antes do CPF
  nome: /^([A-ZÀÁÃÂÉÊÍÓÔÕÚÇ\s]+)/m
};

function extrairDadosCNH(textoOCR) {
  const dados = {};
  
  // CPF
  const cpfMatch = textoOCR.match(patterns.cpf);
  if (cpfMatch) {
    dados.cpf = cpfMatch[0].replace(/\D/g, '');
  }
  
  // Número CNH
  const cnhMatch = textoOCR.match(patterns.numeroCNH);
  if (cnhMatch) {
    dados.numeroCNH = cnhMatch[0];
  }
  
  // Datas
  const datas = textoOCR.match(new RegExp(patterns.data, 'g'));
  if (datas && datas.length >= 2) {
    dados.dataNascimento = datas[0];
    dados.dataValidade = datas[1];
    if (datas.length >= 3) {
      dados.dataPrimeiraHab = datas[2];
    }
  }
  
  // Categoria
  const catMatch = textoOCR.match(/Categoria:\s*([A-E]{1,3})/i);
  if (catMatch) {
    dados.categoria = catMatch[1];
  }
  
  // Nome (procurar próximo ao CPF)
  const linhas = textoOCR.split('\n');
  const cpfIndex = linhas.findIndex(l => l.match(patterns.cpf));
  if (cpfIndex > 0) {
    // Nome geralmente está 1-2 linhas antes do CPF
    dados.nome = linhas[cpfIndex - 1].trim();
  }
  
  return dados;
}
```

### **CRLV - Padrões:**
```javascript
const patternsVeiculo = {
  // Placa: ABC-1234 ou ABC1D34 (Mercosul)
  placa: /\b[A-Z]{3}-?\d{1}[A-Z0-9]{1}\d{2}\b/,
  
  // RENAVAM: 11 dígitos
  renavam: /\b\d{11}\b/,
  
  // Ano: 2020/2021
  ano: /\b\d{4}\/\d{4}\b/,
  
  // Capacidade: 23000 kg, 23.000 kg, etc
  capacidade: /(\d{1,3}\.?\d{3})\s*kg/i
};

function extrairDadosCRLV(textoOCR) {
  const dados = {};
  
  // Placa
  const placaMatch = textoOCR.match(patternsVeiculo.placa);
  if (placaMatch) {
    dados.placa = placaMatch[0].replace('-', '').toUpperCase();
  }
  
  // RENAVAM
  const renavamMatch = textoOCR.match(patternsVeiculo.renavam);
  if (renavamMatch) {
    dados.renavam = renavamMatch[0];
  }
  
  // Ano
  const anoMatch = textoOCR.match(patternsVeiculo.ano);
  if (anoMatch) {
    const [fab, mod] = anoMatch[0].split('/');
    dados.anoFabricacao = fab;
    dados.anoModelo = mod;
  }
  
  // Capacidade
  const capMatch = textoOCR.match(patternsVeiculo.capacidade);
  if (capMatch) {
    dados.capacidadeKg = parseInt(capMatch[1].replace(/\D/g, ''));
  }
  
  // Marca/Modelo (procurar linha com barra)
  const marcaModeloMatch = textoOCR.match(/([A-Z\/\s]+)\s*\/\s*([A-Z0-9\s]+)/);
  if (marcaModeloMatch) {
    dados.marcaModelo = marcaModeloMatch[0].trim();
  }
  
  return dados;
}
```

---

## ✅ VALIDAÇÕES

### **CNH:**
```javascript
function validarDadosCNH(dados) {
  const erros = [];
  
  // CPF válido?
  if (!validarCPF(dados.cpf)) {
    erros.push('CPF inválido');
  }
  
  // CNH tem 11 dígitos?
  if (!dados.numeroCNH || dados.numeroCNH.length !== 11) {
    erros.push('Número da CNH deve ter 11 dígitos');
  }
  
  // Data de validade futura?
  const validade = new Date(dados.dataValidade.split('/').reverse().join('-'));
  if (validade < new Date()) {
    erros.push('CNH vencida!');
  }
  
  // Categoria válida?
  const categoriasValidas = ['A', 'B', 'AB', 'C', 'D', 'E', 'AC', 'AD', 'AE'];
  if (!categoriasValidas.includes(dados.categoria)) {
    erros.push('Categoria inválida');
  }
  
  return { valido: erros.length === 0, erros };
}
```

### **CRLV:**
```javascript
function validarDadosCRLV(dados) {
  const erros = [];
  
  // Placa válida? (padrão antigo ou Mercosul)
  const placaAntiga = /^[A-Z]{3}\d{4}$/;
  const placaMercosul = /^[A-Z]{3}\d[A-Z]\d{2}$/;
  
  if (!placaAntiga.test(dados.placa) && !placaMercosul.test(dados.placa)) {
    erros.push('Placa inválida');
  }
  
  // RENAVAM tem 11 dígitos?
  if (!dados.renavam || dados.renavam.length !== 11) {
    erros.push('RENAVAM deve ter 11 dígitos');
  }
  
  // Ano razoável?
  const anoAtual = new Date().getFullYear();
  if (dados.anoModelo < 1990 || dados.anoModelo > anoAtual + 1) {
    erros.push('Ano do veículo suspeito');
  }
  
  return { valido: erros.length === 0, erros };
}
```

---

## 📊 PRECISÃO E FALLBACK

### **Taxa de Sucesso Esperada:**

| Documento | Tesseract | Google Vision | Mindee |
|-----------|-----------|---------------|--------|
| **CNH** | ~80% | ~95% | ~98% |
| **CRLV** | ~75% | ~92% | ~97% |

### **Fallback Manual:**

Se OCR falhar ou usuário preferir:
```
┌─────────────────────────────┐
│  ⚠️ Não consegui ler o      │
│     documento                │
├─────────────────────────────┤
│                             │
│  [📷 Tentar Novamente]      │
│  [✏️ Digitar Manualmente]   │
│                             │
└─────────────────────────────┘
```

---

## 💰 CUSTOS ESTIMADOS

### **Cenário: 100 Motoristas/Mês**

**Tesseract.js (Grátis):**
- Custo: **R$ 0**
- Precisão: ~80%

**Google Vision API:**
- 1000 imagens/mês: **GRÁTIS**
- 100 motoristas × 3 fotos = 300 imagens
- Custo: **R$ 0** (dentro do free tier)
- Precisão: ~95%

**Mindee:**
- $29/mês (500 docs)
- Custo: **R$ 145/mês**
- Precisão: ~98%

**🎯 RECOMENDAÇÃO:** Google Vision API
- Grátis até 1000/mês
- Muito preciso
- Fácil de integrar

---

## 🔄 FLUXO COMPLETO

```
1. Motorista clica "Cadastrar CNH"
    ↓
2. App abre câmera
    ↓
3. Motorista tira foto
    ↓
4. App pré-processa imagem (contraste, cinza, etc)
    ↓
5. Envia para Google Vision API (ou Tesseract)
    ↓
6. API retorna texto extraído
    ↓
7. App aplica regex para extrair campos
    ↓
8. App valida dados (CPF, datas, etc)
    ↓
9. Mostra dados para motorista revisar
    ↓
10. Motorista confirma ou edita
    ↓
11. App salva dados + foto do documento
    ↓
12. Sucesso! ✅
```

---

## 📝 ATUALIZAÇÕES NO PLANEJAMENTO

### **Novo Tempo de Desenvolvimento:**
- Fase 1 (MVP): **+1 semana** (integrar OCR básico)

### **Novas APIs Backend:**
```
POST /api/motorista/ocr-cnh        - Processar foto CNH
POST /api/motorista/ocr-crlv       - Processar foto CRLV
POST /api/motorista/validar-cnh    - Validar dados CNH
POST /api/motorista/validar-crlv   - Validar dados CRLV
```

---

## 🎉 RESULTADO FINAL

**Cadastro de Motorista:**
- ⏱️ **Tempo:** 30 segundos (vs 5 minutos manual)
- ✅ **Precisão:** ~95% (com Google Vision)
- 😊 **UX:** Excelente (moderno e rápido)
- 💰 **Custo:** GRÁTIS (até 1000/mês)

**Cadastro de Veículo:**
- ⏱️ **Tempo:** 20 segundos
- ✅ **Precisão:** ~92%
- 🚗 **Validação:** Automática

---

**OCR = DIFERENCIAL PROFISSIONAL! 🚀📸**

