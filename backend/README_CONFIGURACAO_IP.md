# 📋 Configuração do IP Local

Quando seu IP muda (mudança de rede Wi-Fi, etc.), você precisa atualizar a configuração no arquivo `.env`.

## 🚀 Solução Automática (Recomendado)

Execute o script que detecta automaticamente o IP e atualiza o `.env`:

```powershell
cd backend
.\atualizar-ip-local.ps1
```

Este script:
- ✅ Detecta automaticamente seu IP atual (Wi-Fi ou Ethernet)
- ✅ Atualiza a variável `PUBLIC_URL` no arquivo `.env`
- ✅ Mostra o IP detectado e a URL configurada

**Após executar, reinicie o servidor:**
```powershell
# Pare o servidor (Ctrl+C) e inicie novamente
npm run dev
```

## 📝 Solução Manual

1. Descubra seu IP atual:
   ```cmd
   ipconfig
   ```
   Procure por "Endereço IPv4" no adaptador Wi-Fi ou Ethernet ativo.

2. Edite o arquivo `backend/.env` e atualize a linha `PUBLIC_URL`:
   ```env
   PUBLIC_URL=http://192.168.1.173:3000
   ```
   (Substitua `192.168.1.173` pelo seu IP atual)

3. Reinicie o servidor:
   ```powershell
   npm run dev
   ```

## 🔍 Onde o IP é Usado?

O IP configurado em `PUBLIC_URL` é usado para:
- ✅ Gerar links de convocação para motoristas
- ✅ Links compartilhados via WhatsApp
- ✅ Acesso pela rede local (outros dispositivos na mesma rede)

## ⚠️ Importante

- **Firewall**: Certifique-se de que a porta 3000 está liberada no firewall
- **Rede**: O IP só funciona para dispositivos na mesma rede local
- **Mudança de IP**: Sempre que mudar de rede, execute `atualizar-ip-local.ps1`

## 🔧 Scripts Disponíveis

- `atualizar-ip-local.ps1` - Atualiza o IP automaticamente no `.env`
- `liberar-porta-firewall.ps1` - Libera a porta 3000 no firewall (requer Admin)

## 📱 Testando

Após configurar, teste acessando:
- `http://localhost:3000/dashboard.html` (mesmo computador)
- `http://SEU_IP:3000/dashboard.html` (outros dispositivos na rede)

