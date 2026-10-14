
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead('C:\Users\scope\OneDrive\Área de Trabalho\Lista itens inventário.docx')
$e = $z.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
$sr = New-Object System.IO.StreamReader($e.Open())
$xml = $sr.ReadToEnd()
$sr.Close()
$z.Dispose()
$text = $xml -replace '</w:p>', "`n" -replace '<[^>]+>', '' -replace '&amp;', '&'
[System.IO.File]::WriteAllText('C:\gitHub\SysScopel\backend\scripts\_tmp-lista-inv.txt', $text)
