# 🚀 Guia Rápido - Push para GitHub

## ✨ **NOVO:** Agora funciona de qualquer diretório!

O script detecta automaticamente a raiz do repositório Git, então você pode executá-lo de **qualquer pasta** dentro do projeto!

## 📋 Scripts Disponíveis

### Opção 1: Script PowerShell (Recomendado)
```powershell
.\push-github.ps1 "Sua mensagem de commit aqui"
```

**Exemplos:**
```powershell
# Da raiz do projeto
.\push-github.ps1 "Removido WaboxApp e simplificada interface"

# De qualquer subdiretório (ex: backend/)
.\push-github.ps1 "Correção de bugs"
```

### Opção 2: Script Batch (Windows)
```cmd
push-github.bat "Sua mensagem de commit aqui"
```

**Exemplo:**
```cmd
push-github.bat "Atualização do sistema de convocações"
```

### Opção 3: Sem mensagem (usa padrão)
```powershell
.\push-github.ps1
```
Usa a mensagem padrão: "Atualização do sistema"

## ⚡ O que o script faz automaticamente:

1. ✅ **Encontra automaticamente a raiz do repositório Git** (pode ser executado de qualquer diretório)
2. ✅ Verifica se está em um repositório Git
3. ✅ Mostra as alterações encontradas
4. ✅ Adiciona todos os arquivos modificados (`git add .`)
5. ✅ Faz commit com a mensagem fornecida
6. ✅ Verifica atualizações remotas e faz pull se necessário
7. ✅ Faz push para o GitHub (`git push`)

## 📝 Exemplos de Uso

### Commit simples:
```powershell
.\push-github.ps1 "Correção de bugs"
```

### Commit com descrição:
```powershell
.\push-github.ps1 "Removido WaboxApp e ngrok - Sistema simplificado"
```

### Commit rápido (sem mensagem):
```powershell
.\push-github.ps1
```

## ⚠️ Importante

- O script adiciona **TODOS** os arquivos modificados
- Certifique-se de que não há arquivos sensíveis (como `.env`) no commit
- O arquivo `.gitignore` já está configurado para ignorar arquivos sensíveis

## 🔧 Troubleshooting

### Erro: "Este diretório não é um repositório Git"
- O script pode ser executado de **qualquer diretório** dentro do repositório
- Certifique-se de estar dentro de um repositório Git válido

### Erro: "Erro ao fazer push"
- Verifique sua conexão com a internet
- Verifique suas credenciais do GitHub
- Execute `git remote -v` para verificar o repositório remoto

### Erro: "ExecutionPolicy"
- Execute no PowerShell: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

## 💡 Dica

Crie um alias no PowerShell para ainda mais agilidade:
```powershell
Set-Alias -Name push -Value ".\push-github.ps1"
```

Depois, use apenas:
```powershell
push "Sua mensagem"
```

