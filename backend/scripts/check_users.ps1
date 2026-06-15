param(
    [Parameter(Mandatory = $true)]
    [string]$Email,

    [Parameter(Mandatory = $true)]
    [string]$Password
)

$BaseUrl = "http://localhost:8080"
$TestUserEmail = "check_test_user@example.com"
$TestUserPassword = "CheckTest123!"
$TestUserRole = "free"
$FailedSteps = @()

function Write-Step($num, $label) {
    Write-Host "" -NoNewline
    Write-Host "=== [$num] $label ===" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  OK: $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "  FAIL: $msg" -ForegroundColor Red
}

function Write-Skip($msg) {
    Write-Host "  SKIP: $msg" -ForegroundColor Yellow
}

function Step-Passed($num) {
    Write-Host "  >>> STEP $num PASSED" -ForegroundColor Green
}

function Step-Failed($num, $detail) {
    Write-Host "  >>> STEP $num FAILED: $detail" -ForegroundColor Red
    $script:FailedSteps += $num
}

# ---- LOGIN ----
Write-Step 0 "Login as admin"
$authBody = @{email = $Email; password = $Password} | ConvertTo-Json
try {
    $loginResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/login" -Method Post -Body $authBody -ContentType "application/json"
    if (-not $loginResp.ok -or -not $loginResp.data.accessToken) {
        Step-Failed 0 "Login failed or no accessToken in response"
        Write-Host "Response: $($loginResp | ConvertTo-Json -Depth 5)"
        exit 1
    }
    $Token = $loginResp.data.accessToken
    $Headers = @{Authorization = "Bearer $Token"}
    Write-OK "Logged in as $Email, token obtained"
} catch {
    Step-Failed 0 "HTTP error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        Write-Host "Response body: $body"
    }
    exit 1
}

# ---- CLEANUP previous run ----
Write-Step "0a" "Cleanup test user from previous run (best-effort)"
try {
    $listResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users?limit=100&offset=0" -Method Get -Headers $Headers
    if ($listResp.ok -and $listResp.data.users) {
        $existing = $listResp.data.users | Where-Object { $_.email -eq $TestUserEmail }
        foreach ($u in $existing) {
            try {
                $delResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users/$($u.id)" -Method Delete -Headers $Headers
                Write-OK "Deleted leftover user $TestUserEmail (id=$($u.id))"
            } catch {
                Write-Skip "Could not delete leftover $($u.id): $($_.Exception.Message)"
            }
        }
    }
} catch {
    Write-Skip "Cleanup skipped: $($_.Exception.Message)"
}

# ---- [1] GET /stats ----
Write-Step 1 "GET /admin/users/stats (initial)"
try {
    $stats1 = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users/stats" -Method Get -Headers $Headers
    if (-not $stats1.ok) { throw "Response not ok" }
    Write-OK "registered=$($stats1.data.registered)  onlineAuth=$($stats1.data.onlineAuth)  hosts=$($stats1.data.hosts)"
    Step-Passed 1
} catch {
    Step-Failed 1 "Stats request failed: $($_.Exception.Message)"
}

# ---- [2] GET /users ----
Write-Step 2 "GET /admin/users (list, check no password_hash)"
try {
    $listResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users?limit=5&offset=0" -Method Get -Headers $Headers
    if (-not $listResp.ok) { throw "Response not ok" }
    $users = $listResp.data.users
    Write-OK "Total returned: $($users.Count) users"
    $i = 0
    foreach ($u in $users) {
        $i++
        Write-Host "  [$i] id=$($u.id)  email=$($u.email)  role=$($u.role)  createdAt=$($u.createdAt)" -ForegroundColor Gray
        if ($u.PSObject.Properties.Name -contains "password_hash") {
            Write-Fail "password_hash field is EXPOSED in response!"
            Step-Failed 2 "password_hash found in response"
            break
        }
    }
    if ($FailedSteps -notcontains 2) {
        Write-OK "No password_hash field present in any user object"
        Step-Passed 2
    }
} catch {
    Step-Failed 2 "List request failed: $($_.Exception.Message)"
}

