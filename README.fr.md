# bbbbb

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md)

<p align="center"><img src="assets/readme/bbbbb-logo.svg" width="128" alt="bbbbb"></p>

**Un avis quand vous devez intervenir.**

bbbbb (« B-five ») rassemble les résultats de compilation, questions d’agents de programmation et demandes d’approbation de déploiement dans une boîte privée sur iPhone. Retrouvez les mises à jour dans l’app même après avoir manqué une notification.

À traiter conserve les questions, échecs, approbations et tâches jusqu’à leur résolution. Le reste apparaît dans Activité. Les sources peuvent envoyer, mais ne peuvent ni lire la boîte ni exécuter de commandes.

<p align="center"><a href="https://apps.apple.com/us/app/bbbbb-coding-agent-alerts/id6791204016"><img src="assets/readme/download-on-the-app-store.svg" height="60" alt="App Store"></a></p>

[bbbbb.app](https://bbbbb.app/?lang=fr)

## À venir : v1.5

L’app sera disponible en anglais, chinois simplifié, espagnol, japonais, allemand, français et portugais du Brésil, avec des améliorations du stockage de l’historique et de l’export CSV. Le site est déjà disponible dans les sept langues. La mise à jour de l’app n’est pas encore publiée sur l’App Store.

## Démarrage rapide

Donnez cette instruction à votre agent : `Set up bbbbb at bbbbb.app/setup`. Il prépare une source HTTP. Scannez le QR code temporaire ou saisissez le code à six chiffres sur l’iPhone, puis approuvez la connexion. L’agent enregistre le lien privé et envoie un message de test. Pour les apps et automatisations, utilisez « Connecter une app ou une automatisation » sur l’iPhone.

Après la configuration, envoyez directement avec la variable `BBBBB_SOURCE_URL` enregistrée. L’émetteur choisit la catégorie : À traiter si une réponse est nécessaire, sinon Activité. Gardez les URL de source hors des prompts et des journaux.

```sh
curl -X POST "$BBBBB_SOURCE_URL"
```

### CLI facultative

```sh
npm install --global @bbbbbapp/cli
bbbbb setup --name "My Mac"
bbbbb run -- npm test
```

Si npm n’est pas disponible, utilisez une [version GitHub](https://github.com/xxsang/bbbbb/releases) vérifiée. Consultez le [guide CLI](https://bbbbb.app/docs/cli-source/?lang=fr).

### Skill pour agents de programmation

```sh
sh scripts/install-bbbbb-notify-skill.sh
```

Après l’installation, donnez cette instruction à l’agent :

> Utilise bbbbb pour cette tâche. Préviens-moi quand elle est terminée. Envoie Attention uniquement si je dois intervenir. Pas de notifications intermédiaires.

## Guides

[macOS](https://bbbbb.app/docs/macos/?lang=fr) · [Linux](https://bbbbb.app/docs/linux/?lang=fr) · [Windows](https://bbbbb.app/docs/windows/?lang=fr) · [HTTP](https://bbbbb.app/docs/http-source/?lang=fr) · [CLI](https://bbbbb.app/docs/cli-source/?lang=fr)

## Forfaits et limites

Le forfait gratuit inclut toutes les fonctions essentielles : 1 000 mises à jour sur les 30 derniers jours, avec conservation chiffrée des 100 plus récentes pendant sept jours maximum pour les récupérer après une déconnexion.

Plus coûte 4,99 $ US en achat unique pendant les 60 premiers jours suivant le lancement, futures fonctions comprises. Ce n’est pas un abonnement. À partir du 26 octobre 2026, le prix normal sera de 6,99 $ US, payé une seule fois. L’App Store affiche le prix local actuel.

Plus porte le quota à 10 000 mises à jour, conserve les 500 plus récentes pendant 30 jours maximum et ajoute l’export JSON et CSV sur l’appareil. Le forfait gratuit reste disponible.

Il n’y a pas de quota quotidien. Chaque boîte partage une limite de sécurité de 20 envois par minute entre toutes ses sources. Ajouter des sources n’augmente pas le quota.

## Confidentialité

Les événements CLI sont chiffrés avant l’envoi ; ceux des sources HTTP le sont avant le stockage. Les sources ne peuvent pas lire l’historique. Les notifications ne montrent aucun détail du message. Les contenus des émetteurs restent inchangés et ne sont pas traduits.

Les composants de base destinés aux développeurs sont distribués sous [licence Apache 2.0](LICENSE). L’app iPhone est distincte.

<sub>Apple, le logo Apple et App Store sont des marques d’Apple Inc., déposées aux États-Unis et dans d’autres pays et régions.</sub>
