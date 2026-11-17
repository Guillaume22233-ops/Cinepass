<?php
// Ciné Codes — API (PHP 7.4+). Aucune base de données nécessaire.
session_start();
if (!is_file(__DIR__ . '/config.php')) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['error' => 'config.php manquant : copiez config.example.php en config.php']);
    exit;
}
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const DB_FILE = __DIR__ . '/data/db.php';
const DB_GUARD = "<?php exit; ?>\n";
const TYPES = ['cinecheque', 'pathe'];
const PDF_DIR = __DIR__ . '/data/pdf';
const PDF_MAX = 15 * 1024 * 1024; // 15 Mo
date_default_timezone_set('Europe/Paris');

function out($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Ouvre la base avec un verrou exclusif ; $fn(&$db) renvoie [résultat, aÉcrire]. */
function with_db(callable $fn) {
    $dir = dirname(DB_FILE);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = @fopen(DB_FILE, 'c+');
    if (!$fp) out(['error' => 'Impossible d\'écrire dans le dossier data/'], 500);
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    if (strpos($raw, DB_GUARD) === 0) $raw = substr($raw, strlen(DB_GUARD));
    $db = $raw ? json_decode($raw, true) : null;
    if (!is_array($db)) $db = ['profiles' => DEFAULT_PROFILES, 'codes' => []];
    [$result, $write] = $fn($db);
    if ($write) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, DB_GUARD . json_encode($db, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return $result;
}

/** Réglages de paiement (prix, numéro Wero), avec valeurs par défaut. */
function pay_settings($db) {
    $p = $db['pay'] ?? [];
    return [
        'price' => ['cinecheque' => (float)($p['price']['cinecheque'] ?? 3.80), 'pathe' => (float)($p['price']['pathe'] ?? 6.90)],
        'full'  => ['cinecheque' => (float)($p['full']['cinecheque'] ?? 9.95), 'pathe' => (float)($p['full']['pathe'] ?? 16.50)],
        'phone' => (string)($p['phone'] ?? ''),
    ];
}
/** Prix d'un code pris : celui enregistré au moment de la réservation, sinon le prix actuel. */
function code_price($c, $pay) { return isset($c['price']) ? (float)$c['price'] : $pay['price'][$c['type']]; }

/** Date d'expiration (facultative) : une place expirée n'est plus proposée. */
function clean_date($v) { $v = trim((string)$v); return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null; }
function is_expired($c) { return !empty($c['expires']) && $c['expires'] < date('Y-m-d'); }
function is_available($c) { return !$c['taken'] && !is_expired($c); }
function avail_count($db, $type) {
    $n = 0;
    foreach ($db['codes'] as $c) if ($c['type'] === $type && is_available($c)) $n++;
    return $n;
}

/** Réglages du site : e-mail d'alerte et liens vers les programmes des cinémas. */
function site_settings($db) {
    $s = $db['site'] ?? [];
    return ['email' => (string)($s['email'] ?? ''), 'links' => array_values($s['links'] ?? []), 'alertSent' => $s['alertSent'] ?? []];
}
/** L'alerte « dernière place » est envoyée une seule fois ; elle se réarme quand le stock repasse au-dessus d'une place. */
function rearm_alerts(&$db) {
    foreach (TYPES as $t) if (avail_count($db, $t) > 1) $db['site']['alertSent'][$t] = false;
}
function send_mail($to, $subject, $body) {
    $host = preg_replace('/:\d+$/', '', preg_replace('/^www\./', '', $_SERVER['HTTP_HOST'] ?? 'localhost'));
    $headers = "From: Cine Codes <noreply@$host>\r\nContent-Type: text/plain; charset=utf-8\r\n";
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}
const TYPE_LABELS = ['cinecheque' => 'CinéChèque', 'pathe' => 'Pathé'];

function need_login() { if (empty($_SESSION['ok'])) out(['error' => 'auth'], 401); }
function need_admin() { need_login(); if (empty($_SESSION['admin'])) out(['error' => 'admin'], 403); }

$in = json_decode(file_get_contents('php://input'), true) ?: [];
$a = $_GET['a'] ?? '';

switch ($a) {

case 'session':
    out(['ok' => !empty($_SESSION['ok']), 'profile' => $_SESSION['profile'] ?? null, 'admin' => !empty($_SESSION['admin'])]);

case 'login':
    if (is_string($in['password'] ?? null) && hash_equals(SITE_PASSWORD, $in['password'])) {
        session_regenerate_id(true);
        $_SESSION['ok'] = true;
        out(['ok' => true]);
    }
    sleep(1); // freine les essais en rafale
    out(['error' => 'Mot de passe incorrect'], 401);

case 'logout':
    $_SESSION = [];
    session_destroy();
    out(['ok' => true]);

case 'profiles':
    need_login();
    out(['profiles' => with_db(function (&$db) { return [$db['profiles'], false]; })]);

case 'select':
    need_login();
    $p = $in['profile'] ?? '';
    $profiles = with_db(function (&$db) { return [$db['profiles'], false]; });
    if (!in_array($p, $profiles, true)) out(['error' => 'Profil inconnu'], 400);
    $_SESSION['profile'] = $p;
    out(['ok' => true]);

case 'state':
    need_login();
    $me = $_SESSION['profile'] ?? null;
    out(with_db(function (&$db) use ($me) {
        $counts = array_fill_keys(TYPES, 0);
        $mine = [];
        foreach ($db['codes'] as $c) {
            if (is_available($c)) $counts[$c['type']]++;
            elseif ($c['taken'] && $me !== null && $c['takenBy'] === $me) $mine[] = $c;
        }
        usort($mine, function ($x, $y) { return $y['takenAt'] <=> $x['takenAt']; });
        $pay = pay_settings($db);
        $owed = 0; $saved = 0;
        foreach ($mine as &$m) {
            $m['price'] = code_price($m, $pay);
            if (empty($m['paid'])) $owed += $m['price'];
            $saved += max(0, $pay['full'][$m['type']] - $m['price']);
        }
        return [['counts' => $counts, 'mine' => $mine, 'profile' => $me, 'admin' => !empty($_SESSION['admin']),
                 'owed' => round($owed, 2), 'saved' => round($saved, 2), 'pay' => $pay,
                 'links' => site_settings($db)['links']], false];
    }));

case 'claim':
    need_login();
    $me = $_SESSION['profile'] ?? null;
    $type = $in['type'] ?? '';
    if (!$me) out(['error' => 'Choisissez un profil'], 400);
    if (!in_array($type, TYPES, true)) out(['error' => 'Type inconnu'], 400);
    $alert = null;
    $code = with_db(function (&$db) use ($me, $type, &$alert) {
        // On donne d'abord la place qui expire le plus tôt (sans date = en dernier), puis la plus ancienne.
        $best = null;
        foreach ($db['codes'] as $i => $c) {
            if ($c['type'] !== $type || !is_available($c)) continue;
            $key = [($c['expires'] ?? '') ?: '9999-12-31', $c['addedAt'] ?? 0];
            if ($best === null || $key < $best[0]) $best = [$key, $i];
        }
        if ($best === null) return [null, false];
        $c = &$db['codes'][$best[1]];
        $c['taken'] = true;
        $c['takenBy'] = $me;
        $c['takenAt'] = time() * 1000;
        $c['price'] = pay_settings($db)['price'][$type];
        $c['paid'] = false;
        $taken = $c;
        $site = site_settings($db);
        $left = avail_count($db, $type);
        if ($left <= 1 && $site['email'] !== '' && empty($site['alertSent'][$type])) {
            $db['site']['alertSent'][$type] = true;
            $alert = [$site['email'], $left];
        }
        return [$taken, true];
    });
    if (!$code) out(['error' => 'Plus de place disponible'], 409);
    if ($alert) {
        [$to, $left] = $alert;
        $label = TYPE_LABELS[$type];
        $msg = $left === 1 ? "Il ne reste plus qu'une seule place $label sur Ciné Codes." : "Il n'y a plus aucune place $label sur Ciné Codes.";
        send_mail($to, "Ciné Codes : plus qu'une place $label", "$msg\n\nDernière place prise par : $me.\n\nPense à en racheter si besoin 🙂\n\n(Ce message n'est envoyé qu'une fois, jusqu'au prochain réapprovisionnement.)");
    }
    out(['code' => $code]);

case 'my_paid':
    // Fonctionne à la confiance : chacun marque lui-même ses places comme remboursées (ou annule).
    need_login();
    $me = $_SESSION['profile'] ?? null;
    if (!$me) out(['error' => 'Choisissez un profil'], 400);
    $id = $in['id'] ?? null;
    $all = !empty($in['all']);
    $paid = array_key_exists('paid', $in) ? (bool)$in['paid'] : true;
    $n = with_db(function (&$db) use ($me, $id, $all, $paid) {
        $n = 0; $now = time() * 1000;
        foreach ($db['codes'] as &$c) {
            if (!$c['taken'] || $c['takenBy'] !== $me) continue;
            if (!$all && $c['id'] !== $id) continue;
            if ($all && !empty($c['paid'])) continue;
            $c['paid'] = $paid; $c['paidAt'] = $paid ? $now : null; $n++;
        }
        return [$n, $n > 0];
    });
    out(['ok' => true, 'changed' => $n]);

case 'films':
    need_login();
    if (!defined('TMDB_KEY') || TMDB_KEY === '') out(['films' => []]);
    $cache = __DIR__ . '/data/films.php';
    if (is_file($cache) && time() - filemtime($cache) < 6 * 3600) {
        $raw = substr(file_get_contents($cache), strlen(DB_GUARD));
        out(['films' => json_decode($raw, true) ?: []]);
    }
    $long = strlen(TMDB_KEY) > 40; // jeton v4 (Bearer) ou clé v3
    $url = 'https://api.themoviedb.org/3/movie/now_playing?language=fr-FR&region=FR&page=1'
         . ($long ? '' : '&api_key=' . urlencode(TMDB_KEY));
    $body = false;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
            CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $long ? ['Authorization: Bearer ' . TMDB_KEY] : [])]);
        $body = curl_exec($ch);
        if (curl_getinfo($ch, CURLINFO_HTTP_CODE) !== 200) $body = false;
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => 8,
            'header' => "Accept: application/json\r\n" . ($long ? 'Authorization: Bearer ' . TMDB_KEY . "\r\n" : '')]]);
        $body = @file_get_contents($url, false, $ctx);
    }
    $data = $body ? json_decode($body, true) : null;
    if (!$data || empty($data['results'])) {
        // En cas d'échec, on garde l'ancienne liste si elle existe
        if (is_file($cache)) out(['films' => json_decode(substr(file_get_contents($cache), strlen(DB_GUARD)), true) ?: []]);
        out(['films' => []]);
    }
    $res = $data['results'];
    usort($res, function ($x, $y) { return ($y['popularity'] ?? 0) <=> ($x['popularity'] ?? 0); });
    $films = [];
    foreach (array_slice($res, 0, 12) as $m) {
        $films[] = [
            'title'    => $m['title'] ?? '',
            'date'     => $m['release_date'] ?? null,
            'note'     => isset($m['vote_average']) && $m['vote_count'] > 20 ? round($m['vote_average'], 1) : null,
            'overview' => $m['overview'] ?? '',
            'poster'   => !empty($m['poster_path']) ? 'https://image.tmdb.org/t/p/w342' . $m['poster_path'] : null,
        ];
    }
    @file_put_contents($cache, DB_GUARD . json_encode($films, JSON_UNESCAPED_UNICODE));
    out(['films' => $films]);

