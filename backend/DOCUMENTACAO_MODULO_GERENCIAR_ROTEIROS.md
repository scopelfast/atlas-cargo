# Documentação - Módulo Gerenciar Roteiros

## 📋 Visão Geral

O módulo **Gerenciar Roteiros** permite cadastrar, editar e visualizar roteiros de viagem com informações detalhadas sobre origem, destino, pontos intermediários, distâncias e resumo da rota.

## 🆕 Funcionalidades Implementadas

### Campo RESUMOROTA

Foi adicionado um novo campo `RESUMOROTA` na tabela `ROTEIRO` que armazena automaticamente um resumo completo da rota contendo:

- **Rodovias principais**: Lista das rodovias BR-XXX percorridas na ordem da rota
- **Estados percorridos**: Lista dos estados atravessados na ordem da rota
- **Cidades-chave por ordem**: Lista completa de todas as cidades identificadas ao longo da rota

**Formato do resumo:**
```
🗺️ Resumo da Rota
Rodovias principais: BR-376 → BR-101 → BR-290 → BR-116
Estados percorridos: Paraná (PR) → Santa Catarina (SC) → Rio Grande do Sul (RS)
Cidades-chave por ordem:
Curitiba → Araquari → Joinville → Garuva → Itapoá → Balneário Barra do Sul → Penha → Navegantes → Balneário Camboriú → Itajaí → Brusque → Florianópolis → Palhoça → Tubarão → Araranguá → Torres → Osório → Gravataí → Canoas
```

## 🗄️ Estrutura do Banco de Dados

### Tabela ROTEIRO

**Campo adicionado:**
- `RESUMOROTA` (VARCHAR(MAX), NULL): Armazena o resumo completo da rota gerado automaticamente

**Script de criação:**
```sql
-- Executar: backend/scripts/adicionar_campo_resumorota.sql
ALTER TABLE [dbo].[ROTEIRO]
ADD RESUMOROTA VARCHAR(MAX) NULL;
```

## 🔧 Arquivos Modificados

### Backend

1. **`backend/routes/roteiros.routes.js`**
   - Adicionado suporte ao campo `RESUMOROTA` nas rotas:
     - `GET /api/roteiros` - Lista roteiros (inclui RESUMOROTA)
     - `GET /api/roteiros/:id` - Busca roteiro por ID (inclui RESUMOROTA)
     - `POST /api/roteiros` - Cria novo roteiro (aceita RESUMOROTA)
     - `PUT /api/roteiros/:id` - Atualiza roteiro (aceita RESUMOROTA)

2. **`backend/scripts/adicionar_campo_resumorota.sql`**
   - Script SQL para adicionar o campo RESUMOROTA na tabela ROTEIRO

### Frontend

1. **`backend/public/modulos/gerenciar-roteiros/index.html`**
   - Adicionado campo `textarea` para exibir o resumo da rota na aba "Dados"
   - Campo readonly, preenchido automaticamente

2. **`backend/public/modulos/gerenciar-roteiros/js/script.js`**
   - Implementada função `gerarResumoRota()` que:
     - Extrai rodovias dos dados OSRM
     - Faz reverse geocoding usando Nominatim para identificar cidades
     - Ordena cidades e estados na ordem da rota
     - Formata o resumo no padrão solicitado
   - Integração com:
     - Botão "Calcular" (aba Dados)
     - Visualização do mapa (aba Mapa)
   - Carregamento e salvamento do resumo ao editar roteiro

## 🚀 Como Funciona

### Geração Automática do Resumo

O resumo é gerado automaticamente quando:

1. **Botão "Calcular" é clicado** (aba Dados):
   - Calcula a distância usando OSRM
   - Processa a geometria completa da rota
   - Identifica todas as cidades ao longo do caminho
   - Gera e salva o resumo

2. **Mapa é visualizado** (aba Mapa):
   - Carrega todos os pontos do roteiro
   - Calcula rota real usando OSRM
   - Processa coordenadas para identificar cidades
   - Gera e atualiza o resumo

### Processamento de Dados

1. **Extração de Rodovias**:
   - Analisa os steps do OSRM
   - Extrai referências de rodovias BR-XXX
   - Mantém ordem da rota

2. **Identificação de Cidades**:
   - Usa geometria completa do OSRM (milhares de coordenadas)
   - Processa 30 pontos estratégicos ao longo da rota
   - Faz reverse geocoding usando Nominatim (1 requisição/segundo)
   - Identifica mudanças de cidade/estado

3. **Ordenação**:
   - Cidades ordenadas pela posição na rota
   - Estados ordenados na sequência percorrida
   - Rodovias mantêm ordem de aparição

## ⚙️ Configurações e Limites

### Rate Limiting do Nominatim

- **Limite**: 1 requisição por segundo
- **Implementação**: Processamento sequencial com delay de 1.2 segundos
- **Retry**: 3 tentativas com backoff em caso de erro 429
- **Timeout**: 5 segundos por requisição

### Otimizações

- Processa até 30 pontos estratégicos (não todas as coordenadas)
- Usa geometria completa do OSRM quando disponível
- Cache do resumo no banco (não reprocessa toda vez)
- Indicador de progresso durante processamento

## 🐛 Correções Realizadas

1. **Erro de sintaxe**: Corrigido declaração duplicada de `cidadesOrdem`
2. **Erro 500**: Corrigido tratamento de erros nas funções de API
3. **Filtros não funcionavam**: Adicionada verificação de `response.ok` antes de processar JSON
4. **Rate limiting**: Implementado processamento sequencial respeitando limites do Nominatim
5. **CORS/429 errors**: Adicionado retry logic e tratamento adequado de erros

## 📝 Notas Técnicas

### Dependências Externas

- **OSRM (Open Source Routing Machine)**: Para cálculo de rotas reais
- **Nominatim (OpenStreetMap)**: Para reverse geocoding (coordenadas → cidades)
- **Leaflet.js**: Para visualização de mapas

### Performance

- **Tempo médio de geração**: ~36 segundos (30 pontos × 1.2s)
- **Depende de**: Disponibilidade do Nominatim e OSRM
- **Cache**: Resumo salvo no banco evita reprocessamento

## 🔍 Troubleshooting

### Resumo não está sendo gerado

1. Verificar se há origem e destino selecionados
2. Verificar se há pontos cadastrados ou rota OSRM disponível
3. Verificar console do navegador para erros
4. Verificar se Nominatim está acessível

### Resumo incompleto (poucas cidades)

1. Verificar se OSRM retornou geometria completa
2. Verificar se não foi bloqueado pelo rate limit do Nominatim
3. Aumentar número de pontos processados (alterar `maxPontosProcessar`)

### Erro 429 (Too Many Requests)

- Sistema já implementa retry automático
- Aguardar alguns segundos e tentar novamente
- Verificar se não há múltiplas instâncias processando simultaneamente

## 📅 Histórico de Versões

- **v1.0** (2025-04-05): Versão inicial
- **v1.2** (2025-01-13): Adicionado campo RESUMOROTA e geração automática
- **v1.3** (2025-01-13): Otimizações de performance e correção de bugs

## 👤 Autor

Sistema DivulgaCarga

## 📄 Licença

Proprietário - DivulgaCarga

