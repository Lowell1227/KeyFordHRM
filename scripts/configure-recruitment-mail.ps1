[CmdletBinding()]
param(
    [string] $Account,
    [string] $Folder = (-join ([char[]](0x62db, 0x8058, 0x7b80, 0x5386))),
    [string] $AuthorizedFrom,
    [string] $ProfilePath,
    [switch] $SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:FailureCode = 'LOCAL_PROFILE_SETUP_FAILED'

function Stop-Setup([string] $Code) {
    $script:FailureCode = $Code
    throw [InvalidOperationException]::new('Local credential setup refused.')
}

function Get-Scope([string] $Email, [string] $MailboxFolder, [string] $Start) {
    if ([string]::IsNullOrWhiteSpace($Email) -or $Email.Length -gt 254 -or $Email -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)+$' -or
        $Email.Contains('..') -or $Email.Contains('.@') -or $Email.IndexOf('@') -gt 64) { Stop-Setup 'INVALID_ACCOUNT' }
    if ([string]::IsNullOrWhiteSpace($MailboxFolder) -or $MailboxFolder.Length -gt 128 -or
        $MailboxFolder -cne $MailboxFolder.Trim() -or $MailboxFolder -in @('.', '..') -or
        $MailboxFolder -match '[\\/:\x00-\x1f\x7f]') { Stop-Setup 'INVALID_FOLDER' }
    $normalizedFolder = $MailboxFolder.Normalize([Text.NormalizationForm]::FormC)
    if ([string]::IsNullOrEmpty($Start)) {
        $utc = [DateTime]::UtcNow.ToString('o')
    } else {
        if ($Start -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') { Stop-Setup 'INVALID_UTC_START' }
        $date = [DateTimeOffset]::MinValue
        $formats = [string[]]@("yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'")
        $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
        if (-not [DateTimeOffset]::TryParseExact($Start, $formats, [Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$date)) {
            Stop-Setup 'INVALID_UTC_START'
        }
        $utc = $date.UtcDateTime.ToString('o')
    }
    return [pscustomobject]@{ account = $Email.ToLowerInvariant(); folder = $normalizedFolder; authorizedFrom = $utc }
}

function Get-ProfileName($Scope) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        $key = [Text.Encoding]::UTF8.GetBytes($Scope.account + '/' + $Scope.folder)
        return ([BitConverter]::ToString($hash.ComputeHash($key)).Replace('-', '').ToLowerInvariant() + '.json.dpapi')
    } finally { $hash.Dispose() }
}