case 'pdf':
    // Le PDF n'est accessible qu'au profil qui a réservé la place, ou à l'admin.
    need_login();
    $id = (string)($_GET['id'] ?? '');
    $me = $_SESSION['profile'] ?? null;
    $isAdmin = !empty($_SESSION['admin']);
    $c = with_db(function (&$db) use ($id) {
        foreach ($db['codes'] as $c) if ($c['id'] === $id) return [$c, false];
        return [null, false];
    });
    $path = ($c && !empty($c['file'])) ? PDF_DIR . '/' . basename($c['file']) : null;
    if (!$path || !is_file($path) || !($isAdmin || ($c['taken'] && $c['takenBy'] === $me))) {
        header('Content-Type: text/plain; charset=utf-8');
        http_response_code(404);
        echo 'Place introuvable.';
        exit;
    }
    $label = ['cinecheque' => 'CineCheque', 'pathe' => 'Pathe'][$c['type']] ?? 'Place';
    $fname = $label . '-' . trim(preg_replace('/[^A-Za-z0-9_-]+/', '-', $c['code']), '-') . '.pdf';
    header('Content-Type: application/pdf');
    header('Content-Disposition: ' . (isset($_GET['dl']) ? 'attachment' : 'inline') . '; filename="' . $fname . '"');
    header('Content-Length: ' . filesize($path));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    readfile($path);
    exit;

