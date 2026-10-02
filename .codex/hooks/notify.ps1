param([string]$Event = "done")

$ErrorActionPreference = "SilentlyContinue"

if ($Event -eq "waiting") {
    $title = "Claude needs input"
    $body  = "Waiting for you in $(Split-Path -Leaf (Get-Location))"
} else {
    $title = "Claude finished"
    $body  = "Turn complete in $(Split-Path -Leaf (Get-Location))"
}

# Play a system sound — works even when the window is focused
Add-Type -AssemblyName System.Media
[System.Media.SystemSounds]::Asterisk.Play()

# Also try a toast (may be suppressed when Claude Code is in focus, but worth trying)
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml(@"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$title</text>
      <text>$body</text>
    </binding>
  </visual>
  <audio silent="true"/>
</toast>
"@)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {}
