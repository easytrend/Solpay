$path = Resolve-Path "src/components/P2PPanel.jsx"
$lines = [System.IO.File]::ReadAllLines($path.Path)
$out = $lines[0..3227] + $lines[3302..($lines.Length - 1)]
[System.IO.File]::WriteAllLines($path.Path, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Done. Total lines: $($out.Length)"