// ---------- Gestion ----------
case 'admin_login':
    need_login();
    if (is_string($in['password'] ?? null) && hash_equals(ADMIN_PASSWORD, $in['password'])) {
        $_SESSION['admin'] = true;
        out(['ok' => true]);
    }
    sleep(1);
    out(['error' => 'Mot de passe incorrect'], 401);

case 'admin_state':
    need_admin();
    out(with_db(function (&$db) {
        $pay = pay_settings($db);
        $codes = $db['codes'];
        foreach ($codes as &$c) if ($c['taken']) $c['price'] = code_price($c, $pay);
        $site = site_settings($db);
        return [['codes' => $codes, 'profiles' => $db['profiles'], 'pay' => $pay, 'site' => $site, 'today' => date('Y-m-d')], false];
    }));

case 'admin_paid':      // marque comme réglés tous les codes d'un profil
case 'admin_toggle_paid': // inverse l'état « réglé » d'un code
    need_admin();
    $profile = $in['profile'] ?? null;
    $id = $in['id'] ?? null;
    with_db(function (&$db) use ($a, $profile, $id) {
        $now = time() * 1000;
        foreach ($db['codes'] as &$c) {
            if (!$c['taken']) continue;
            if ($a === 'admin_paid' && $c['takenBy'] === $profile && empty($c['paid'])) { $c['paid'] = true; $c['paidAt'] = $now; }
            if ($a === 'admin_toggle_paid' && $c['id'] === $id) { $c['paid'] = empty($c['paid']); $c['paidAt'] = $c['paid'] ? $now : null; }
        }
        return [null, true];
    });
    out(['ok' => true]);

