# ========================================
# Script de Limpeza Completa do Projeto
# ========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LIMPEZA COMPLETA DO PROJETO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se está na raiz do projeto
if (-not (Test-Path "backend")) {
    Write-Host "[ERRO] Execute este script na raiz do projeto SysScopel!" -ForegroundColor Red
    exit 1
}

# Função para calcular tamanho
function Get-FolderSize {
    param([string]$Path)
    if (Test-Path $Path) {
        $size = (Get-ChildItem -Path $Path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        return [math]::Round($size / 1MB, 2)
    }
    return 0
}

# Listar itens para deletar
Write-Host "Analisando itens para deletar..." -ForegroundColor Yellow
Write-Host ""

$itensParaDeletar = @()
$espacoTotal = 0

# 1. backend/backend/ (pasta duplicada)
if (Test-Path "backend\backend") {
    $tamanho = Get-FolderSize "backend\backend"
    $espacoTotal += $tamanho
    $itensParaDeletar += @{
        Path = "backend\backend"
        Descricao = "Pasta backend duplicada (versão antiga)"
        Tamanho = "${tamanho} MB"
        Tipo = "CRÍTICO"
    }
}

# 2. backend_20251201_1344.zip
if (Test-Path "backend_20251201_1344.zip") {
    $tamanho = [math]::Round((Get-Item "backend_20251201_1344.zip").Length / 1MB, 2)
    $espacoTotal += $tamanho
    $itensParaDeletar += @{
        Path = "backend_20251201_1344.zip"
        Descricao = "Backup ZIP antigo"
        Tamanho = "${tamanho} MB"
        Tipo = "CRÍTICO"
    }
}

# 3. backend.zip
if (Test-Path "backend.zip") {
    $tamanho = [math]::Round((Get-Item "backend.zip").Length / 1MB, 2)
    $espacoTotal += $tamanho
    $itensParaDeletar += @{
        Path = "backend.zip"
        Descricao = "Backup ZIP antigo"
        Tamanho = "${tamanho} MB"
        Tipo = "CRÍTICO"
    }
}

# 4. backend/img/logo.png (duplicado)
if (Test-Path "backend\img\logo.png") {
    $tamanho = [math]::Round((Get-Item "backend\img\logo.png").Length / 1MB, 2)
    $espacoTotal += $tamanho
    $itensParaDeletar += @{
        Path = "backend\img\logo.png"
        Descricao = "Imagem duplicada (já existe em public/img)"
        Tamanho = "${tamanho} MB"
        Tipo = "MÉDIO"
    }
}

# 5. backend/controllers/script.js (arquivo estranho)
if (Test-Path "backend\controllers\script.js") {
    $tamanho = [math]::Round((Get-Item "backend\controllers\script.js").Length / 1MB, 2)
    $espacoTotal += $tamanho
    $itensParaDeletar += @{
        Path = "backend\controllers\script.js"
        Descricao = "Arquivo inútil em controllers"
        Tamanho = "${tamanho} MB"
        Tipo = "MÉDIO"
    }
}

# Mostrar resumo
Write-Host "Itens encontrados para deletar:" -ForegroundColor Yellow
Write-Host ""

foreach ($item in $itensParaDeletar) {
    $cor = if ($item.Tipo -eq "CRÍTICO") { "Red" } else { "Yellow" }
    Write-Host "  [$($item.Tipo)]" -ForegroundColor $cor -NoNewline
    Write-Host " $($item.Path)" -ForegroundColor White
    Write-Host "    $($item.Descricao) - $($item.Tamanho)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Espaço total a liberar: " -NoNewline
Write-Host "${espacoTotal} MB" -ForegroundColor Green
Write-Host ""

# Confirmar
$resposta = Read-Host "Deseja prosseguir com a limpeza? (S/N)"

if ($resposta -ne "S" -and $resposta -ne "s") {
    Write-Host ""
    Write-Host "[CANCELADO] Nenhuma alteração foi feita." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Iniciando limpeza..." -ForegroundColor Green
Write-Host ""

$sucessos = 0
$erros = 0

foreach ($item in $itensParaDeletar) {
    Write-Host "Deletando: $($item.Path)..." -NoNewline
    
    try {
        if (Test-Path $item.Path) {
            Remove-Item -Path $item.Path -Recurse -Force -ErrorAction Stop
            Write-Host " OK" -ForegroundColor Green
            $sucessos++
        } else {
            Write-Host " IGNORADO (não existe)" -ForegroundColor Gray
        }
    } catch {
        Write-Host " ERRO" -ForegroundColor Red
        Write-Host "  Detalhes: $($_.Exception.Message)" -ForegroundColor Red
        $erros++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LIMPEZA CONCLUÍDA!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Sucessos: $sucessos" -ForegroundColor Green
Write-Host "Erros: $erros" -ForegroundColor $(if ($erros -gt 0) { "Red" } else { "Green" })
Write-Host "Espaço liberado: ~${espacoTotal} MB" -ForegroundColor Green
Write-Host ""

# Perguntar sobre commit
$commit = Read-Host "Deseja fazer commit das alterações? (S/N)"

if ($commit -eq "S" -or $commit -eq "s") {
    Write-Host ""
    Write-Host "Fazendo commit..." -ForegroundColor Yellow
    
    git add .
    git commit -m "Limpeza completa - remove duplicatas e arquivos inúteis (~${espacoTotal}MB)"
    
    $push = Read-Host "Deseja fazer push para o repositório? (S/N)"
    
    if ($push -eq "S" -or $push -eq "s") {
        Write-Host "Fazendo push..." -ForegroundColor Yellow
        git push origin main
        Write-Host ""
        Write-Host "[OK] Push concluído!" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Pronto! Projeto limpo e organizado. 🎉" -ForegroundColor Green
Write-Host ""

