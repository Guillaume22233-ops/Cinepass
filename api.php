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
    return ['email' => (string)($s['email'] ?? ''), 'links' => array_values($s['links'] ?? []), 'alertSent' => $s['alertSent'] ?? [],
            'giftRate' => isset($s['giftRate']) ? (int)$s['giftRate'] : 10];
}
/** L'alerte « dernière place » est envoyée une seule fois ; elle se réarme quand le stock repasse au-dessus d'une place. */
function rearm_alerts(&$db) {
    foreach (TYPES as $t) if (avail_count($db, $t) > 1) $db['site']['alertSent'][$t] = false;
}
/** Envoie un e-mail texte, avec un PDF en pièce jointe si besoin. */
function send_mail($to, $subject, $body, $pdfPath = null, $pdfName = null) {
    $host = preg_replace('/:\d+$/', '', preg_replace('/^www\./', '', $_SERVER['HTTP_HOST'] ?? 'localhost'));
    $subject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    if (!$pdfPath) {
        $headers = "From: Cine Codes <noreply@$host>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n";
        return @mail($to, $subject, $body, $headers);
    }
    $b = 'cc' . bin2hex(random_bytes(8));
    $headers = "From: Cine Codes <noreply@$host>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"$b\"\r\n";
    $msg = "--$b\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n$body\r\n"
         . "--$b\r\nContent-Type: application/pdf; name=\"$pdfName\"\r\nContent-Transfer-Encoding: base64\r\n"
         . "Content-Disposition: attachment; filename=\"$pdfName\"\r\n\r\n"
         . chunk_split(base64_encode(file_get_contents($pdfPath))) . "\r\n--$b--\r\n";
    return @mail($to, $subject, $msg, $headers);
}
const COND_TEXT = [
    'cinecheque' => "Liste des cinémas affiliés : https://www.reseauxdecines.com/loc/ecinecheque.html\nÀ Rennes : TNB et Arvor.",
    'pathe'      => "Valable pour une séance standard. Tout supplément (3D, IMAX, 4DX…) est à régler en plus sur place.",
];
const TYPE_LABELS = ['cinecheque' => 'CinéChèque', 'pathe' => 'Pathé'];

/** Les affiches passent par notre serveur (api.php?a=poster) : plus fiable sur mobile que image.tmdb.org en direct. */
function local_posters($films) {
    foreach ($films as &$f) {
        if (!empty($f['poster']) && preg_match('#/t/p/w\d+(/[A-Za-z0-9_\-]+\.(?:jpg|jpeg|png|webp))$#', $f['poster'], $m)) {
            $f['poster'] = 'api.php?a=poster&p=' . rawurlencode($m[1]);
        }
    }
    return $films;
}

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
                 'links' => site_settings($db)['links'], 'myEmail' => ($me !== null ? ($db['emails'][$me] ?? '') : '')], false];
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
        // Tirage au sort de l'ange : 1 chance sur N que la place soit offerte (0 = jamais)
        $rate = site_settings($db)['giftRate'];
        if ($rate > 0 && random_int(1, $rate) === 1) {
            $c['price'] = 0;
            $c['paid'] = true;
            $c['paidAt'] = $c['takenAt'];
            $c['offered'] = true;
        }
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

