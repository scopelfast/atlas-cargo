# Script para agilizar push para GitHub
# Uso: .\push-github.ps1 "Mensagem do commit"

param(
    [Parameter(Mandatory=$false)]
    [string]$mensagem = "Atualizacao do sistema"
)

Write-Host "Iniciando push para GitHub..." -ForegroundColor Cyan
Write-Host ""

# Verificar se esta no diretorio raiz do repositorio
if (-not (Test-Path ".git")) {
    Write-Host "Erro: Este diretorio nao e um repositorio Git!" -ForegroundColor Red
    Write-Host "   Execute este script na raiz do projeto (onde esta a pasta .git)" -ForegroundColor Yellow
    exit 1
}

# Verificar status
Write-Host "Verificando status do repositorio..." -ForegroundColor Yellow
$status = git status --short

if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "Nenhuma alteracao para commitar." -ForegroundColor Green
    Write-Host ""
    Write-Host "Verificando se ha commits para fazer push..." -ForegroundColor Yellow
    
    $ahead = git status | Select-String "Your branch is ahead"
    if ($ahead) {
        Write-Host "Fazendo push dos commits existentes..." -ForegroundColor Yellow
        git push
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Push realizado com sucesso!" -ForegroundColor Green
        } else {
            Write-Host "Erro ao fazer push." -ForegroundColor Red
        }
    } else {
        Write-Host "Tudo esta sincronizado com o GitHub!" -ForegroundColor Green
    }
    exit 0
}

# Mostrar alteracoes
Write-Host ""
Write-Host "Alteracoes encontradas:" -ForegroundColor Cyan
git status --short
Write-Host ""

# Adicionar todos os arquivos
Write-Host "Adicionando arquivos ao staging..." -ForegroundColor Yellow
git add .

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao adicionar arquivos." -ForegroundColor Red
    exit 1
}

# Fazer commit
Write-Host "Fazendo commit..." -ForegroundColor Yellow
Write-Host "   Mensagem: $mensagem" -ForegroundColor Gray
git commit -m $mensagem

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao fazer commit." -ForegroundColor Red
    exit 1
}

Write-Host "Commit realizado com sucesso!" -ForegroundColor Green
Write-Host ""

# Verificar se precisa fazer pull primeiro
Write-Host "Verificando atualizacoes remotas..." -ForegroundColor Yellow
git fetch

$statusFull = git status
if ($statusFull -match "Your branch is behind") {
    Write-Host "O repositorio remoto tem alteracoes que voce nao possui localmente." -ForegroundColor Yellow
    Write-Host "Fazendo pull para sincronizar..." -ForegroundColor Yellow
    git pull --no-edit
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erro ao fazer pull. Pode haver conflitos." -ForegroundColor Red
        Write-Host "Resolva os conflitos manualmente e tente novamente." -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "Pull realizado com sucesso!" -ForegroundColor Green
    Write-Host ""
}

# Fazer push
Write-Host "Fazendo push para o GitHub..." -ForegroundColor Yellow
git push

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Push realizado com sucesso!" -ForegroundColor Green
    Write-Host "Codigo atualizado no GitHub!" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "Erro ao fazer push." -ForegroundColor Red
    Write-Host "Possiveis causas:" -ForegroundColor Yellow
    Write-Host "   - O repositorio remoto tem alteracoes que precisam ser integradas" -ForegroundColor Gray
    Write-Host "   - Problemas de conexao ou credenciais" -ForegroundColor Gray
    Write-Host "   - Execute git pull manualmente e tente novamente" -ForegroundColor Gray
    exit 1
}