function Assert-SafePath([string] $Path) {
    if ($Path -cnotmatch '^[A-Za-z]:\\' -or $Path.Substring(2) -match '[:/*?\[\]\x00-\x1f]' -or
        $Path -match '\\(?:\.{1,2}|[^\\]*[. ])(?:\\|$)' -or
        -not [string]::Equals([IO.Path]::GetFullPath($Path), $Path, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Setup 'UNSAFE_PATH'
    }
    $cursor = [IO.Path]::GetPathRoot($Path)
    foreach ($part in $Path.Substring($cursor.Length).Split('\')) {
        $cursor = [IO.Path]::Combine($cursor, $part)
        try { $attributes = [IO.File]::GetAttributes($cursor) }
        catch [IO.FileNotFoundException] { continue }
        catch [IO.DirectoryNotFoundException] { continue }
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Setup 'REPARSE_POINT_REFUSED' }
    }
}

function New-PrivateAcl([bool] $Directory) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($Directory) {
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
        $acl = [Security.AccessControl.FileSecurity]::new()
        $inheritance = [Security.AccessControl.InheritanceFlags]::None
    }
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
        [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    return $acl
}

function Assert-PrivateAcl([string] $Path) {
    Assert-SafePath $Path
    if ([IO.Directory]::Exists($Path)) { $acl = [IO.Directory]::GetAccessControl($Path) }
    else { $acl = [IO.File]::GetAccessControl($Path) }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -eq 0) {
        Stop-Setup 'UNSAFE_EXISTING_ACL'
    }
    foreach ($rule in $rules) {
        if ($rule.IdentityReference.Value -ne $sid.Value -or
            $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { Stop-Setup 'UNSAFE_EXISTING_ACL' }
    }
}

function Ensure-PrivateDirectory([string] $Path) {
    Assert-SafePath $Path
    if ([IO.Directory]::Exists($Path)) {
        Assert-PrivateAcl $Path
        return
    }
    if ([IO.File]::Exists($Path)) { Stop-Setup 'UNSAFE_PATH' }
    # Apply an ACL only while creating our directory; never repair an unknown existing ACL.
    $directory = [IO.DirectoryInfo]::new($Path)
    $directory.Create((New-PrivateAcl $true))
    Assert-PrivateAcl $Path
}

function Save-Profile([string] $Path, $Scope, [string] $Password) {
    Assert-SafePath $Path
    Assert-PrivateAcl ([IO.Path]::GetDirectoryName($Path))
    if ([IO.File]::Exists($Path) -or [IO.Directory]::Exists($Path)) { Stop-Setup 'PROFILE_EXISTS' }
    if ([string]::IsNullOrWhiteSpace($Password) -or $Password.Length -gt 512 -or $Password -match '[\x00-\x1f\x7f]') {
        Stop-Setup 'INVALID_CLIENT_PASSWORD'
    }
    $plain = $null
    $json = $null
    $payload = $null
    $stream = $null
    try {
        $payload = [ordered]@{ version = 1; provider = 'alimail'; account = $Scope.account; folder = $Scope.folder; authorizedFrom = $Scope.authorizedFrom; password = $Password }
        $json = ConvertTo-Json -InputObject $payload -Compress
        $plain = [Text.Encoding]::UTF8.GetBytes($json)
        $entropy = [Text.Encoding]::ASCII.GetBytes('HRM-Recruitment-Mail-v1')
        $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        # CreateNew is the final race-safe no-replacement check; only ciphertext reaches disk.
        $stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write,
            [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough, (New-PrivateAcl $false))
        $stream.Write($cipher, 0, $cipher.Length)
        $stream.Flush($true)
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
        $Password = $null
        $payload = $null
        $json = $null
    }
    Assert-PrivateAcl $Path
}

function Get-TestPath([string] $Requested, $Scope) {
    $temp = [IO.Path]::GetTempPath().TrimEnd('\')
    Assert-SafePath $temp
    if ([string]::IsNullOrEmpty($Requested)) {
        $root = [IO.Path]::Combine($temp, 'hrm-recruitment-mail-selftest-' + [Guid]::NewGuid().ToString('N'))
        $Requested = [IO.Path]::Combine($root, (Get-ProfileName $Scope))
    }
    $root = [IO.Path]::GetDirectoryName($Requested)
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($root), $temp, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($root) -cnotmatch '^hrm-recruitment-mail-selftest-[a-f0-9]{32}$' -or
        [IO.Path]::GetFileName($Requested) -cne (Get-ProfileName $Scope) -or
        [IO.Directory]::Exists($root) -or [IO.File]::Exists($root)) { Stop-Setup 'UNSAFE_TEST_PATH' }
    Assert-SafePath $Requested
    return $Requested
}

function Assert-Check([bool] $Passed) {
    if (-not $Passed) { Stop-Setup 'SELF_TEST_FAILED' }
}

function Assert-Refused([scriptblock] $Action, [string] $Code) {
    $refused = $false
    try { & $Action } catch { $refused = $script:FailureCode -eq $Code }
    Assert-Check $refused
    $script:FailureCode = 'LOCAL_PROFILE_SETUP_FAILED'
}

function Invoke-OfflineSelfTest([string] $Requested) {
    $scope = Get-Scope 'fixture@example.invalid' 'Recruitment fixture' '2037-01-01T00:00:00Z'
    $path = Get-TestPath $Requested $scope
    $root = [IO.Path]::GetDirectoryName($path)
    Ensure-PrivateDirectory $root
    try {
        foreach ($bad in @('', 'display <a@example.invalid>', 'a@example.invalid ', 'a..b@example.invalid', 'a.@example.invalid', ('a' * 65 + '@example.invalid'), 'a@-example.invalid', "a`n@example.invalid")) {
            Assert-Refused { Get-Scope $bad 'Recruitment fixture' '' } 'INVALID_ACCOUNT'
        }
        foreach ($bad in @('', ' ', '.', '..', '../escape', 'a\b', 'Recruitment ', "a`nb")) {
            Assert-Refused { Get-Scope 'fixture@example.invalid' $bad '' } 'INVALID_FOLDER'
        }
        foreach ($bad in @(' ', '2037-01-01', '2037-01-01T00:00:00+00:00', '2037-02-30T00:00:00Z', '2037-01-01T00:00:00z')) {
            Assert-Refused { Get-Scope 'fixture@example.invalid' 'Recruitment fixture' $bad } 'INVALID_UTC_START'
        }
        $before = [DateTime]::UtcNow.AddSeconds(-1)
        $default = Get-Scope 'Fixture@Example.Invalid' 'Recruitment fixture' ''
        Assert-Check ($default.account -ceq 'fixture@example.invalid' -and [DateTimeOffset]::Parse($default.authorizedFrom).UtcDateTime -ge $before -and
            [DateTimeOffset]::Parse($default.authorizedFrom).UtcDateTime -le [DateTime]::UtcNow)
        $fractional = Get-Scope 'fixture@example.invalid' 'Recruitment fixture' '2037-01-01T01:02:03.1234567Z'
        Assert-Check ($fractional.authorizedFrom -ceq '2037-01-01T01:02:03.1234567Z')
        $nfc = Get-Scope 'Fixture@Example.Invalid' ('r' + [char]0x00e9) ''
        $nfd = Get-Scope 'fixture@example.invalid' ('re' + [char]0x0301) ''
        Assert-Check ((Get-ProfileName $nfc) -ceq (Get-ProfileName $nfd))
        Assert-Check ((Get-ProfileName $scope) -ceq (Get-ProfileName $default))
        Assert-Check ((Get-ProfileName $scope) -cmatch '^[a-f0-9]{64}\.json\.dpapi$')
        Assert-Refused { Get-TestPath ([IO.Path]::Combine($root, 'other.json.dpapi')) $scope } 'UNSAFE_TEST_PATH'
        Assert-Refused { Assert-SafePath ($root + '\..\escape') } 'UNSAFE_PATH'
        Assert-Refused { Assert-SafePath ($path + ':stream') } 'UNSAFE_PATH'
        Assert-Refused { Save-Profile $path $scope ('x' * 513) } 'INVALID_CLIENT_PASSWORD'
        Save-Profile $path $default 'fictional-client-password-for-offline-selftest'
        $cipher = [IO.File]::ReadAllBytes($path)
        $entropy = [Text.Encoding]::ASCII.GetBytes('HRM-Recruitment-Mail-v1')
        $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try {
            $decoded = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
            Assert-Check ($decoded.version -eq 1 -and $decoded.provider -ceq 'alimail' -and
                $decoded.account -ceq $default.account -and $decoded.folder -ceq $default.folder -and
                $decoded.authorizedFrom -ceq $default.authorizedFrom -and
                $decoded.password -ceq 'fictional-client-password-for-offline-selftest')
        } finally { [Array]::Clear($plain, 0, $plain.Length); $decoded = $null }
        Assert-PrivateAcl $path
        Assert-Check ([IO.Directory]::GetAccessControl($root).AreAccessRulesProtected -and [IO.File]::GetAccessControl($path).AreAccessRulesProtected)
        Ensure-PrivateDirectory $root
        $inherited = [IO.Path]::Combine($root, 'inherited')
        $null = [IO.Directory]::CreateDirectory($inherited)
        Assert-PrivateAcl $inherited
        Assert-Refused { Save-Profile $path $scope 'fictional-replacement' } 'PROFILE_EXISTS'
        Assert-Check ([Convert]::ToBase64String($cipher) -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)))
        $unsafe = [IO.Path]::Combine($root, 'unsafe')
        Ensure-PrivateDirectory $unsafe
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $world = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($world, 'Read', 'Allow'))
        [IO.Directory]::SetAccessControl($unsafe, $acl)
        $sddl = [IO.Directory]::GetAccessControl($unsafe).GetSecurityDescriptorSddlForm('All')
        Assert-Refused { Ensure-PrivateDirectory $unsafe } 'UNSAFE_EXISTING_ACL'
        Assert-Check ([IO.Directory]::GetAccessControl($unsafe).GetSecurityDescriptorSddlForm('All') -ceq $sddl)
        $junction = [IO.Path]::Combine($root, 'junction')
        Import-Module ([IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1'))
        $null = New-Item -ItemType Junction -Path $junction -Target $unsafe
        try { Assert-Refused { Assert-SafePath $junction } 'REPARSE_POINT_REFUSED' }
        finally { [IO.Directory]::Delete($junction) }
    } finally {
        # Delete only known fixture entries, never recursively traverse a supplied path.
        Assert-SafePath $root
        if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
        $unsafe = [IO.Path]::Combine($root, 'unsafe')
        if ([IO.Directory]::Exists($unsafe)) { Assert-SafePath $unsafe; [IO.Directory]::Delete($unsafe) }
        $inherited = [IO.Path]::Combine($root, 'inherited')
        if ([IO.Directory]::Exists($inherited)) { Assert-SafePath $inherited; [IO.Directory]::Delete($inherited) }
        [IO.Directory]::Delete($root)
    }
    return [ordered]@{ status = 'selfTestPassed'; profilePath = $path; fixtureRemoved = $true; checks = @(
        'validation', 'utcDefault', 'stableFilename', 'testPathOnly', 'dpapiRoundTrip',
        'privateAcl', 'overwriteRefused', 'unsafeDirectoryRefused', 'reparseRefused') }
}