case 'send_place':
    // Envoie la place (PDF en pièce jointe, ou code) par e-mail au profil qui l'a réservée.
    need_login();
    $me = $_SESSION['profile'] ?? null;
    $isAdmin = !empty($_SESSION['admin']);
    $id = (string)($in['id'] ?? '');
    $email = trim((string)($in['email'] ?? ''));
    $remember = !empty($in['remember']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) out(['error' => 'Adresse e-mail invalide'], 400);
    $c = with_db(function (&$db) use ($id, $me, $isAdmin, $email, $remember) {
        $found = null;
        foreach ($db['codes'] as &$c) {
            if ($c['id'] !== $id || !$c['taken'] || !($isAdmin || $c['takenBy'] === $me)) continue;
            if (($c['mailed'] ?? 0) >= 10) return [['error' => 'Trop d\'envois pour cette place'], false];
            $c['mailed'] = ($c['mailed'] ?? 0) + 1;
            $found = $c;
            break;
        }
        if (!$found) return [null, false];
        if ($me !== null) {
            if ($remember) $db['emails'][$me] = $email;
            else unset($db['emails'][$me]);
        }
        return [$found, true];
    });
    if (!$c) out(['error' => 'Place introuvable'], 404);
    if (isset($c['error'])) out($c, 429);
    $label = TYPE_LABELS[$c['type']] ?? 'Place';
    $body = "Bonjour,\n\nVoici ta place $label réservée sur Ciné Codes (profil : {$c['takenBy']}).\n\n"
          . (empty($c['file']) ? "Code : {$c['code']}\n\n" : "Le billet est en pièce jointe (PDF).\n\n")
          . (!empty($c['expires']) ? 'Valable jusqu\'au ' . date('d/m/Y', strtotime($c['expires'])) . ".\n\n" : '')
          . (COND_TEXT[$c['type']] ?? '') . "\n\nBonne séance 🍿";
    $path = !empty($c['file']) ? PDF_DIR . '/' . basename($c['file']) : null;
    if ($path && !is_file($path)) $path = null;
    $fname = ($c['type'] === 'pathe' ? 'Pathe' : 'CineCheque') . '-' . trim(preg_replace('/[^A-Za-z0-9_-]+/', '-', $c['code']), '-') . '.pdf';
    $ok = send_mail($email, "Ta place $label 🎟️", $body, $path, $fname);
    if (!$ok) out(['error' => "L'e-mail n'a pas pu partir. Réessaie plus tard."], 500);
    out(['ok' => true]);

case 'films':
    need_login();
    if (!defined('TMDB_KEY') || TMDB_KEY === '') out(['films' => []]);
    $cache = __DIR__ . '/data/films.php';
    $tryFile = __DIR__ . '/data/films.try';
    // Mise à jour une fois par semaine : le mercredi à partir de 8 h (jour des sorties en France)
    $lastWed = strtotime('wednesday this week 08:00');
    if ($lastWed > time()) $lastWed -= 7 * 86400;
    $fresh = is_file($cache) && filemtime($cache) >= $lastWed;
    // En cas d'échec chez TMDB, on ne réessaie qu'une fois par heure (pour ne pas ralentir le site)
    $recentTry = is_file($tryFile) && time() - filemtime($tryFile) < 3600;
    if ($fresh || (is_file($cache) && $recentTry)) {
        $raw = substr(file_get_contents($cache), strlen(DB_GUARD));
        out(['films' => local_posters(json_decode($raw, true) ?: [])]);
    }
    @touch($tryFile);
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
        if (is_file($cache)) out(['films' => local_posters(json_decode(substr(file_get_contents($cache), strlen(DB_GUARD)), true) ?: [])]);
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
    out(['films' => local_posters($films)]);

