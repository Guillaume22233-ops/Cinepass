# Ciné Codes

Petit site privé pour partager des codes de cinéma (CinéChèque et Pathé) entre 5 profils.

- Accès par mot de passe, puis choix du profil
- Un bouton par type de code : le code s'affiche dans une pop-up et disparaît pour tout le monde
- Historique « Mes codes récupérés » par profil
- Bande « À l'affiche en France » (via TMDB, optionnel)
- Menu de gestion : ajout de codes, stock, noms des profils

PHP 7.4+ et aucune base de données : les données sont dans `data/db.php`, qui est créé automatiquement.

## Installation sur Hostinger

1. **hPanel → Avancé → Git** : collez l'URL du dépôt, branche `main`, dossier `public_html` (le dossier doit être vide la première fois), puis **Déployer**.
2. **Gestionnaire de fichiers** : copiez `config.example.php` en **`config.php`** et changez :
   - `SITE_PASSWORD` : mot de passe d'entrée
   - `ADMIN_PASSWORD` : mot de passe du menu Gestion (roue dentée)
   - `TMDB_KEY` : clé gratuite de themoviedb.org (laissez vide pour masquer les films)
3. Activez le SSL gratuit dans hPanel.

Ensuite, à chaque modification poussée sur GitHub, il suffit de cliquer sur **Déployer** dans hPanel. Vous pouvez aussi activer le déploiement automatique (webhook). `config.php` et vos codes ne sont jamais écrasés.

## Sauvegarde

Téléchargez de temps en temps `data/db.php` : il contient tous les codes.

> GitHub Pages ne convient pas : le site a besoin de PHP.
