<?php
// ============================================================
//  CINÉ CODES — RÉGLAGES
//  Copiez ce fichier en config.php (sur le serveur uniquement)
//  puis modifiez les valeurs. config.php n'est jamais envoyé sur GitHub.
// ============================================================

// Mot de passe pour entrer sur le site
const SITE_PASSWORD = 'cinema';

// Mot de passe pour le menu « Gestion » (ajouter des codes, renommer les profils…)
// CHANGEZ-LE avant de partager le site !
const ADMIN_PASSWORD = 'admin-a-changer';

// Profils proposés au premier lancement (modifiables ensuite dans le menu Gestion)
const DEFAULT_PROFILES = ['Profil 1', 'Profil 2', 'Profil 3', 'Profil 4', 'Profil 5'];

// Films « À l'affiche en France » (optionnel)
// Créez une clé gratuite sur https://www.themoviedb.org/settings/api
// et collez ici la « Clé d'API » (ou le « Jeton d'accès en lecture »).
// Laissez vide pour masquer la bande de films.
const TMDB_KEY = '';