case 'poster':
    // Récupère l'affiche chez TMDB une seule fois, la garde dans data/posters et la sert depuis notre domaine.
    need_login();
    $p = rawurldecode((string)($_GET['p'] ?? ''));
    if (!preg_match('#^/[A-Za-z0-9_\-]+\.(jpg|jpeg|png|webp)$#', $p, $m)) { http_response_code(400); exit; }
    $dir = __DIR__ . '/data/posters';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $file = $dir . $p;
    if (!is_file($file) || filesize($file) < 100) {
        $url = 'https://image.tmdb.org/t/p/w342' . $p;
        $img = false;
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_FOLLOWLOCATION => true]);
            $img = curl_exec($ch);
            if (curl_getinfo($ch, CURLINFO_HTTP_CODE) !== 200) $img = false;
            curl_close($ch);
        } else {
            $img = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 10]]));
        }
        if (!$img || strlen($img) < 100) { http_response_code(404); exit; }
        @file_put_contents($file, $img);
        // petit ménage : affiches de plus de 60 jours
        foreach (glob($dir . '/*') ?: [] as $old) if (filemtime($old) < time() - 60 * 86400) @unlink($old);
    }
    $mime = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][strtolower($m[1])];
    header('Content-Type: ' . $mime);
    header('Cache-Control: private, max-age=604800');
    header('Content-Length: ' . filesize($file));
    readfile($file);
    exit;

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
        $faces = [1 => (bool)glob(__DIR__ . '/data/ange1.*'), 2 => (bool)glob(__DIR__ . '/data/ange2.*')];
        return [['codes' => $codes, 'profiles' => $db['profiles'], 'pay' => $pay, 'site' => $site, 'today' => date('Y-m-d'), 'faces' => $faces], false];
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
    $gift = array_key_exists('giftRate', $in) ? max(0, min(100, (int)$in['giftRate'])) : null;
    $keepEmail = !array_key_exists('email', $in);
    with_db(function (&$db) use ($email, $links, $gift, $keepEmail) {
        if (!$keepEmail) { $db['site']['email'] = $email; $db['site']['links'] = $links; }
        if ($gift !== null) $db['site']['giftRate'] = $gift;
        return [null, true];
    });
    out(['ok' => true]);

case 'admin_test_mail':
    need_admin();
    $email = with_db(function (&$db) { return [site_settings($db)['email'], false]; });
    if ($email === '') out(['error' => "Enregistrez d'abord une adresse e-mail"], 400);
    $ok = send_mail($email, 'Ciné Codes : e-mail de test', "Si vous lisez ce message, les alertes « dernière place » de Ciné Codes fonctionnent 🎟️");
    out($ok ? ['ok' => true] : ['error' => "Le serveur n'a pas pu envoyer l'e-mail"], $ok ? 200 : 500);

case 'admin_upload_face':
    need_admin();
    $n = (int)($_POST['n'] ?? 0);
    if ($n !== 1 && $n !== 2) out(['error' => 'Photo inconnue'], 400);
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) out(['error' => 'Envoi échoué (image trop lourde ?)'], 400);
    if ($f['size'] > 5 * 1024 * 1024) out(['error' => 'Image trop lourde (5 Mo max)'], 400);
    $info = @getimagesize($f['tmp_name']);
    $exts = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if (!$info || !isset($exts[$info[2]])) out(['error' => 'Format accepté : JPG, PNG, WEBP ou GIF'], 400);
    foreach (glob(__DIR__ . "/data/ange$n.*") ?: [] as $old) @unlink($old);
    if (!move_uploaded_file($f['tmp_name'], __DIR__ . "/data/ange$n." . $exts[$info[2]])) out(['error' => "Impossible d'enregistrer l'image"], 500);
    out(['ok' => true]);

case 'admin_delete_face':
    need_admin();
    $n = (int)($in['n'] ?? 0);
    if ($n === 1 || $n === 2) foreach (glob(__DIR__ . "/data/ange$n.*") ?: [] as $old) @unlink($old);
    out(['ok' => true]);

case 'face':
    need_login();
    $n = (int)($_GET['n'] ?? 0);
    $files = ($n === 1 || $n === 2) ? (glob(__DIR__ . "/data/ange$n.*") ?: []) : [];
    if (!$files) { header('Content-Type: text/plain'); http_response_code(404); echo 'Pas de photo'; exit; }
    $mime = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'][pathinfo($files[0], PATHINFO_EXTENSION)] ?? 'application/octet-stream';
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($files[0]));
    header('Cache-Control: private, max-age=86400');
    readfile($files[0]);
    exit;

case 'admin_refresh_films':
    need_admin();
    @unlink(__DIR__ . '/data/films.php');
    @unlink(__DIR__ . '/data/films.try');
    out(['ok' => true]);

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
