# Configuração de URL Pública para Links de Convocação

## Problema
Quando o sistema está rodando em `localhost:3000`, os links de convocação enviados via WhatsApp não funcionam no celular, pois `localhost` só é acessível no próprio computador.

## Solução
O sistema agora detecta automaticamente a URL pública ou permite configurá-la via variável de ambiente.

## Configuração

### Opção 1: Variável de Ambiente (Recomendado para Produção)

Crie um arquivo `.env` na pasta `backend/` ou configure a variável de ambiente:

```env
PUBLIC_URL=https://seudominio.com.br
```

ou

```env
APP_URL=https://seudominio.com.br
```

### Opção 2: IP Local (Para Testes no Celular)

Se você estiver testando na mesma rede local (Wi-Fi), pode usar o IP local do servidor:

1. Descubra o IP do seu computador:
   - Windows: `ipconfig` (procure por "IPv4")
   - Linux/Mac: `ifconfig` ou `ip addr`

2. Configure no `.env`:
   ```env
   PUBLIC_URL=http://192.168.1.100:3000
   ```
   (Substitua `192.168.1.100` pelo IP do seu computador)

3. Certifique-se de que o firewall permite conexões na porta 3000

### Opção 3: Detecção Automática

Se não configurar `PUBLIC_URL`, o sistema tentará usar o host da requisição. Isso funciona bem em produção com domínio próprio, mas não funciona com `localhost` no celular.

## Como Funciona

1. O frontend chama `/api/public-url` para obter a URL base
2. O backend retorna a URL configurada em `PUBLIC_URL` ou `APP_URL`
3. Se não houver configuração e for `localhost`, retorna um aviso
4. Os links de convocação são gerados usando essa URL pública

## Exemplo de Link Gerado

Com `PUBLIC_URL=https://meusistema.com.br`:
```
https://meusistema.com.br/convocacao/6
```

## Testando no Celular

1. Configure `PUBLIC_URL` com o IP local do servidor
2. Certifique-se de que o celular está na mesma rede Wi-Fi
3. Envie uma convocação e teste o link no celular

## Produção

Em produção, sempre configure `PUBLIC_URL` com o domínio público do seu servidor para garantir que os links funcionem corretamente.

