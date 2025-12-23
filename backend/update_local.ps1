$User = "grafico"
$Host = "192.168.1.220"
$ScriptPath = "/home/grafico/Documentos/divulgacarga/backend/update.sh"

ssh "$User@$Host" "bash $ScriptPath"