function U([string] $Text) { return [Regex]::Unescape($Text) }

function New-FormLabel([string] $Text) {
    $label = [Windows.Forms.Label]::new()
    $label.AutoSize = $true
    $label.MaximumSize = [Drawing.Size]::new(640, 0)
    $label.Margin = [Windows.Forms.Padding]::new(0, 0, 0, 12)
    $label.Text = $Text
    return $label
}

function Show-SecretForm($Scope, [string] $Path) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $form = [Windows.Forms.Form]::new()
    # Runtime Chinese escapes keep this file safe for Windows PowerShell 5.1 without a BOM.
    $form.Text = U '\u62db\u8058\u90ae\u7bb1 - \u672c\u673a\u5b89\u5168\u914d\u7f6e'
    $form.AutoScaleDimensions = [Drawing.SizeF]::new(96, 96)
    $form.AutoScaleMode = 'Dpi'
    $form.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)
    $form.AutoSize = $true
    $form.AutoSizeMode = 'GrowAndShrink'
    $form.MinimumSize = [Drawing.Size]::new(700, 0)
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.StartPosition = 'CenterScreen'
    $content = [Windows.Forms.FlowLayoutPanel]::new()
    $content.FlowDirection = 'TopDown'
    $content.WrapContents = $false
    $content.AutoSize = $true
    $content.AutoSizeMode = 'GrowAndShrink'
    $content.Padding = [Windows.Forms.Padding]::new(20)
    $content.Dock = 'Fill'
    $label = New-FormLabel ((U '\u670d\u52a1\u5546\uff1a\u963f\u91cc\u90ae\u7bb1\uff08Alimail\uff09\n\u90ae\u7bb1\u8d26\u53f7\uff1a') + $Scope.account +
        (U '\n\u53ea\u8bfb\u6587\u4ef6\u5939\uff1a') + $Scope.folder + (U '\n\u6388\u6743\u8d77\u59cb\u65f6\u95f4\uff08UTC\uff09\uff1a') + $Scope.authorizedFrom)
    $help = New-FormLabel (U '\u90ae\u7bb1\u7f51\u9875\u767b\u5f55\u5bc6\u7801\u4e0d\u7528\u4fee\u6539\uff1b\u5728\u6b64\u7c98\u8d34\u5ba2\u6237\u7aef\u5b89\u5168\u5bc6\u7801\uff1b\n\u4ec5\u672c\u673a\u52a0\u5bc6\u4fdd\u5b58\uff0c\u4e0d\u4f1a\u81ea\u52a8\u8fde\u63a5\u90ae\u7bb1\u3002\n\u8bf7\u5728\u963f\u91cc\u90ae\u7bb1\u4e2d\u81ea\u884c\u751f\u6210\u6216\u590d\u7528\u5ba2\u6237\u7aef\u5b89\u5168\u5bc6\u7801\uff0c\u65e0\u9700\u5173\u95ed\u5b89\u5168\u9a8c\u8bc1\u3002')
    $secretLabel = New-FormLabel (U '\u5ba2\u6237\u7aef\u5b89\u5168\u5bc6\u7801')
    $secret = [Windows.Forms.TextBox]::new()
    $secret.Width = 640
    $secret.Margin = [Windows.Forms.Padding]::new(0, 0, 0, 12)
    $secret.MaxLength = 512
    $secret.UseSystemPasswordChar = $true
    $secret.AccessibleName = 'Dedicated client password'
    $hint = New-FormLabel (U '\u4ec5\u4f9b\u5f53\u524d Windows \u7528\u6237\u4f7f\u7528\uff1b\u4e0d\u4f1a\u66ff\u6362\u5df2\u6709\u914d\u7f6e\u3002\n\u53d6\u6d88\u4e0d\u4fdd\u5b58\u5bc6\u7801\u3002')
    $buttons = [Windows.Forms.FlowLayoutPanel]::new()
    $buttons.FlowDirection = 'RightToLeft'
    $buttons.WrapContents = $false
    $buttons.AutoSize = $true
    $buttons.Width = 640
    $save = [Windows.Forms.Button]::new()
    $save.Text = U '\u52a0\u5bc6\u4fdd\u5b58'
    $save.AutoSize = $true
    $save.Padding = [Windows.Forms.Padding]::new(12, 6, 12, 6)
    $save.DialogResult = 'OK'
    $cancel = [Windows.Forms.Button]::new()
    $cancel.Text = U '\u53d6\u6d88'
    $cancel.AutoSize = $true
    $cancel.Padding = [Windows.Forms.Padding]::new(12, 6, 12, 6)
    $cancel.DialogResult = 'Cancel'
    $buttons.Controls.AddRange([Windows.Forms.Control[]]@($cancel, $save))
    $content.Controls.AddRange([Windows.Forms.Control[]]@($label, $help, $secretLabel, $secret, $hint, $buttons))
    $form.Controls.Add($content)
    $form.AcceptButton = $save
    $form.CancelButton = $cancel
    try {
        if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return $false }
        Save-Profile $Path $Scope $secret.Text
        return $true
    } finally { $secret.Clear(); $form.Dispose() }
}

