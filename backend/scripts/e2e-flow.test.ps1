$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000'
$cookie = @{}
$sess = @{}
function Req($method, $path, $who, $bodyObj) {
    $headers = @{}
    if ($cookie[$who]) { $headers['Cookie'] = $cookie[$who] }
    $json = if ($null -ne $bodyObj) { $bodyObj | ConvertTo-Json -Depth 5 -Compress } else { $null }
    $params = @{ UseBasicParsing = $true; Method = $method; Uri = "$base$path"; ContentType = 'application/json'; Headers = $headers }
    if ($json) { $params.Body = $json }
    if ($sess[$who]) { $params.WebSession = $sess[$who] } else { $params.SessionVariable = 'newSession' }
    try {
        $r = Invoke-WebRequest @params
        if (-not $sess[$who]) { $sess[$who] = $newSession }
    } catch {
        $resp = $_.Exception.Response
        $content = ''
        if ($resp) { $sr = New-Object IO.StreamReader($resp.GetResponseStream()); $content = $sr.ReadToEnd() }
        $status = if ($resp) { [int]$resp.StatusCode } else { 0 }
        $r = [pscustomobject]@{ StatusCode = $status; Content = $content; Headers = @{} }
    }
    return $r
}
function J($r) { if ($r.Content) { $r.Content | ConvertTo-Json -Depth 8 -Compress } else { '(no body)' } }
function Check($name, $cond) { if ($cond) { Write-Output "PASS $name" } else { Write-Output "FAIL $name"; $script:failed = $true } }
$script:failed = $false
$ts = Get-Random -Maximum 99999

# --- users ---
$phoneBase = ($ts % 10000000).ToString('d7')
$r1 = Req 'POST' '/api/auth/register' 'buyer' @{ username = "t_buyer_$ts"; countryCode = 'UA'; phone = "67$phoneBase"; password = 'Passw0rd!2345'; passwordConfirmation = 'Passw0rd!2345' }
if ($r1.StatusCode -eq 409) { $r1 = Req 'POST' '/api/auth/login' 'buyer' @{ username = "t_buyer_$ts"; password = 'Passw0rd!2345' } }
Check "register buyer (200/201)" ($r1.StatusCode -in 200,201)

$r2 = Req 'POST' '/api/auth/register' 'seller' @{ username = "t_seller_$ts"; countryCode = 'UA'; phone = "68$phoneBase"; password = 'Passw0rd!2345'; passwordConfirmation = 'Passw0rd!2345' }
if ($r2.StatusCode -eq 409) { $r2 = Req 'POST' '/api/auth/login' 'seller' @{ username = "t_seller_$ts"; password = 'Passw0rd!2345' } }
Check "register seller (200/201)" ($r2.StatusCode -in 200,201)

# --- buy request (buyer) ---
$cats = (Req 'GET' '/api/categories' 'buyer' $null).Content | ConvertFrom-Json
$cat = $cats.categories[0].id
$rb = Req 'POST' '/api/buy-requests' 'buyer' @{ categoryId = $cat; title = "Тест запит $ts"; description = 'desc'; quantity = 10; unit = 'kg'; currency = 'UAH'; minPrice = 5; maxPrice = 20; delivery = 'yes'; geoArea = 'Київ'; latitude = 50.45; longitude = 30.52 }
Check "create buy request (201)" ($rb.StatusCode -eq 201)
$reqId = (($rb.Content | ConvertFrom-Json).buyRequest.id)

# --- offers (seller): two partial offers ---
$ro1 = Req 'POST' "/api/buy-requests/$reqId/offers" 'seller' @{ quantity = 4; unit = 'kg'; price = 10; currency = 'UAH'; delivery = 'Carrier delivery' }
Check "offer #1 created (201)" ($ro1.StatusCode -eq 201)
$off1 = (($ro1.Content | ConvertFrom-Json).offer.id)
$ro2 = Req 'POST' "/api/buy-requests/$reqId/offers" 'seller' @{ quantity = 6; unit = 'kg'; price = 12; currency = 'UAH'; delivery = 'Pickup' }
Check "offer #2 created (201)" ($ro2.StatusCode -eq 201)
$off2 = (($ro2.Content | ConvertFrom-Json).offer.id)

# buyer cannot offer on own request
$roBad = Req 'POST' "/api/buy-requests/$reqId/offers" 'buyer' @{ quantity = 1; unit = 'kg'; price = 10; currency = 'UAH'; delivery = 'x' }
Check "buyer cannot offer (403)" ($roBad.StatusCode -eq 403)

# --- accept both (buyer), partial fulfillment ---
$ra1 = Req 'POST' "/api/offers/$off1/accept" 'buyer' @{ quantity = 4 }
Check "accept offer#1 full (201)" ($ra1.StatusCode -eq 201)
$o1 = (($ra1.Content | ConvertFrom-Json).order.id)
$ra2 = Req 'POST' "/api/offers/$off2/accept" 'buyer' @{ quantity = 3 }
Check "accept offer#2 partial (201)" ($ra2.StatusCode -eq 201)
$o2 = (($ra2.Content | ConvertFrom-Json).order.id)

