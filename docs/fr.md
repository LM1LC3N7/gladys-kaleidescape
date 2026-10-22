# Kaleidescape pour Gladys

Pilotez vos lecteurs de films **Kaleidescape** (Strato, Compact Terra
Prevue, Alto, Cinema One, M-Class) depuis Gladys, en local, sans aucun
cloud : allumage, veille, lecture, pause, arrêt, touches de télécommande,
état de lecture, titre, chapitre, position dans le film et format vidéo.

> **Important.** Cette intégration n'a jamais été testée avec un vrai
> appareil : elle a été écrite d'après la bibliothèque `pykaleidescape`
> (celle de Home Assistant) et testée avec un faux lecteur seulement. Vos
> retours sont les bienvenus.
> Intégration non officielle, sans lien avec Kaleidescape.

## Installation

1. Donnez au lecteur une **adresse IP fixe** dans votre box (bail DHCP
   réservé).
2. Dans Gladys, installez l'intégration **Kaleidescape**, ouvrez sa
   configuration et saisissez les adresses IP des lecteurs, séparées par des
   virgules (par exemple `192.168.1.60` ; port 10000 par défaut, un autre
   sous la forme `192.168.1.60:10001`).
3. Les lecteurs apparaissent dans l'onglet **Découverte** : créez-les.

Le protocole de contrôle n'a pas de mot de passe : rien d'autre à saisir.
Un serveur sans zone de film (Terra, 1U, 3U) n'est pas proposé.

## Ce que vous obtenez

| Fonction              | Type Gladys                  | Remarque                                                               |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Marche                | état binaire (lecture seule) | 1 allumé, 0 veille ou injoignable                                      |
| État de marche        | texte (lecture seule)        | en anglais : On, Standby, Not reachable                                |
| Allumer               | bouton                       | envoyé seulement en veille                                             |
| Veille                | bouton                       | envoyé seulement allumé ; jamais bloqué                                |
| Lecture               | bouton                       | envoyé seulement allumé                                                |
| Pause, Arrêt          | boutons                      | envoyés seulement si un film est en cours ; jamais bloqués             |
| Touche                | liste                        | flèches, OK, Retour, menu, chapitre suivant / précédent…               |
| En lecture            | état binaire (lecture seule) | 1 pendant la lecture (ou l'avance / le retour rapide)                  |
| État de lecture       | texte (lecture seule)        | Idle, Paused, Playing, Fast forward, Rewind                            |
| Titre                 | texte (lecture seule)        | le titre en cours, « No title » sans lecture                           |
| Chapitre              | nombre (lecture seule)       | 0 sans lecture                                                         |
| Position dans le film | texte (lecture seule)        | None, Content, Intermission (entracte), Credits (générique), Disc menu |
| Mode vidéo            | texte (lecture seule)        | par exemple `3840x2160p24 16:9`                                        |
| Plage dynamique       | texte (lecture seule)        | SDR, HDR, HDR10 (PQ), Unknown                                          |

Volontairement, aucun **interrupteur** : un « éteins tout » ou « allume
tout » d'un assistant vocal ou d'une scène n'atteint jamais votre lecteur.
Utilisez les boutons dans vos scènes. Exemple : baisser les lumières quand
« En lecture » passe à 1, les rallumer quand « Position dans le film »
devient « Credits ».

## Commandes

L'état du lecteur (son numéro de série, sa marche, son état de lecture) est
relu juste avant chaque commande. Si un autre lecteur répond à l'adresse,
rien n'est envoyé et l'adresse est oubliée ; un numéro de série illisible ne
compte pas comme un autre lecteur.

- **Allumer** n'est envoyé qu'en veille ; **Lecture** et les **touches**
  seulement lecteur allumé (sinon : refusé, rien n'est envoyé). Ces
  commandes passent une à une.
- **Veille**, **Pause** et **Arrêt** protègent : elles ne font jamais la
  queue, ne sont jamais refusées faute d'avoir pu lire l'état (elles sont
  alors envoyées quand même), et annulent les commandes Allumer, Lecture ou
  touche encore en attente (« Cancelled by …, nothing sent »).
- Une commande n'est annoncée réussie que si l'état relu ensuite est celui
  demandé (marche, lecture, pause, arrêt) ; une touche, que si le lecteur
  l'accepte. Sinon : « Sent, without confirmation from the player »
  (envoyée, sans confirmation). Une commande qui n'a pas pu partir est
  signalée « nothing sent » (rien envoyé), un refus du lecteur « refused by
  the player ».

Chaque commande reçoit une réponse en moins de 4 secondes (Gladys attend 5
secondes) ; elle ne part jamais après son échéance.

## Bouton de la configuration

- **Vérifier les lecteurs** : donne l'état connu de chaque lecteur et de
  chaque adresse saisie, avec l'âge de la dernière lecture. Il ne relit un
  lecteur que si son intervalle est écoulé.

## Rafraîchissement, statut et limites

- L'état de chaque lecteur est lu toutes les 15 secondes par défaut (10 à
  300), en une courte connexion. Jamais plus souvent : ni la reconnexion à
  Gladys, ni l'enregistrement de la configuration, ni le bouton, ni la
  création de l'appareil, ni un redémarrage ne relancent une lecture plus
  tôt (l'heure de la dernière lecture est gardée dans le dossier de données).
- Une adresse où aucun lecteur n'est encore identifié est relue chaque
  minute au plus.
- Un lecteur qui ne répond pas affiche la marche à 0 et « Not reachable »,
  et est cité dans le statut de l'intégration.
- Le titre, le chapitre et le format vidéo sont lus à chaque
  rafraîchissement : une scène réagit avec ce délai (pas encore
  d'événements en temps réel).

## Données et confidentialité

L'intégration garde dans `/data/kaleidescape.json` les lecteurs connus
(numéro de série, adresse, port, modèle, nom, nombre de zones de film) et
l'heure de la dernière lecture de chaque adresse. Rien de ce que vous
regardez n'y est écrit. Rien ne sort de votre réseau local.

## Limites connues

- Pas encore d'événements en temps réel (lecture par intervalle seulement).
- Pas de jaquette, de synopsis ni de réglage du volume (le lecteur ne pilote
  pas le volume).
- Un lecteur à plusieurs zones est vu comme un seul appareil (zone
  principale).
- Jamais testé avec un vrai appareil : les réponses réelles peuvent
  différer.