try {
    if ($env:OS -ne 'Windows_NT' -or $PSVersionTable.PSEdition -ne 'Desktop') { Stop-Setup 'WINDOWS_POWERSHELL_REQUIRED' }
    Add-Type -AssemblyName System.Security
    if ($SelfTest) {
        $metadata = Invoke-OfflineSelfTest $ProfilePath
    } else {
        if (-not [string]::IsNullOrEmpty($ProfilePath)) { Stop-Setup 'TEST_PATH_ONLY' }
        $scope = Get-Scope $Account $Folder $AuthorizedFrom
        if ([Environment]::GetCommandLineArgs() -match '^-NonI' -or -not [Environment]::UserInteractive) {
            Stop-Setup 'NONINTERACTIVE_FORM_REFUSED'
        }
        $root = [IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.codex\secrets\hrm-recruitment-mail')
        Assert-SafePath $root
        $path = [IO.Path]::Combine($root, (Get-ProfileName $scope))
        Assert-SafePath $path
        if ([IO.File]::Exists($path) -or [IO.Directory]::Exists($path)) { Stop-Setup 'PROFILE_EXISTS' }
        Ensure-PrivateDirectory $root
        if (-not (Show-SecretForm $scope $path)) {
            [Console]::Out.WriteLine('{"status":"cancelled"}')
            exit 2
        }
        $metadata = [ordered]@{ status = 'ready'; profilePath = $path }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $metadata -Compress))
    exit 0
} catch {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([ordered]@{ status = 'error'; code = $script:FailureCode }) -Compress))
    exit 1
}