# over-accept should fail
$rover = Req 'POST' "/api/offers/$off2/accept" 'buyer' @{ quantity = 99 }
Check "over-accept rejected (409)" ($rover.StatusCode -eq 409)

# --- orders visible only to participants ---
$rlo = Req 'GET' '/api/orders' 'buyer' $null
$ids = ($rlo.Content | ConvertFrom-Json).orders | ForEach-Object { $_.id }
Check "buyer sees both orders" (($ids -contains $o1) -and ($ids -contains $o2))
$rls = Req 'GET' '/api/orders' 'seller' $null
$idsS = ($rls.Content | ConvertFrom-Json).orders | ForEach-Object { $_.id }
Check "seller sees both orders" (($idsS -contains $o1) -and ($idsS -contains $o2))

# third party excluded
$r3 = Req 'POST' '/api/auth/register' 'outsider' @{ username = "t_out_$ts"; countryCode = 'UA'; phone = "69$phoneBase"; password = 'Passw0rd!2345'; passwordConfirmation = 'Passw0rd!2345' }
if ($r3.StatusCode -eq 409) { $r3 = Req 'POST' '/api/auth/login' 'outsider' @{ username = "t_out_$ts"; password = 'Passw0rd!2345' } }
$roOut = Req 'GET' "/api/orders/$o1" 'outsider' $null
Check "outsider cannot read order (404)" ($roOut.StatusCode -eq 404)

# --- chat: only participants ---
$rc1 = Req 'GET' "/api/orders/$o1/conversation" 'buyer' $null
Check "buyer gets conversation (200)" ($rc1.StatusCode -eq 200)
$conv = (($rc1.Content | ConvertFrom-Json).conversation.id)
$rm = Req 'POST' "/api/conversations/$conv/messages" 'seller' @{ body = 'Hello, goods are ready' }
Check "seller posts message (201)" ($rm.StatusCode -eq 201)
$rmOut = Req 'POST' "/api/conversations/$conv/messages" 'outsider' @{ body = 'hack' }
Check "outsider cannot post (404)" ($rmOut.StatusCode -eq 404)
$rlmOut = Req 'GET' "/api/conversations/$conv/messages" 'outsider' $null
Check "outsider cannot read chat (404)" ($rlmOut.StatusCode -eq 404)
$rlm = Req 'GET' "/api/conversations/$conv/messages" 'buyer' $null
$msgs = ($rlm.Content | ConvertFrom-Json).messages
Check "buyer reads chat (1 msg)" ($rlm.StatusCode -eq 200 -and $msgs.Count -eq 1 -and $msgs[0].body -eq 'Hello, goods are ready')

# --- status transitions: accepted -> in_progress -> completed ---
$rs1 = Req 'PATCH' "/api/orders/$o1/status" 'seller' @{ status = 'in_progress' }
Check "seller: accepted->in_progress (200)" ($rs1.StatusCode -eq 200)
$rs2 = Req 'PATCH' "/api/orders/$o1/status" 'buyer' @{ status = 'completed' }
Check "buyer: in_progress->completed (200)" ($rs2.StatusCode -eq 200)

# --- illegal transitions via API ---
$rsBad1 = Req 'PATCH' "/api/orders/$o2/status" 'seller' @{ status = 'completed' }
Check "illegal accepted->completed rejected (409)" ($rsBad1.StatusCode -eq 409)
$rsBad2 = Req 'PATCH' "/api/orders/$o2/status" 'seller' @{ status = 'bogus_status' }
Check "invalid status value rejected (400)" ($rsBad2.StatusCode -eq 400)
$rsBad3 = Req 'PATCH' "/api/orders/$o1/status" 'seller' @{ status = 'accepted' }
Check "illegal completed->accepted rejected (409)" ($rsBad3.StatusCode -eq 409)
$rsBad4 = Req 'PATCH' "/api/orders/$o2/status" 'outsider' @{ status = 'in_progress' }
Check "outsider cannot change status (404)" ($rsBad4.StatusCode -eq 404)

# --- request state after partial fulfillment ---
$rr = Req 'GET' "/api/buy-requests/$reqId" 'buyer' $null
$br = ($rr.Content | ConvertFrom-Json).buyRequest
Write-Output "DEBUG request status=$($br.status) fulfilled=$($br.fulfilledQuantity)"
Check "request partially_fulfilled (7/10: 4+3)" ($br.status -eq 'partially_fulfilled' -and $br.fulfilledQuantity -eq 7)

if ($script:failed) { Write-Output 'RESULT: FAIL' } else { Write-Output 'RESULT: ALL PASS' }