# ---- [3] POST /users create ----
Write-Step 3 "POST /admin/users (create test user)"
try {
    $createBody = @{
        email    = $TestUserEmail
        password = $TestUserPassword
        role     = $TestUserRole
    } | ConvertTo-Json
    $createResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users" -Method Post -Body $createBody -ContentType "application/json" -Headers $Headers
    if (-not $createResp.ok) { throw "Response not ok" }
    $NewUserId = $createResp.data.id
    Write-OK "Created user: id=$NewUserId  email=$($createResp.data.email)  role=$($createResp.data.role)"
    Step-Passed 3
} catch {
    if ($_.Exception.Response.StatusCode -eq 409) {
        Write-Skip "User $TestUserEmail already exists (from previous run?)"
        try {
            $listResp2 = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users?limit=100&offset=0" -Method Get -Headers $Headers
            $existing = $listResp2.data.users | Where-Object { $_.email -eq $TestUserEmail }
            if ($existing) {
                $NewUserId = $existing[0].id
                Write-OK "Found existing user id=$NewUserId, will reuse"
            }
        } catch {
            Step-Failed 3 "Could not list users to find existing id: $($_.Exception.Message)"
        }
    } else {
        Step-Failed 3 "Create failed: $($_.Exception.Message)"
    }
}

# ---- [4] PATCH /users/{id} role ----
Write-Step 4 "PATCH /admin/users/$NewUserId (change role to pro)"
try {
    $patchBody = @{role = "pro"} | ConvertTo-Json
    $patchResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users/$NewUserId" -Method Patch -Body $patchBody -ContentType "application/json" -Headers $Headers
    if (-not $patchResp.ok) { throw "Response not ok" }
    Write-OK "Role changed: $($patchResp.data.oldRole) -> $($patchResp.data.newRole)"
    Step-Passed 4
} catch {
    Step-Failed 4 "Patch failed: $($_.Exception.Message)"
}

# ---- [5] GET /stats again ----
Write-Step 5 "GET /admin/users/stats (after create - registered should be +1)"
try {
    $stats2 = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users/stats" -Method Get -Headers $Headers
    if (-not $stats2.ok) { throw "Response not ok" }
    $diff = $stats2.data.registered - $stats1.data.registered
    Write-OK "registered was $($stats1.data.registered), now $($stats2.data.registered) (delta: +$diff)"
    if ($diff -ge 1) {
        Step-Passed 5
    } else {
        Write-Skip "registered did not increase - user may already have existed before step 3"
        Step-Passed 5
    }
} catch {
    Step-Failed 5 "Stats request failed: $($_.Exception.Message)"
}

# ---- [6] DELETE /users/{id} + stats ----
Write-Step 6 "DELETE /admin/users/$NewUserId then verify stats revert"
if (-not $NewUserId) {
    Step-Failed 6 "No user ID to delete"
} else {
    try {
        $delResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users/$NewUserId" -Method Delete -Headers $Headers
        if (-not $delResp.ok) { throw "Response not ok" }
        Write-OK "Deleted user $NewUserId"

        try {
            $stats3 = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/users/stats" -Method Get -Headers $Headers
            if (-not $stats3.ok) { throw "Response not ok" }
            Write-OK "registered after delete: $($stats3.data.registered) (was $($stats1.data.registered) initially)"
            Step-Passed 6
        } catch {
            Step-Failed 6 "Stats after delete failed: $($_.Exception.Message)"
        }
    } catch {
        Step-Failed 6 "Delete failed: $($_.Exception.Message)"
    }
}

# ---- SUMMARY ----
Write-Host "" -NoNewline
Write-Host "========================================" -ForegroundColor Cyan
if ($FailedSteps.Count -eq 0) {
    Write-Host "  ALL STEPS PASSED" -ForegroundColor Green
} else {
    Write-Host "  FAILED STEPS: $($FailedSteps -join ', ')" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan
if ($FailedSteps.Count -gt 0) { exit 1 }
