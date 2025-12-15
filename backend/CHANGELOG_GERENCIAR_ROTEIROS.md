# Changelog - Módulo Gerenciar Roteiros

## [1.3] - 2025-01-13

### Adicionado
- Campo `RESUMOROTA` na tabela ROTEIRO para armazenar resumo completo da rota
- Função `gerarResumoRota()` que gera automaticamente:
  - Rodovias principais (BR-XXX) na ordem da rota
  - Estados percorridos na ordem da rota
  - Cidades-chave por ordem (todas as cidades identificadas)
- Integração com OSRM para extração de rodovias
- Integração com Nominatim para reverse geocoding de cidades
- Campo de texto readonly na interface para exibir o resumo
- Geração automática ao clicar em "Calcular" ou visualizar mapa
- Script SQL para adicionar campo RESUMOROTA (`adicionar_campo_resumorota.sql`)

### Melhorado
- Processamento de geometria completa do OSRM (milhares de coordenadas)
- Identificação de cidades usando reverse geocoding
- Ordenação correta de cidades e estados na sequência da rota
- Performance: processamento sequencial respeitando rate limit do Nominatim
- Tratamento de erros: retry logic para erros 429 (Too Many Requests)
- Validação de respostas da API antes de processar JSON
- Logs detalhados para debug

### Corrigido
- Erro de sintaxe: declaração duplicada de variável `cidadesOrdem`
- Erro 500: tratamento adequado de erros nas funções de API
- Filtros não funcionavam: adicionada verificação de `response.ok`
- Rate limiting: implementado processamento sequencial (1 req/segundo)
- CORS/429 errors: adicionado retry logic e tratamento adequado
- Carregamento de dados: correção na inicialização do módulo

### Documentação
- Criada documentação completa do módulo (`DOCUMENTACAO_MODULO_GERENCIAR_ROTEIROS.md`)
- Atualizado `init.sql` para incluir criação do campo RESUMOROTA
- Atualizadas versões nos arquivos principais

## [1.2] - 2025-04-05

### Corrigido
- Correção do overlay de carregamento

## [1.0] - 2025-04-05

### Adicionado
- Versão inicial do módulo
- CRUD completo de roteiros
- Gerenciamento de pontos de roteiro
- Visualização de mapas com Leaflet
- Cálculo de distâncias usando OSRM

