# Minimal static file server for Sherry Player.
# The app needs a real http:// origin -- browsers block IndexedDB and the
# folder picker on file:// pages. No Node or Python required.

param([int]$Port = 8123)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    Write-Host "Could not start on port $Port. Is it already in use?" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Sherry Player is running at http://localhost:$Port/" -ForegroundColor Green
Write-Host "  Leave this window open while you use the player."
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
}
$rootFull = [System.IO.Path]::GetFullPath($root)

while ($listener.IsListening) {
    try { $ctx = $listener.GetContext() } catch { break }

    $res = $ctx.Response
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))

    if (-not $full.StartsWith($rootFull)) {
        $res.StatusCode = 403
        $res.Close()
        continue
    }

    if (Test-Path -LiteralPath $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
        else { $res.ContentType = 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-store')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('404 - not found')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $res.Close()
}

$listener.Stop()
