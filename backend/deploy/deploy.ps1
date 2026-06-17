# Roda NO SEU PC WINDOWS (mesma rede do servidor). Copia o backend e executa o bootstrap.
param(
  [string]$Server = "codex@192.168.0.42",
  [string]$Dest   = "oghma"
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Split-Path -Parent $here   # .../Oghma Library/backend

Write-Host ">> Copiando backend para ${Server}:$Dest (vai pedir a senha do servidor)"
ssh $Server "rm -rf '$Dest'"
scp -r "$backend" "${Server}:$Dest"

Write-Host ">> Rodando bootstrap no servidor"
ssh $Server "cd '$Dest' && bash deploy/bootstrap.sh"

Write-Host ">> Pronto. Abra http://192.168.0.42:8000/docs"