case 'admin_pay_settings':
    need_admin();
    $num = function ($v) { $v = (float)str_replace(',', '.', (string)$v); return ($v >= 0 && $v < 1000) ? round($v, 2) : null; };
    $price = ['cinecheque' => $num($in['price']['cinecheque'] ?? ''), 'pathe' => $num($in['price']['pathe'] ?? '')];
    $full  = ['cinecheque' => $num($in['full']['cinecheque'] ?? ''),  'pathe' => $num($in['full']['pathe'] ?? '')];
    if (in_array(null, $price, true) || in_array(null, $full, true)) out(['error' => 'Prix invalides'], 400);
    $phone = mb_substr(trim((string)($in['phone'] ?? '')), 0, 30);
    with_db(function (&$db) use ($price, $full, $phone) {
        $db['pay'] = ['price' => $price, 'full' => $full, 'phone' => $phone];
        return [null, true];
    });
    out(['ok' => true]);

case 'admin_site_settings':
    need_admin();
    $email = trim((string)($in['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) out(['error' => 'Adresse e-mail invalide'], 400);
    $links = [];
    foreach (($in['links'] ?? []) as $l) {
        $name = mb_substr(trim((string)($l['name'] ?? '')), 0, 40);
        $url = trim((string)($l['url'] ?? ''));
        if ($name === '' && $url === '') continue;
        if ($name === '' || !preg_match('#^https?://#i', $url) || !filter_var($url, FILTER_VALIDATE_URL)) out(['error' => "Lien invalide : « $name » (l'adresse doit commencer par https://)"], 400);
        $links[] = ['name' => $name, 'url' => $url];
        if (count($links) >= 12) break;
    }
    with_db(function (&$db) use ($email, $links) {
        $db['site']['email'] = $email;
        $db['site']['links'] = $links;
        return [null, true];
    });
    out(['ok' => true]);

case 'admin_test_mail':
    need_admin();
    $email = with_db(function (&$db) { return [site_settings($db)['email'], false]; });
    if ($email === '') out(['error' => "Enregistrez d'abord une adresse e-mail"], 400);
    $ok = send_mail($email, 'Ciné Codes : e-mail de test', "Si vous lisez ce message, les alertes « dernière place » de Ciné Codes fonctionnent 🎟️");
    out($ok ? ['ok' => true] : ['error' => "Le serveur n'a pas pu envoyer l'e-mail"], $ok ? 200 : 500);

case 'admin_set_expiry':
    need_admin();
    $id = $in['id'] ?? '';
    $exp = clean_date($in['expires'] ?? '');
    with_db(function (&$db) use ($id, $exp) {
        foreach ($db['codes'] as &$c) if ($c['id'] === $id) { $c['expires'] = $exp; break; }
        rearm_alerts($db);
        return [null, true];
    });
    out(['ok' => true]);

case 'admin_add':
    need_admin();
    $type = $in['type'] ?? '';
    $list = $in['codes'] ?? [];
    if (!in_array($type, TYPES, true) || !is_array($list)) out(['error' => 'Requête invalide'], 400);
    $exp = clean_date($in['expires'] ?? '');
    $added = with_db(function (&$db) use ($type, $list, $exp) {
        $seen = [];
        foreach ($db['codes'] as $c) $seen[$c['type'] . '|' . $c['code']] = true;
        $n = 0;
        $t = time() * 1000;
        foreach ($list as $code) {
            $code = trim((string)$code);
            if ($code === '' || mb_strlen($code) > 200 || isset($seen[$type . '|' . $code])) continue;
            $seen[$type . '|' . $code] = true;
            $db['codes'][] = ['id' => bin2hex(random_bytes(6)), 'type' => $type, 'code' => $code, 'expires' => $exp,
                              'taken' => false, 'takenBy' => null, 'takenAt' => null, 'addedAt' => $t + $n];
            $n++;
        }
        rearm_alerts($db);
        return [$n, $n > 0];
    });
    out(['added' => $added]);

case 'admin_upload':
    need_admin();
    $type = $_POST['type'] ?? '';
    if (!in_array($type, TYPES, true)) out(['error' => 'Type inconnu'], 400);
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) out(['error' => 'Envoi échoué (fichier trop lourd ?)'], 400);
    if ($f['size'] > PDF_MAX) out(['error' => 'PDF trop lourd (15 Mo max)'], 400);
    if (file_get_contents($f['tmp_name'], false, null, 0, 5) !== '%PDF-') out(['error' => "Ce fichier n'est pas un PDF"], 400);
    if (!is_dir(PDF_DIR)) @mkdir(PDF_DIR, 0755, true);
    $hash = sha1_file($f['tmp_name']);
    $label = mb_substr(preg_replace('/\.pdf$/i', '', basename($f['name'])), 0, 120);
    $exp = clean_date($_POST['expires'] ?? '');
    $res = with_db(function (&$db) use ($type, $f, $hash, $label, $exp) {
        foreach ($db['codes'] as $c) if (($c['hash'] ?? null) === $hash) return [['dup' => true], false];
        $id = bin2hex(random_bytes(8));
        if (!move_uploaded_file($f['tmp_name'], PDF_DIR . "/$id.pdf")) return [['error' => "Impossible d'enregistrer le PDF (dossier data/)"], false];
        $db['codes'][] = ['id' => $id, 'type' => $type, 'code' => $label, 'file' => "$id.pdf", 'hash' => $hash, 'expires' => $exp,
                          'taken' => false, 'takenBy' => null, 'takenAt' => null, 'addedAt' => (int)(microtime(true) * 1000)];
        rearm_alerts($db);
        return [['ok' => true], true];
    });
    if (isset($res['error'])) out($res, 500);
    out($res);

case 'admin_delete':
case 'admin_restore':
    need_admin();
    $id = $in['id'] ?? '';
    with_db(function (&$db) use ($id, $a) {
        foreach ($db['codes'] as $i => &$c) {
            if ($c['id'] !== $id) continue;
            if ($a === 'admin_delete') { if (!empty($c['file'])) @unlink(PDF_DIR . '/' . basename($c['file'])); array_splice($db['codes'], $i, 1); }
            else { $c['taken'] = false; $c['takenBy'] = null; $c['takenAt'] = null; unset($c['price'], $c['paid'], $c['paidAt']); rearm_alerts($db); }
            return [null, true];
        }
        return [null, false];
    });
    out(['ok' => true]);

case 'admin_profiles':
    need_admin();
    $p = $in['profiles'] ?? [];
    if (!is_array($p) || count($p) < 1 || count($p) > 8) out(['error' => 'Liste invalide'], 400);
    $p = array_values(array_map(function ($x) { return mb_substr(trim((string)$x), 0, 24); }, $p));
    if (in_array('', $p, true) || count(array_unique($p)) !== count($p)) out(['error' => 'Noms vides ou en double'], 400);
    $map = [];
    with_db(function (&$db) use ($p, &$map) {
        // Les codes déjà pris suivent le nouveau nom du profil
        foreach ($db['profiles'] as $i => $old) if (isset($p[$i])) $map[$old] = $p[$i];
        foreach ($db['codes'] as &$c) if ($c['takenBy'] !== null && isset($map[$c['takenBy']])) $c['takenBy'] = $map[$c['takenBy']];
        $db['profiles'] = $p;
        return [null, true];
    });
    if (isset($_SESSION['profile'], $map[$_SESSION['profile']])) $_SESSION['profile'] = $map[$_SESSION['profile']];
    if (isset($_SESSION['profile']) && !in_array($_SESSION['profile'], $p, true)) unset($_SESSION['profile']);
    out(['ok' => true]);

default:
    out(['error' => 'Action inconnue'], 404);
}
