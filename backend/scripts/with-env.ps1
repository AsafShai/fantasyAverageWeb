param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Name,
    [Parameter(Mandatory = $true, Position = 1, ValueFromRemainingArguments = $true)][string[]]$Command
)

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.$Name"
if (-not (Test-Path $envFile)) {
    Write-Error "missing $envFile"
    exit 1
}

$previous = @{}
foreach ($line in Get-Content $envFile) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed.StartsWith('export ')) { $trimmed = $trimmed.Substring(7).Trim() }
    $eq = $trimmed.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $trimmed.Substring(0, $eq).Trim()
    $value = $trimmed.Substring($eq + 1).Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not $previous.ContainsKey($key)) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    }
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
}

$code = 0
try {
    $exe = $Command[0]
    $rest = if ($Command.Length -gt 1) { $Command[1..($Command.Length - 1)] } else { @() }
    & $exe @rest
    $code = $LASTEXITCODE
}
finally {
    foreach ($key in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
    }
}
exit $code
