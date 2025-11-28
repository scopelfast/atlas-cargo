# Como Liberar a Porta 3000 no Firewall do Windows

## Opção 1: Executar o Script PowerShell como Administrador

1. Clique com o botão direito no arquivo `liberar-porta-firewall.ps1`
2. Selecione "Executar com PowerShell" (ou "Run with PowerShell")
3. Se aparecer um aviso de segurança, clique em "Sim" ou "Allow"

**OU**

1. Abra o PowerShell como Administrador:
   - Pressione `Win + X`
   - Selecione "Windows PowerShell (Admin)" ou "Terminal (Admin)"
2. Navegue até a pasta do backend:
   ```powershell
   cd C:\Users\cleverson.scopel\Documents\GitHub\SysScopel\backend
   ```
3. Execute o script:
   ```powershell
   .\liberar-porta-firewall.ps1
   ```

## Opção 2: Comando Manual no PowerShell (como Administrador)

Abra o PowerShell como Administrador e execute:

```powershell
New-NetFirewallRule -DisplayName "Node.js Backend - Porta 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

## Opção 3: Interface Gráfica do Windows

1. Abra o "Firewall do Windows Defender" (busque no menu Iniciar)
2. Clique em "Configurações Avançadas"
3. No painel esquerdo, clique em "Regras de Entrada"
4. No painel direito, clique em "Nova Regra..."
5. Selecione "Porta" → Avançar
6. Selecione "TCP" e digite `3000` → Avançar
7. Selecione "Permitir a conexão" → Avançar
8. Marque todas as opções (Domínio, Privada, Pública) → Avançar
9. Nome: "Node.js Backend - Porta 3000" → Concluir

## Verificar se Funcionou

Após liberar a porta, teste acessando:
- `http://SEU_IP:3000/dashboard.html` (substitua SEU_IP pelo seu IP atual)

Se ainda não funcionar, verifique:
- Se o servidor está rodando (`npm run dev`)
- Se o IP está correto (execute `ipconfig` no CMD para ver seu IP)
- Se há outro firewall (antivírus) bloqueando

